import * as PAGES from 'constants/pages';
import * as ICONS from 'constants/icons';
import * as ACTIONS from 'constants/action_types';
import { useLocation, useNavigate } from 'react-router-dom';
import React from 'react';
import Page from 'component/page';
import Button from 'component/button';
import Yrbl from 'component/yrbl';
import Lbry from 'lbry';
import { toHex } from 'util/hex';
import CopyableText from 'component/copyableText';
import Card from 'component/common/card';
import { getLivestreamIngestRtmpUrl, NEW_LIVESTREAM_REPLAY_API } from 'constants/livestream';
import { ENABLE_NO_SOURCE_CLAIMS } from 'config';
import classnames from 'classnames';
import Icon from 'component/common/icon';
import YrblWalletEmpty from 'component/yrblWalletEmpty';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectHasChannels, selectFetchingMyChannels } from 'redux/selectors/claims';
import { doClearPublish, doPrepareEdit, doUpdateFile, doUpdatePublishForm } from 'redux/actions/publish';
import { doToast } from 'redux/actions/notifications';
import { selectActiveChannelClaim } from 'redux/selectors/app';
import { doFetchNoSourceClaimsForChannelId } from 'redux/actions/claims';
import { selectUser } from 'redux/selectors/user';
import { selectUserHasValidOdyseeMembership } from 'redux/selectors/memberships';
import {
  selectActiveLivestreamForChannel,
  selectPendingLivestreamsForChannelId,
  selectLivestreamsForChannelId,
} from 'redux/selectors/livestream';
import { selectBalance } from 'redux/selectors/wallet';
import { selectPublishFormValues } from 'redux/selectors/publish';
import ClaimPreview from 'component/claimPreview';
import LivestreamQuickCreate from 'component/livestreamQuickCreate/view';
import { lazyImport } from 'util/lazyImport';
import LivestreamRtmpReplayRecorder from 'component/livestreamRtmpReplayRecorder';
import LivestreamRtmpPreview from 'component/livestreamRtmpPreview';

const ChatLayout = lazyImport(() => import('component/chat' /* webpackChunkName: "chat" */));
import usePersistedState from 'effects/use-persisted-state';
import { WEBRTC_PUBLISH_PRESET_ORDER, type WebrtcPublishPresetId } from 'constants/webrtcPublish';
import { useLivestreamPublish } from 'contexts/livestreamPublish';
import useLivestreamMetrics from 'effects/use-livestream-metrics';
import LivestreamMetrics from 'component/livestreamMetrics/view';
import {
  deleteLivestreamReplay,
  getLivestreamReplayStorageEstimate,
  getLivestreamReplayFile,
  listLivestreamReplays,
  livestreamReplaySourceLabel,
  requestLivestreamReplayStoragePersistence,
  type LivestreamReplayStorageEstimate,
  type LivestreamReplayEntry,
} from 'util/livestreamReplayStorage';
import { formatLbryUrlForWeb } from 'util/url';
import { formatBytes } from 'util/format-bytes';
import { killStream } from 'util/livestream';
import './style.scss';

const ALL_LIVESTREAM_TABS = ['Preview', 'Stream', 'Setup'];

function appendPlaybackFormat(url?: string | null) {
  if (!url || url.includes('format=ts')) return url || null;
  return `${url}${url.includes('?') ? '&' : '?'}format=ts`;
}

function formatReplayCreatedAt(createdAt: number) {
  return new Date(createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatReplayDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatReplayStorageSummary(estimate: LivestreamReplayStorageEstimate | null) {
  if (!estimate) return __('Checking storage');
  if (!estimate.supported) return __('Unavailable');
  if (estimate.usage != null && estimate.quota != null) {
    const freeBytes = Math.max(0, estimate.quota - estimate.usage);
    return __('%used% used, %free% free', {
      used: formatBytes(estimate.usage, 1),
      free: formatBytes(freeBytes, 1),
    });
  }
  if (estimate.quota != null) {
    return __('%free% available', { free: formatBytes(estimate.quota, 1) });
  }
  return __('Available');
}

function livestreamClaimUri(claim?: Record<string, any> | null) {
  return (
    claim?.claimUri ||
    claim?.uri ||
    claim?.canonical_url ||
    claim?.permanent_url ||
    claim?.activeClaim?.claimUri ||
    claim?.activeClaim?.uri ||
    claim?.activeClaim?.canonical_url ||
    claim?.activeClaim?.permanent_url ||
    null
  );
}

function livestreamClaimId(claim?: Record<string, any> | null) {
  return claim?.claimId || claim?.claim_id || claim?.activeClaim?.claimId || claim?.activeClaim?.claim_id || null;
}

function activeLivestreamMatchesClaim(activeLivestream?: Record<string, any> | null, claim?: Record<string, any> | null) {
  if (!activeLivestream || !claim) return Boolean(activeLivestream);
  const activeClaimId = livestreamClaimId(activeLivestream);
  const selectedClaimId = livestreamClaimId(claim);
  if (activeClaimId && selectedClaimId) return activeClaimId === selectedClaimId;

  const activeUri = livestreamClaimUri(activeLivestream);
  const selectedUri = livestreamClaimUri(claim);
  if (activeUri && selectedUri) return activeUri === selectedUri;

  return !activeClaimId && !activeUri;
}

export default function LivestreamSetupPage() {
  const LIVESTREAM_CLAIM_POLL_IN_MS = 60000;
  const dispatch = useAppDispatch();
  const activeChannelClaim = useAppSelector(selectActiveChannelClaim);
  const { claim_id: channelId, name: channelName } = activeChannelClaim || {};
  const publishFormValues = useAppSelector(selectPublishFormValues);
  const editingURI = publishFormValues?.editingURI;
  const hasChannels = useAppSelector(selectHasChannels);
  const fetchingChannels = useAppSelector(selectFetchingMyChannels);
  const myLivestreamClaims = useAppSelector((state) =>
    selectLivestreamsForChannelId(state, channelId)
  ) as Array<StreamClaim>;
  const activeLivestream = useAppSelector((state) => selectActiveLivestreamForChannel(state, channelId));
  const pendingClaims = useAppSelector((state) =>
    selectPendingLivestreamsForChannelId(state, channelId)
  ) as Array<StreamClaim>;
  const user = useAppSelector(selectUser);
  const balance = useAppSelector(selectBalance);
  const hasPremium = useAppSelector(selectUserHasValidOdyseeMembership);
  const BROWSER_STREAM_ENABLED = Boolean(hasPremium);
  const VALID_LIVESTREAM_TABS = BROWSER_STREAM_ENABLED
    ? ALL_LIVESTREAM_TABS
    : ALL_LIVESTREAM_TABS.filter((t) => t !== 'Stream' && t !== 'Preview');
  const { search } = useLocation();
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(search);
  const urlTab = urlParams.get('t');
  const targetClaimId = urlParams.get('claim_id') || urlParams.get('claim');
  const targetUri = urlParams.get('uri');
  const [sigData, setSigData] = React.useState<{ signature: any; signing_ts: any }>({
    signature: undefined,
    signing_ts: undefined,
  });
  const { odysee_live_disabled: liveDisabled } = user || {};
  const livestreamEnabled = Boolean(ENABLE_NO_SOURCE_CLAIMS && user && !liveDisabled);
  const [isClear, setIsClear] = React.useState(false);
  const [presetId, setPresetId] = usePersistedState('livestream-quality-preset', 'balanced') as [
    WebrtcPublishPresetId,
    (v: WebrtcPublishPresetId) => void,
  ];
  const [cameraAutoStart, setCameraAutoStart] = usePersistedState('livestream-camera-autostart', true) as [
    boolean,
    (v: boolean) => void,
  ];
  const [localReplays, setLocalReplays] = React.useState<LivestreamReplayEntry[]>([]);
  const [localReplaysLoaded, setLocalReplaysLoaded] = React.useState(false);
  const [localReplayVersion, setLocalReplayVersion] = React.useState(0);
  const [replayStorageEstimate, setReplayStorageEstimate] =
    React.useState<LivestreamReplayStorageEstimate | null>(null);
  const [requestingReplayStoragePersistence, setRequestingReplayStoragePersistence] = React.useState(false);
  const [selectedReplayId, setSelectedReplayId] = React.useState<string | null>(null);
  const [replayPreviewUrl, setReplayPreviewUrl] = React.useState<string | null>(null);
  const [replayPreviewStatus, setReplayPreviewStatus] = React.useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [publishingReplayId, setPublishingReplayId] = React.useState<string | null>(null);
  const [downloadingReplayId, setDownloadingReplayId] = React.useState<string | null>(null);
  const [endingRtmpStream, setEndingRtmpStream] = React.useState(false);
  const [showRtmpEndConfirm, setShowRtmpEndConfirm] = React.useState(false);
  const publishCtx = useLivestreamPublish();
  const isStreamActive = publishCtx.state.status === 'live' || publishCtx.state.status === 'connecting';
  const previewMediaStream = publishCtx.state.mediaStream;
  const previewVideoRef = React.useRef<HTMLVideoElement | null>(null);
  const createBtnRef = React.useRef<HTMLButtonElement>(null);
  const [arrowOffset, setArrowOffset] = React.useState<number>(18);
  React.useLayoutEffect(() => {
    const btn = createBtnRef.current;
    if (!btn) return;
    const measure = () =>
      setArrowOffset((prev) => {
        const next = btn.offsetWidth / 2;
        return prev === next ? prev : next;
      });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(btn);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const video = previewVideoRef.current;
    if (!video) return;
    video.srcObject = previewMediaStream;
    if (previewMediaStream) video.play().catch(() => {});
  }, [previewMediaStream]);

  function createStreamKey() {
    if (!channelId || !channelName || !sigData.signature || !sigData.signing_ts) return null;
    return `${channelId}?d=${toHex(channelName)}&s=${sigData.signature}&t=${sigData.signing_ts}`;
  }

  const formTitle = !editingURI ? __('Go Live') : __('Edit Livestream');
  const streamKey = createStreamKey();
  const pendingLength = pendingClaims.length;
  const approvedLivestreamClaimCount = myLivestreamClaims.length;
  const studioMountRef = React.useRef<HTMLDivElement | null>(null);
  const setStudioMountAction = publishCtx.actions.setStudioMount;
  const handleStudioMountRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      studioMountRef.current = el;
      setStudioMountAction(el);
    },
    [setStudioMountAction]
  );
  const totalLivestreamClaims = React.useMemo(() => {
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    return pendingClaims.concat(myLivestreamClaims).filter((c: any) => {
      if (!c) return false;
      if (c.claim_id && seenIds.has(c.claim_id)) return false;
      if (c.name && seenNames.has(c.name)) return false;
      if (c.claim_id) seenIds.add(c.claim_id);
      if (c.name) seenNames.add(c.name);
      return true;
    });
  }, [pendingClaims, myLivestreamClaims]);
  const selectedLivestreamClaim = React.useMemo(() => {
    if (!totalLivestreamClaims.length) return null;
    if (targetClaimId) {
      const byClaimId = totalLivestreamClaims.find(
        (claim: any) => claim.claim_id === targetClaimId || claim.claimId === targetClaimId
      );
      if (byClaimId) return byClaimId;
    }
    if (targetUri) {
      const byUri = totalLivestreamClaims.find((claim: any) => livestreamClaimUri(claim) === targetUri);
      if (byUri) return byUri;
    }
    return totalLivestreamClaims[0];
  }, [targetClaimId, targetUri, totalLivestreamClaims]);
  const orderedLivestreamClaims = React.useMemo(() => {
    if (!selectedLivestreamClaim) return totalLivestreamClaims;
    return [
      selectedLivestreamClaim,
      ...totalLivestreamClaims.filter((claim: any) => claim !== selectedLivestreamClaim),
    ];
  }, [selectedLivestreamClaim, totalLivestreamClaims]);
  const selectedLivestreamUri = livestreamClaimUri(selectedLivestreamClaim);
  const selectedLivestreamClaimId = livestreamClaimId(selectedLivestreamClaim);
  const activeLivestreamMatchesSelectedClaim = activeLivestreamMatchesClaim(activeLivestream, selectedLivestreamClaim);
  const managedActiveLivestream = activeLivestreamMatchesSelectedClaim ? activeLivestream : null;
  const activeLivestreamUri = livestreamClaimUri(managedActiveLivestream) || selectedLivestreamUri;
  const previewLivestreamUri = selectedLivestreamUri;
  const activeLivestreamClaimId =
    livestreamClaimId(managedActiveLivestream) || livestreamClaimId(selectedLivestreamClaim) || null;
  const activeLivestreamPlaybackUrl = appendPlaybackFormat(
    managedActiveLivestream?.videoUrlPublic || managedActiveLivestream?.videoUrl
  );
  const activeLivestreamTitle =
    managedActiveLivestream?.title ||
    managedActiveLivestream?.name ||
    selectedLivestreamClaim?.value?.title ||
    selectedLivestreamClaim?.name ||
    null;
  const selectedLivestreamTitle =
    selectedLivestreamClaim?.value?.title || selectedLivestreamClaim?.name || selectedLivestreamUri || null;
  const visibleLocalReplays = React.useMemo(
    () =>
      localReplays
        .filter((entry) => !entry.channelId || !channelId || entry.channelId === channelId)
        .sort((a, b) => {
          const rank = (entry: LivestreamReplayEntry) => {
            if (
              (selectedLivestreamClaimId && entry.claimId === selectedLivestreamClaimId) ||
              (selectedLivestreamUri && entry.uri === selectedLivestreamUri)
            ) {
              return 0;
            }
            if (!entry.claimId && !entry.uri) return 1;
            return 2;
          };
          return rank(a) - rank(b) || b.createdAt - a.createdAt;
        }),
    [channelId, localReplays, selectedLivestreamClaimId, selectedLivestreamUri]
  );
  const hasLocalReplays = visibleLocalReplays.length > 0;
  const selectedReplay = visibleLocalReplays.find((entry) => entry.id === selectedReplayId) || visibleLocalReplays[0];
  const replayStorageSummary = formatReplayStorageSummary(replayStorageEstimate);
  const replayStoragePersistenceLabel =
    replayStorageEstimate?.persisted === true
      ? __('Persistent')
      : replayStorageEstimate?.supported === false
        ? __('Unavailable')
        : __('Best effort');
  const canRequestReplayStoragePersistence = Boolean(
    replayStorageEstimate?.supported && replayStorageEstimate.canPersist && replayStorageEstimate.persisted !== true
  );

  const handleReplaySaved = React.useCallback((entry: LivestreamReplayEntry) => {
    setLocalReplays((entries) => [entry, ...entries.filter((item) => item.id !== entry.id)]);
    setLocalReplayVersion((version) => version + 1);
  }, []);

  function createNewLivestream() {
    dispatch(doClearPublish());
    navigate(`/$/${PAGES.LIVESTREAM_CREATE}`);
  }

  React.useEffect(() => {
    if (channelId && channelName) {
      Lbry.channel_sign({
        channel_id: channelId,
        hexdata: toHex(channelName),
      })
        .then((data: any) => setSigData(data))
        .catch(() => setSigData({ signature: null, signing_ts: null }));
    }
  }, [channelName, channelId]);

  React.useEffect(() => {
    if (!channelId || !BROWSER_STREAM_ENABLED) return;
    publishCtx.actions.setStudioProps({
      streamKey,
      livestreamUri: selectedLivestreamUri,
      livestreamEnabled,
      hasApprovedLivestreamClaim: approvedLivestreamClaimCount > 0,
      presetId,
      signature: sigData.signature,
      signingTs: sigData.signing_ts,
      onReplaySaved: handleReplaySaved,
    });
  }, [
    channelId,
    streamKey,
    selectedLivestreamUri,
    livestreamEnabled,
    approvedLivestreamClaimCount,
    presetId,
    sigData.signature,
    sigData.signing_ts,
    handleReplaySaved,
    publishCtx.actions,
  ]);

  const [hasReplays, setHasReplays] = React.useState(false);
  React.useEffect(() => {
    if (!channelId || !channelName || !sigData.signature || !sigData.signing_ts) return;
    let cancelled = false;
    const url =
      `${NEW_LIVESTREAM_REPLAY_API}?channel_claim_id=${String(channelId)}` +
      `&signature=${sigData.signature}&signature_ts=${sigData.signing_ts}&channel_name=${encodeURIComponent(channelName)}`;
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const data: Array<any> = json?.data || json || [];
        const usable = data.some((d: any) => {
          const s = typeof d?.Status === 'string' ? d.Status.toLowerCase() : '';
          return s === 'inprogress' || s === 'ready';
        });
        setHasReplays(usable);
      })
      .catch(() => {
        if (!cancelled) setHasReplays(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, channelName, sigData.signature, sigData.signing_ts]);

  React.useEffect(() => {
    let cancelled = false;
    setLocalReplaysLoaded(false);
    Promise.allSettled([listLivestreamReplays(), getLivestreamReplayStorageEstimate()])
      .then(([replaysResult, storageResult]) => {
        if (cancelled) return;
        setLocalReplays(replaysResult.status === 'fulfilled' ? replaysResult.value : []);
        setReplayStorageEstimate(
          storageResult.status === 'fulfilled'
            ? storageResult.value
            : {
                supported: false,
                usage: null,
                quota: null,
                persisted: null,
                canPersist: false,
              }
        );
        setLocalReplaysLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [localReplayVersion]);

  React.useEffect(() => {
    if (!visibleLocalReplays.length) {
      setSelectedReplayId(null);
      return;
    }
    if (!selectedReplayId || !visibleLocalReplays.some((entry) => entry.id === selectedReplayId)) {
      setSelectedReplayId(visibleLocalReplays[0].id);
    }
  }, [selectedReplayId, visibleLocalReplays]);

  React.useEffect(() => {
    if (!selectedReplay?.id) {
      setReplayPreviewUrl(null);
      setReplayPreviewStatus('idle');
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setReplayPreviewUrl(null);
    setReplayPreviewStatus('loading');
    getLivestreamReplayFile(selectedReplay.id)
      .then((file) => {
        if (cancelled) return;
        if (!file) {
          setReplayPreviewStatus('error');
          return;
        }
        objectUrl = URL.createObjectURL(file);
        setReplayPreviewUrl(objectUrl);
        setReplayPreviewStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setReplayPreviewStatus('error');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedReplay?.id]);

  React.useEffect(() => {
    let checkClaimsInterval: ReturnType<typeof setInterval> | undefined;
    if (!channelId) return;
    dispatch(doFetchNoSourceClaimsForChannelId(channelId));
    checkClaimsInterval = setInterval(
      () => dispatch(doFetchNoSourceClaimsForChannelId(channelId)),
      LIVESTREAM_CLAIM_POLL_IN_MS
    );
    return () => {
      if (checkClaimsInterval) clearInterval(checkClaimsInterval);
    };
  }, [channelId, pendingLength, dispatch]);

  const defaultTab = BROWSER_STREAM_ENABLED ? 'Preview' : 'Setup';
  const TAB_STORAGE_KEY = 'livestream-setup-last-tab';
  const initialTab = (() => {
    if (urlTab && VALID_LIVESTREAM_TABS.includes(urlTab)) return urlTab;
    try {
      const stored = localStorage.getItem(TAB_STORAGE_KEY);
      if (stored && VALID_LIVESTREAM_TABS.includes(stored)) return stored;
    } catch {}
    return defaultTab;
  })();
  const [tab, setTabState] = React.useState(initialTab);
  const setTab = React.useCallback(
    (next: string) => {
      setTabState(next);
      try {
        localStorage.setItem(TAB_STORAGE_KEY, next);
      } catch {}
      const sp = new URLSearchParams(search);
      if (next === defaultTab) sp.delete('t');
      else sp.set('t', next);
      const qs = sp.toString();
      navigate({ pathname: `/$/${PAGES.LIVESTREAM}`, search: qs ? `?${qs}` : '' }, { replace: true });
    },
    [search, navigate, defaultTab]
  );

  React.useEffect(() => {
    if (urlTab && !VALID_LIVESTREAM_TABS.includes(urlTab)) setTab(defaultTab);
  }, [urlTab, defaultTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const metricsActive = Boolean(channelId && channelName && sigData.signature && sigData.signing_ts);
  const serverMetrics = useLivestreamMetrics(
    channelId,
    channelName,
    sigData.signature,
    sigData.signing_ts,
    metricsActive
  );
  const activeStreamWebUrl = activeLivestreamUri ? formatLbryUrlForWeb(activeLivestreamUri) : null;
  const selectedStreamWebUrl = selectedLivestreamUri ? formatLbryUrlForWeb(selectedLivestreamUri) : activeStreamWebUrl;
  const channelWebUrl =
    activeChannelClaim?.permanent_url || activeChannelClaim?.canonical_url
      ? formatLbryUrlForWeb(activeChannelClaim.permanent_url || activeChannelClaim.canonical_url)
      : null;
  const liveSourceType = String(serverMetrics?.source_type || '').toLowerCase();
  const streamDetected = Boolean(
    (activeLivestreamMatchesSelectedClaim && serverMetrics?.live) ||
      managedActiveLivestream?.isLive ||
      activeLivestreamPlaybackUrl
  );
  const isRtmpLive = Boolean(
    activeLivestreamPlaybackUrl && (liveSourceType === 'rtmp' || (!liveSourceType && streamDetected))
  );
  const hasRtmpPreview = Boolean(isRtmpLive && activeLivestreamPlaybackUrl && !previewMediaStream);
  const previewIsLive = isStreamActive || hasRtmpPreview;
  const canEndRtmpStream = Boolean(channelId && channelName && isRtmpLive);
  const sourceStatusLabel = streamDetected
    ? liveSourceType
      ? liveSourceType.toUpperCase()
      : activeLivestreamPlaybackUrl
        ? __('RTMP')
        : __('Live')
    : __('Offline');
  const previewStatusLabel = hasRtmpPreview ? __('Live') : previewMediaStream ? __('Browser') : __('Waiting');

  React.useEffect(() => {
    if (editingURI) navigate(`/$/${PAGES.LIVESTREAM_CREATE}`);
  }, [editingURI, navigate]);

  const claimsFetchedRef = React.useRef(false);
  const prevChannelIdRef = React.useRef(channelId);
  React.useEffect(() => {
    if (channelId !== prevChannelIdRef.current) {
      claimsFetchedRef.current = false;
      prevChannelIdRef.current = channelId;
    }
  }, [channelId]);
  const [claimsFetched, setClaimsFetched] = React.useState(false);
  React.useEffect(() => {
    if (!channelId || claimsFetchedRef.current) return;
    const timer = setTimeout(() => {
      claimsFetchedRef.current = true;
      setClaimsFetched(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [channelId]);

  React.useEffect(() => {
    if (urlTab && VALID_LIVESTREAM_TABS.includes(urlTab)) setTab(urlTab);
  }, [urlTab]);

  function resetForm() {
    dispatch(doClearPublish());
    navigate(`/$/${PAGES.LIVESTREAM_CREATE}`);
  }

  function manageLivestreamClaim(claim: Record<string, any>) {
    const claimId = livestreamClaimId(claim);
    const uri = livestreamClaimUri(claim);
    const sp = new URLSearchParams(search);
    sp.set('t', 'Setup');
    if (claimId) {
      sp.set('claim_id', claimId);
      sp.delete('uri');
    } else if (uri) {
      sp.set('uri', uri);
      sp.delete('claim_id');
    }
    navigate({ pathname: `/$/${PAGES.LIVESTREAM}`, search: `?${sp.toString()}` });
  }

  async function publishLocalReplay(entry: LivestreamReplayEntry) {
    if (publishingReplayId) return;
    setPublishingReplayId(entry.id);
    let file: File | null;
    try {
      file = await getLivestreamReplayFile(entry.id);
    } catch {
      setPublishingReplayId(null);
      dispatch(doToast({ isError: true, message: __('Replay could not be loaded from browser storage.') }));
      return;
    }
    if (!file) {
      setPublishingReplayId(null);
      dispatch(doToast({ isError: true, message: __('Replay could not be loaded from browser storage.') }));
      return;
    }
    const replayUri = entry.uri || activeLivestreamUri;
    const replayClaim = totalLivestreamClaims.find(
      (claim) => claim.claim_id === entry.claimId || livestreamClaimUri(claim) === replayUri
    );
    try {
      if (replayClaim && replayUri) {
        await dispatch(doPrepareEdit(replayClaim, replayUri, ''));
      }
      dispatch(
        doUpdatePublishForm({
          editingURI: replayUri,
          liveCreateType: replayUri ? 'edit_placeholder' : 'choose_replay',
          liveEditType: 'upload_replay',
          remoteFileUrl: undefined,
        })
      );
      dispatch(doUpdateFile(file as WebFile, false));
      navigate(`/$/${PAGES.LIVESTREAM_CREATE}?s=Replay&replay=${entry.id}`);
    } catch {
      setPublishingReplayId(null);
      dispatch(doToast({ isError: true, message: __('Replay could not be prepared for publishing.') }));
    }
  }

  const deleteLocalReplay = React.useCallback(
    async (entry: LivestreamReplayEntry) => {
      try {
        await deleteLivestreamReplay(entry.id);
        setLocalReplays((entries) => entries.filter((item) => item.id !== entry.id));
        if (selectedReplayId === entry.id) setSelectedReplayId(null);
      } catch {
        dispatch(doToast({ isError: true, message: __('Replay could not be removed from browser storage.') }));
      }
    },
    [dispatch, selectedReplayId]
  );

  async function downloadLocalReplay(entry: LivestreamReplayEntry) {
    if (downloadingReplayId) return;
    setDownloadingReplayId(entry.id);
    let objectUrl: string | null = null;
    try {
      const file = await getLivestreamReplayFile(entry.id);
      if (!file) {
        dispatch(doToast({ isError: true, message: __('Replay could not be loaded from browser storage.') }));
        return;
      }
      objectUrl = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = file.name || entry.name || 'livestream-replay.webm';
      document.body.appendChild(link);
      link.click();
      link.remove();
      dispatch(doToast({ message: __('Replay download started.') }));
    } catch {
      dispatch(doToast({ isError: true, message: __('Replay could not be downloaded from browser storage.') }));
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setDownloadingReplayId(null);
    }
  }

  function handlePublishReplayClick() {
    if (publishingReplayId) return;
    if (hasLocalReplays && !hasReplays) {
      void publishLocalReplay(visibleLocalReplays[0]);
      return;
    }
    navigate(`/$/${PAGES.LIVESTREAM_CREATE}?s=Replay`);
  }

  async function keepReplayStorage() {
    setRequestingReplayStoragePersistence(true);
    try {
      const persisted = await requestLivestreamReplayStoragePersistence();
      const estimate = await getLivestreamReplayStorageEstimate();
      setReplayStorageEstimate(estimate);
      dispatch(
        doToast({
          isError: !persisted,
          message: persisted
            ? __('Browser storage will try to keep livestream replays available.')
            : __('This browser did not allow persistent replay storage.'),
        })
      );
    } catch {
      dispatch(doToast({ isError: true, message: __('Replay storage settings could not be updated.') }));
    } finally {
      setRequestingReplayStoragePersistence(false);
    }
  }

  async function endRtmpStream() {
    if (!channelId || !channelName || endingRtmpStream) return;
    setEndingRtmpStream(true);
    try {
      await killStream(channelId, channelName);
      dispatch({
        type: ACTIONS.LIVESTREAM_IS_LIVE_COMPLETE,
        data: {
          [channelId]: {
            type: 'application/x-mpegurl',
            isLive: false,
            viewCount: 0,
            creatorId: channelId,
            thumbnailUrl: null,
            activeClaim: null,
          },
        },
      });
      setShowRtmpEndConfirm(false);
      dispatch(doToast({ message: __('RTMP stream ended. Local replay will save in this browser.') }));
    } catch {
      dispatch(doToast({ isError: true, message: __('RTMP stream could not be ended.') }));
    } finally {
      setEndingRtmpStream(false);
    }
  }

  return (
    <Page>
      {balance < 0.01 && <YrblWalletEmpty />}

      <div className="livestream-setup__header">
        <div className="livestream-setup__heading">
          <h1 className="page__title page__title--margin">
            <Icon icon={ICONS.LIVESTREAM_MONOCHROME} />
            <label>{formTitle}</label>
          </h1>
          <p className="livestream-setup__subtitle">
            {__('Stream directly from your browser or use RTMP with OBS/Restream.')}
          </p>
        </div>
        <div className="livestream-setup__header-actions">
          <button
            className="livestream-setup__create-btn livestream-setup__create-btn--secondary"
            onClick={handlePublishReplayClick}
            disabled={
              Boolean(publishingReplayId) ||
              balance < 0.01 ||
              (totalLivestreamClaims.length === 0 && !hasReplays && !hasLocalReplays)
            }
          >
            <Icon icon={ICONS.MENU} size={16} />
            {publishingReplayId ? __('Publishing...') : __('Publish replay')}
          </button>
          <button
            ref={createBtnRef}
            className="livestream-setup__create-btn"
            onClick={() => navigate(`/$/${PAGES.LIVESTREAM_CREATE}`)}
            disabled={balance < 0.01}
          >
            <Icon icon={ICONS.ADD} size={16} />
            {__('Create / Edit')}
          </button>
          {totalLivestreamClaims.length === 0 && (
            <p
              className="help help--notice livestream-setup__claim-hint"
              style={{ ['--claim-hint-arrow-right' as any]: `${arrowOffset}px` }}
            >
              {__('Before you can go live, you have to create a livestream claim.')}
            </p>
          )}
        </div>
      </div>

      <div className="livestream-setup__toolbar">
        <div className="livestream-setup__tabs">
          {BROWSER_STREAM_ENABLED && (
            <button
              className={classnames('livestream-setup__tab', { 'livestream-setup__tab--active': tab === 'Preview' })}
              onClick={() => setTab('Preview')}
              disabled={balance < 0.01}
            >
              <Icon icon={ICONS.EYE} size={16} />
              {__('Preview')}
            </button>
          )}
          {BROWSER_STREAM_ENABLED && (
            <button
              className={classnames('livestream-setup__tab', { 'livestream-setup__tab--active': tab === 'Stream' })}
              onClick={() => setTab('Stream')}
              disabled={balance < 0.01}
            >
              <Icon icon={ICONS.CAMERA} size={16} />
              {__('Browser Stream (Beta)')}
            </button>
          )}
          <button
            className={classnames('livestream-setup__tab', {
              'livestream-setup__tab--active': tab === 'Setup',
            })}
            onClick={() => setTab('Setup')}
            disabled={balance < 0.01 || Boolean(editingURI)}
          >
            <Icon icon={ICONS.SETTINGS} size={16} />
            {__('RTMP Setup')}
          </button>
        </div>

        {tab === 'Stream' && (
          <div className="livestream-setup__stream-options">
            <div className="livestream-setup__option-group">
              <span className="livestream-setup__option-label">{__('Quality')}</span>
              <div className="livestream-setup__quality-pills">
                {WEBRTC_PUBLISH_PRESET_ORDER.map((id) => (
                  <button
                    key={id}
                    className={classnames('livestream-setup__quality-pill', {
                      'livestream-setup__quality-pill--active': presetId === id,
                    })}
                    onClick={() => setPresetId(id)}
                    disabled={isStreamActive}
                  >
                    {id === 'data_saver' && '480p'}
                    {id === 'balanced' && '720p'}
                    {id === 'hd' && '1080p'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {!fetchingChannels && !hasChannels && (
        <Yrbl
          type="happy"
          title={__("You haven't created a channel yet, let's fix that!")}
          actions={
            <div className="section__actions">
              <Button button="primary" navigate={`/$/${PAGES.CHANNEL_NEW}`} label={__('Create A Channel')} />
            </div>
          }
        />
      )}

      {tab === 'Preview' && (
        <div className="livestream-setup__preview">
          <div className="livestream-setup__preview-video">
            {previewMediaStream ? (
              <video
                ref={previewVideoRef}
                className="livestream-setup__preview-live-video"
                autoPlay
                muted
                playsInline
              />
            ) : hasRtmpPreview ? (
              <LivestreamRtmpPreview active={hasRtmpPreview} videoUrl={activeLivestreamPlaybackUrl} />
            ) : (
              <div className="livestream-setup__preview-placeholder" />
            )}
            {!previewIsLive && (
              <div className="livestream-setup__preview-offair">
                <span className="livestream-setup__preview-offair-dot" />
                {__('OFF AIR')}
              </div>
            )}
          </div>
          <div
            className={classnames('livestream-setup__preview-chat-wrap', {
              'livestream-setup__preview-chat-wrap--disabled': !previewIsLive || !previewLivestreamUri,
            })}
          >
            {previewLivestreamUri ? (
              <React.Suspense fallback={null}>
                <ChatLayout uri={previewLivestreamUri} />
              </React.Suspense>
            ) : (
              <div className="livestream-setup__preview-chat-placeholder">
                <div className="livestream-setup__preview-chat-empty-box">
                  <p className="livestream-setup__preview-chat-empty">
                    {__('Create a livestream claim to preview chat.')}
                  </p>
                </div>
                <div className="livestream-setup__preview-chat-input-stub">{__('Chat unavailable')}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {!fetchingChannels && channelId && BROWSER_STREAM_ENABLED && (
        <div
          className={classnames({ disabled: editingURI })}
          style={tab !== 'Stream' ? { display: 'none' } : undefined}
        >
          <div ref={handleStudioMountRef} className="livestream-setup__studio-host" />
        </div>
      )}

      {tab === 'Setup' && (
        <div className={editingURI ? 'disabled' : ''}>
          {!livestreamEnabled && (
            <Card
              background
              className="livestream-setup__disabled-card"
              title={__('Livestreaming disabled')}
              body={
                <p className="help">
                  {__('This account has livestreaming disabled. Contact hello@odysee.com for help.')}
                </p>
              }
            />
          )}

          {livestreamEnabled && (
            <div className="livestream-setup__rtmp">
              {!fetchingChannels && channelId && (
                <>
                  <div
                    className={classnames('livestream-setup__key-card', {
                      'livestream-setup__key-card--disabled': !streamKey || totalLivestreamClaims.length === 0,
                    })}
                  >
                    <div className="livestream-setup__key-header">
                      <h3 className="livestream-setup__key-title">{__('Stream Credentials')}</h3>
                      <p className="livestream-setup__key-subtitle">
                        {__('Use these in OBS, Restream, or any RTMP-compatible software.')}
                      </p>
                    </div>
                    <div className="livestream-setup__key-fields">
                      <CopyableText
                        primaryButton
                        enableInputMask={!streamKey || totalLivestreamClaims.length === 0}
                        name="stream-server"
                        label={__('Server URL')}
                        copyable={getLivestreamIngestRtmpUrl()}
                        snackMessage={__('Copied server URL.')}
                        disabled={!streamKey || totalLivestreamClaims.length === 0}
                      />
                      <CopyableText
                        primaryButton
                        enableInputMask
                        name="livestream-key"
                        label={__('Stream Key')}
                        copyable={
                          !streamKey || totalLivestreamClaims.length === 0 ? getLivestreamIngestRtmpUrl() : streamKey
                        }
                        snackMessage={__('Copied stream key.')}
                      />
                    </div>
                  </div>

                  <details className="livestream-setup__tips">
                    <summary className="livestream-setup__tips-summary">{__('Recommended OBS settings')}</summary>
                    <div className="livestream-setup__tips-body">
                      <ul>
                        <li>{__('Bitrate: 1000-2500 kbps')}</li>
                        <li>{__('Keyframes: 2')}</li>
                        <li>{__('Profile: High')}</li>
                        <li>{__('Tune: Zerolatency')}</li>
                      </ul>
                      <p className="livestream-setup__tips-note">
                        {__('Max bitrate: 7000 kbps. Mobile: use PRISM Live Studio.')}
                      </p>
                    </div>
                  </details>

                  <LivestreamMetrics metrics={serverMetrics} mode="card" />

                  <div className="livestream-setup__management">
                    <div className="livestream-setup__management-header">
                      <div>
                        <h3 className="livestream-setup__management-title">{__('Stream Management')}</h3>
                        <p className="livestream-setup__management-subtitle">
                          {streamDetected
                            ? __('Active stream detected.')
                            : __('Waiting for ingest.')}
                        </p>
                      </div>
                      <div className="livestream-setup__management-actions">
                        {selectedStreamWebUrl && (
                          <Button
                            button="secondary"
                            icon={ICONS.EYE}
                            label={serverMetrics?.live ? __('Open stream') : __('Open stream page')}
                            onClick={() => navigate(selectedStreamWebUrl)}
                          />
                        )}
                        {channelWebUrl && (
                          <Button
                            button="alt"
                            icon={ICONS.CHANNEL}
                            label={__('Open channel')}
                            onClick={() => navigate(channelWebUrl)}
                          />
                        )}
                        {canEndRtmpStream && (
                          <Button
                            button="alt"
                            icon={ICONS.REMOVE}
                            label={endingRtmpStream ? __('Ending...') : __('End RTMP')}
                            onClick={() => setShowRtmpEndConfirm(true)}
                            disabled={endingRtmpStream}
                            className="livestream-setup__end-stream-btn"
                          />
                        )}
                      </div>
                    </div>
                    {showRtmpEndConfirm && (
                      <div className="livestream-setup__end-confirm">
                        <div>
                          <strong>{__('End RTMP stream?')}</strong>
                          <span>{__('This stops the active ingest and saves the browser replay recording.')}</span>
                        </div>
                        <div className="livestream-setup__end-confirm-actions">
                          <Button
                            button="alt"
                            label={__('Cancel')}
                            onClick={() => setShowRtmpEndConfirm(false)}
                            disabled={endingRtmpStream}
                          />
                          <Button
                            button="primary"
                            label={endingRtmpStream ? __('Ending...') : __('End stream')}
                            onClick={endRtmpStream}
                            disabled={endingRtmpStream}
                          />
                        </div>
                      </div>
                    )}
                    <div className="livestream-setup__management-grid">
                      <div className="livestream-setup__management-item">
                        <span>{__('Stream')}</span>
                        <strong>{selectedLivestreamTitle || __('Waiting')}</strong>
                      </div>
                      <div className="livestream-setup__management-item">
                        <span>{__('Source')}</span>
                        <strong>{sourceStatusLabel}</strong>
                      </div>
                      <div className="livestream-setup__management-item">
                        <span>{__('Claim')}</span>
                        <strong>{activeLivestreamClaimId ? __('Ready') : __('Waiting')}</strong>
                      </div>
                      <div className="livestream-setup__management-item">
                        <span>{__('Playback')}</span>
                        <strong>{activeLivestreamPlaybackUrl ? __('Ready') : __('Waiting')}</strong>
                      </div>
                      <div className="livestream-setup__management-item">
                        <span>{__('Preview')}</span>
                        <strong>{previewStatusLabel}</strong>
                      </div>
                    </div>
                    <LivestreamRtmpReplayRecorder
                      active={isRtmpLive && Boolean(activeLivestreamPlaybackUrl)}
                      videoUrl={activeLivestreamPlaybackUrl}
                      channelId={channelId}
                      claimId={activeLivestreamClaimId}
                      uri={activeLivestreamUri}
                      title={activeLivestreamTitle}
                      publishingReplay={Boolean(publishingReplayId)}
                      onReplaySaved={handleReplaySaved}
                      onPublishReplay={publishLocalReplay}
                    />
                    <div className="livestream-setup__replay-library" id="livestream-browser-replays">
                      <div className="livestream-setup__replay-library-header">
                        <div>
                          <h4 className="livestream-setup__replay-library-title">{__('Browser Replays')}</h4>
                          <p className="livestream-setup__replay-library-subtitle">
                            {__('Recordings saved in this browser can be uploaded as replay files.')}
                          </p>
                        </div>
                        <Button
                          button="alt"
                          icon={ICONS.REFRESH}
                          label={__('Refresh')}
                          onClick={() => setLocalReplayVersion((version) => version + 1)}
                        />
                      </div>
                      {!localReplaysLoaded && <p className="help">{__('Loading browser replays.')}</p>}
                      <div className="livestream-setup__replay-storage">
                        <div>
                          <span>{__('Browser storage')}</span>
                          <strong>{replayStorageSummary}</strong>
                          <small>{replayStoragePersistenceLabel}</small>
                        </div>
                        {canRequestReplayStoragePersistence && (
                          <Button
                            button="alt"
                            icon={ICONS.LOCK}
                            label={__('Keep recordings')}
                            onClick={keepReplayStorage}
                            disabled={requestingReplayStoragePersistence}
                          />
                        )}
                      </div>
                      {localReplaysLoaded && visibleLocalReplays.length === 0 && (
                        <p className="help">{__('No browser replays saved for this channel yet.')}</p>
                      )}
                      {visibleLocalReplays.length > 0 && (
                        <>
                          {selectedReplay && (
                            <div className="livestream-setup__replay-preview">
                              <div className="livestream-setup__replay-preview-video-wrap">
                                {replayPreviewUrl ? (
                                  <video
                                    className="livestream-setup__replay-preview-video"
                                    src={replayPreviewUrl}
                                    controls
                                    preload="metadata"
                                  />
                                ) : (
                                  <div className="livestream-setup__replay-preview-placeholder">
                                    {replayPreviewStatus === 'loading'
                                      ? __('Loading replay')
                                      : __('Replay preview unavailable')}
                                  </div>
                                )}
                              </div>
                              <div className="livestream-setup__replay-preview-meta">
                                <span>{__('Selected replay')}</span>
                                <strong>{selectedReplay.title || selectedReplay.name}</strong>
                                <small>
                                  {livestreamReplaySourceLabel(selectedReplay)} - {formatBytes(selectedReplay.size, 1)} -{' '}
                                  {formatReplayDuration(selectedReplay.durationMs)} -{' '}
                                  {formatReplayCreatedAt(selectedReplay.createdAt)}
                                </small>
                                <div className="livestream-setup__replay-preview-actions">
                                  <Button
                                    button="secondary"
                                    icon={ICONS.PUBLISH}
                                    label={publishingReplayId === selectedReplay.id ? __('Publishing...') : __('Publish')}
                                    onClick={() => publishLocalReplay(selectedReplay)}
                                    disabled={Boolean(publishingReplayId)}
                                  />
                                  <Button
                                    button="alt"
                                    icon={ICONS.DOWNLOAD}
                                    label={
                                      downloadingReplayId === selectedReplay.id ? __('Downloading...') : __('Download')
                                    }
                                    onClick={() => downloadLocalReplay(selectedReplay)}
                                    disabled={Boolean(publishingReplayId) || Boolean(downloadingReplayId)}
                                  />
                                  <Button
                                    button="alt"
                                    icon={ICONS.DELETE}
                                    label={__('Delete')}
                                    onClick={() => deleteLocalReplay(selectedReplay)}
                                    disabled={Boolean(publishingReplayId) || Boolean(downloadingReplayId)}
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                          <div className="livestream-setup__replay-list">
                            {visibleLocalReplays.slice(0, 6).map((entry) => (
                              <div
                                key={entry.id}
                                className={classnames('livestream-setup__replay-row', {
                                  'livestream-setup__replay-row--selected': selectedReplay?.id === entry.id,
                                })}
                              >
                                <div className="livestream-setup__replay-info">
                                  <strong>{entry.title || entry.name}</strong>
                                  <span>
                                    {livestreamReplaySourceLabel(entry)} - {formatBytes(entry.size, 1)} -{' '}
                                    {formatReplayDuration(entry.durationMs)} - {formatReplayCreatedAt(entry.createdAt)}
                                  </span>
                                </div>
                                <div className="livestream-setup__replay-actions">
                                  <Button
                                    button="alt"
                                    icon={ICONS.EYE}
                                    label={__('Preview')}
                                    onClick={() => setSelectedReplayId(entry.id)}
                                  />
                                  <Button
                                    button="secondary"
                                    icon={ICONS.PUBLISH}
                                    label={publishingReplayId === entry.id ? __('Publishing...') : __('Publish')}
                                    onClick={() => publishLocalReplay(entry)}
                                    disabled={Boolean(publishingReplayId)}
                                  />
                                  <Button
                                    button="alt"
                                    icon={ICONS.DOWNLOAD}
                                    label={downloadingReplayId === entry.id ? __('Downloading...') : __('Download')}
                                    onClick={() => downloadLocalReplay(entry)}
                                    disabled={Boolean(publishingReplayId) || Boolean(downloadingReplayId)}
                                  />
                                  <Button
                                    button="alt"
                                    icon={ICONS.DELETE}
                                    label={__('Delete')}
                                    onClick={() => deleteLocalReplay(entry)}
                                    disabled={Boolean(publishingReplayId) || Boolean(downloadingReplayId)}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {totalLivestreamClaims.length > 0 && (
                    <div className="livestream-setup__recent">
                      <h3 className="livestream-setup__recent-title">{__('Recent Streams')}</h3>
                      {orderedLivestreamClaims.slice(0, 5).map((c: any) => {
                        const uri = livestreamClaimUri(c);
                        const claimId = livestreamClaimId(c);
                        const selected =
                          (selectedLivestreamClaimId && claimId === selectedLivestreamClaimId) ||
                          (selectedLivestreamUri && uri === selectedLivestreamUri);
                        return uri ? (
                          <div
                            key={claimId || uri}
                            className={classnames('livestream-setup__recent-item', {
                              'livestream-setup__recent-item--selected': selected,
                            })}
                          >
                            <ClaimPreview uri={uri} />
                            <Button
                              button={selected ? 'primary' : 'alt'}
                              icon={selected ? ICONS.COMPLETE : ICONS.SETTINGS}
                              label={selected ? __('Managing') : __('Manage')}
                              onClick={() => manageLivestreamClaim(c)}
                              disabled={selected}
                            />
                          </div>
                        ) : null;
                      })}
                    </div>
                  )}

                  {totalLivestreamClaims.length === 0 && (
                    <div className="livestream-setup__no-claims">
                      <p>{__('You need to publish a livestream claim before you can stream.')}</p>
                      <div className="livestream-setup__no-claims-actions">
                        <Button
                          button="primary"
                          onClick={() => createNewLivestream()}
                          label={__('Create a Livestream')}
                        />
                        <Button
                          button="alt"
                          onClick={() => dispatch(doFetchNoSourceClaimsForChannelId(channelId))}
                          label={__('Refresh')}
                          icon={ICONS.REFRESH}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </Page>
  );
}
