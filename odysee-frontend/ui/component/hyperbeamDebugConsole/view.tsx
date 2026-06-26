import React from 'react';
import {
  addHyperbeamDebugListener,
  hyperbeamDebugColor,
  installHyperbeamFetchDebug,
  sanitizeHyperbeamDebugValue,
  sanitizeHyperbeamDebugUrl,
  type HyperbeamDebugEvent,
} from 'util/hyperbeamDebug';
import { ODYSEE_HYPERBEAM_NODE_API } from 'config';
import { getHyperbeamMode, HYPERBEAM_MODES, setHyperbeamMode, type HyperbeamMode } from 'util/hyperbeamMode';
import {
  hasHyperbeamLegacyAuthToken,
  hyperbeamLegacyAuthDemoToken,
  hyperbeamLegacyAuthTrust,
  installHyperbeamLegacyAuthDemoGlobal,
  isLegacyAuthRejected,
  normalizeLegacyAuthToken,
  rememberHyperbeamLegacyAuthDemoToken,
  runHyperbeamCallDemo,
  runHyperbeamLegacyAuthUploadDemo,
  type LegacyAuthTrust,
} from 'util/hyperbeamLegacyAuth';
import { doHyperbeamLegacyAuthSignIn } from 'redux/actions/user';
import { useAppDispatch, useAppSelector } from 'redux/hooks';
import { selectUserVerifiedEmail } from 'redux/selectors/user';
import ClaimTrace from './claimTrace';

const MAX_EVENTS = 1200;
const MAX_RELEVANT_EVENTS = 24;
const FILTERS = [
  { key: 'get', label: 'get', color: 'rgba(255,255,255,0.76)' },
  { key: 'failed', label: 'failed', color: '#ff4d7d' },
  { key: 'original', label: 'original', color: '#94a3b8' },
  { key: 'native-device', label: 'native-device', color: '#0ea5e9' },
  { key: 'native:sdk-proxy', label: 'native:sdk-proxy', color: '#a78bfa' },
  { key: 'legacy-auth', label: 'legacy-auth', color: '#22c55e' },
  { key: 'fallback', label: 'fallback', color: '#ffb020' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];
type ConsoleTab = 'trace' | 'requests';

export default function HyperbeamDebugConsole() {
  const dispatch = useAppDispatch();
  const authenticated = useAppSelector(selectUserVerifiedEmail);
  const [open, setOpen] = React.useState(false);
  const [maximized, setMaximized] = React.useState(false);
  const [mode, setMode] = React.useState<HyperbeamMode>(() => getHyperbeamMode());
  const [activeTab, setActiveTab] = React.useState<ConsoleTab>('trace');
  const [events, setEvents] = React.useState<Array<HyperbeamDebugEvent>>([]);
  const [filterCounts, setFilterCounts] = React.useState<Record<FilterKey, number>>(() => emptyFilterCounts());
  const [expanded, setExpanded] = React.useState<Record<number, boolean>>({});
  const [activeFilters, setActiveFilters] = React.useState<Set<FilterKey>>(() => new Set());
  const [copied, setCopied] = React.useState(false);
  const [copiedRelevant, setCopiedRelevant] = React.useState(false);
  const [legacyAuthTokenInput, setLegacyAuthTokenInput] = React.useState('');
  const [legacyUploadChannelIdInput, setLegacyUploadChannelIdInput] = React.useState('');
  const [legacyUploadChannelNameInput, setLegacyUploadChannelNameInput] = React.useState('');
  const [legacyUploadTitleInput, setLegacyUploadTitleInput] = React.useState('Native HyperBEAM upload');
  const [legacyUploadDescriptionInput, setLegacyUploadDescriptionInput] = React.useState(
    'Stored directly in the HyperBEAM native upload store'
  );
  const [legacyUploadTagsInput, setLegacyUploadTagsInput] = React.useState('hyperbeam,native');
  const [legacyUploadThumbnailInput, setLegacyUploadThumbnailInput] = React.useState('');
  const [legacyAuthRunning, setLegacyAuthRunning] = React.useState(false);
  const [legacyAuthResult, setLegacyAuthResult] = React.useState<any>(null);
  const [legacyAuthError, setLegacyAuthError] = React.useState<string | null>(null);
  const [legacyUploadRunning, setLegacyUploadRunning] = React.useState(false);
  const [legacyUploadFile, setLegacyUploadFile] = React.useState<File | null>(null);
  const [legacyUploadResult, setLegacyUploadResult] = React.useState<any>(null);
  const [legacyUploadError, setLegacyUploadError] = React.useState<string | null>(null);
  const [callDemoRunning, setCallDemoRunning] = React.useState(false);
  const [callDemoResult, setCallDemoResult] = React.useState<any>(null);
  const [callDemoError, setCallDemoError] = React.useState<string | null>(null);
  const logRef = React.useRef<HTMLDivElement | null>(null);
  const legacyAuthTokenInputRef = React.useRef<HTMLInputElement | null>(null);
  const legacyAuthBootstrapped = React.useRef(false);
  const clearLegacyAuthTokenInput = React.useCallback(() => {
    setLegacyAuthTokenInput('');
    if (legacyAuthTokenInputRef.current) {
      legacyAuthTokenInputRef.current.value = '';
    }
    rememberHyperbeamLegacyAuthDemoToken('');
  }, []);

  React.useEffect(() => {
    installHyperbeamFetchDebug();
    installHyperbeamLegacyAuthDemoGlobal();
    return addHyperbeamDebugListener((event) => {
      setFilterCounts((current) => incrementFilterCounts(current, event));
      setEvents((current) => {
        const key = eventKey(event);
        const existingIndex = current.findLastIndex((currentEvent) => eventKey(currentEvent) === key);
        if (existingIndex !== -1) {
          const existing = current[existingIndex];
          const next = [...current];
          next[existingIndex] = {
            ...event,
            data: {
              ...event.data,
              repeatCount: Number(existing.data?.repeatCount || 1) + 1,
              firstSeen: existing.data?.firstSeen || existing.time,
              lastSeen: event.time,
            },
          };
          return next;
        }

        return [...current.slice(-(MAX_EVENTS - 1)), event];
      });
    });
  }, []);

  React.useEffect(() => {
    if (!open || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events, open]);

  React.useEffect(() => {
    if (legacyAuthBootstrapped.current || authenticated || !hyperbeamLegacyAuthTrust().allowed) return;
    if (!hasHyperbeamLegacyAuthToken()) return;

    const authToken = hyperbeamLegacyAuthDemoToken();
    if (!authToken) return;

    legacyAuthBootstrapped.current = true;
    setLegacyAuthRunning(true);
    setLegacyAuthError(null);
    dispatch(doHyperbeamLegacyAuthSignIn(authToken) as any)
      .then((result) => {
        setLegacyAuthResult(result);
      })
      .catch((error: any) => {
        if (isLegacyAuthRejected(error)) {
          clearLegacyAuthTokenInput();
        }
        setLegacyAuthResult(error?.result || error?.body || null);
        setLegacyAuthError(String(error?.message || error));
      })
      .finally(() => setLegacyAuthRunning(false));
  }, [authenticated, clearLegacyAuthTokenInput, dispatch]);

  if (!ODYSEE_HYPERBEAM_NODE_API) return null;

  const legacyAuthTrust = hyperbeamLegacyAuthTrust();
  const last = events[events.length - 1];
  const visibleEvents =
    activeFilters.size === 0
      ? events
      : events.filter((event) =>
          FILTERS.some((filter) => activeFilters.has(filter.key) && eventMatchesFilter(event, filter.key))
        );

  const toggleFilter = (filter: FilterKey) => {
    setActiveFilters((current) => {
      const next = new Set(current);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  };

  const copyEvents = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const text = JSON.stringify(events, null, 2);
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => setCopied(false));
  };
  const copyRelevantEvents = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const text = JSON.stringify(
      {
        type: 'odysee_request_events',
        node: mode === HYPERBEAM_MODES.original ? undefined : String(ODYSEE_HYPERBEAM_NODE_API).replace(/\/+$/, ''),
        mode,
        generatedAt: new Date().toISOString(),
        events: relevantEvents(events, mode),
      },
      null,
      2
    );
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopiedRelevant(true);
        window.setTimeout(() => setCopiedRelevant(false), 1200);
      })
      .catch(() => setCopiedRelevant(false));
  };
  const onModeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextMode = event.currentTarget.value as HyperbeamMode;
    setMode(nextMode);
    setHyperbeamMode(nextMode);
    setEvents([]);
    setFilterCounts(emptyFilterCounts());
    window.location.reload();
  };
  const currentLegacyAuthTokenInput = React.useCallback(() => {
    const inputToken = legacyAuthTokenInput || legacyAuthTokenInputRef.current?.value || '';
    const authToken = inputToken || hyperbeamLegacyAuthDemoToken();
    if (inputToken && inputToken !== legacyAuthTokenInput) {
      setLegacyAuthTokenInput(inputToken);
    }
    if (inputToken) {
      rememberHyperbeamLegacyAuthDemoToken(inputToken);
    }
    return authToken || undefined;
  }, [legacyAuthTokenInput]);
  const runLegacyAuthDemo = () => {
    const authToken = currentLegacyAuthTokenInput();
    runLegacyAuthSignIn(authToken);
  };
  const runLegacyAuthSignIn = (authToken?: string) => {
    setLegacyAuthRunning(true);
    setLegacyAuthError(null);
    dispatch(doHyperbeamLegacyAuthSignIn(authToken) as any)
      .then((result) => {
        setLegacyAuthResult(result);
      })
      .catch((error: any) => {
        if (isLegacyAuthRejected(error)) {
          clearLegacyAuthTokenInput();
        }
        setLegacyAuthResult(error?.result || error?.body || null);
        setLegacyAuthError(String(error?.message || error));
      })
      .finally(() => setLegacyAuthRunning(false));
  };
  const pasteLegacyAuthToken = React.useCallback(
    (value: string) => {
      const authToken = normalizeLegacyAuthToken(value);
      if (!authToken) return;
      setLegacyAuthTokenInput(authToken);
      rememberHyperbeamLegacyAuthDemoToken(authToken);
      runLegacyAuthSignIn(authToken);
    },
    [dispatch]
  );
  const runLegacyAuthUploadDemo = () => {
    const authToken = currentLegacyAuthTokenInput();
    setLegacyUploadRunning(true);
    setLegacyUploadError(null);
    runHyperbeamLegacyAuthUploadDemo({
      authToken,
      channelId: legacyUploadChannelIdInput || undefined,
      channelName: legacyUploadChannelNameInput || undefined,
      description: legacyUploadDescriptionInput || undefined,
      legacyClaimIds: ['legacy-demo-claim-a', 'legacy-demo-claim-b'],
      file: legacyUploadFile,
      tags: legacyUploadTagsInput || undefined,
      thumbnailUrl: legacyUploadThumbnailInput || undefined,
      title: legacyUploadTitleInput || undefined,
    })
      .then((result) => {
        setLegacyUploadResult(result);
      })
      .catch((error: any) => {
        if (isLegacyAuthRejected(error)) {
          clearLegacyAuthTokenInput();
        }
        setLegacyUploadResult(error?.result || error?.body || null);
        setLegacyUploadError(String(error?.message || error));
      })
      .finally(() => setLegacyUploadRunning(false));
  };
  const runCallDemo = () => {
    const authToken = currentLegacyAuthTokenInput();
    setCallDemoRunning(true);
    setCallDemoError(null);
    runHyperbeamCallDemo({
      authToken,
      description: legacyUploadDescriptionInput || undefined,
      file: legacyUploadFile,
      tags: legacyUploadTagsInput || undefined,
      thumbnailUrl: legacyUploadThumbnailInput || undefined,
      title: legacyUploadTitleInput || undefined,
    })
      .then((result) => {
        setCallDemoResult(result);
        setLegacyAuthResult(result.auth);
        setLegacyUploadResult({
          upload: result.upload,
          channel: result.channel,
          readback: result.readback,
          nativeClaim: result.nativeClaim,
        });
        if (result.selectedChannel?.claim_id) setLegacyUploadChannelIdInput(result.selectedChannel.claim_id);
        if (result.selectedChannel?.name) setLegacyUploadChannelNameInput(result.selectedChannel.name);
      })
      .catch((error: any) => {
        if (isLegacyAuthRejected(error)) {
          clearLegacyAuthTokenInput();
        }
        setCallDemoResult(error?.result || error?.body || null);
        setCallDemoError(String(error?.message || error));
      })
      .finally(() => setCallDemoRunning(false));
  };
  const updateLegacyAuthTokenInput = React.useCallback((value: string) => {
    setLegacyAuthTokenInput(value);
    rememberHyperbeamLegacyAuthDemoToken(value);
  }, []);

  return (
    <div
      data-hyperbeam-debug-console
      style={{
        position: 'fixed',
        right: maximized ? 8 : 12,
        bottom: maximized ? 8 : 12,
        top: maximized ? 8 : undefined,
        left: maximized ? 8 : undefined,
        zIndex: 100000,
        width: maximized ? 'auto' : open ? 720 : 'auto',
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: maximized ? 'calc(100vh - 16px)' : '58vh',
        height: maximized ? 'calc(100vh - 16px)' : undefined,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 6,
        border: '1px solid rgba(222, 0, 80, 0.62)',
        background: 'rgba(12, 10, 12, 0.95)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        color: '#f9fafb',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.35,
        boxShadow: '0 12px 34px rgba(0,0,0,0.46), 0 0 28px rgba(222,0,80,0.2)',
      }}
    >
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          boxSizing: 'border-box',
          padding: '0 8px 0 0',
          background: 'linear-gradient(90deg, rgba(222,0,80,0.42), rgba(222,0,80,0.12))',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            border: 0,
            padding: '8px 10px',
            background: 'transparent',
            color: '#f9fafb',
            textAlign: 'left',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Odysee request log {open ? 'hide' : 'show'}
          {!open && last ? ` · ${last.label} · ${last.level}` : ''}
        </button>
        {open && (
          <div style={{ display: 'flex', gap: 4, flex: '0 0 auto' }}>
            <TabButton active={activeTab === 'trace'} onClick={() => setActiveTab('trace')}>
              Trace
            </TabButton>
            <TabButton active={activeTab === 'requests'} onClick={() => setActiveTab('requests')}>
              Requests {events.length}
            </TabButton>
          </div>
        )}
        <select
          value={mode}
          onClick={(event) => event.stopPropagation()}
          onChange={onModeChange}
          title="Select request wiring mode"
          style={{
            width: 88,
            height: 18,
            border: '1px solid rgba(255,255,255,0.28)',
            borderRadius: 4,
            padding: '0 2px',
            background: 'rgba(12,10,12,0.96)',
            color: '#f9fafb',
            fontSize: 10,
            lineHeight: 1,
          }}
        >
          <option value={HYPERBEAM_MODES.original}>Original</option>
          <option value={HYPERBEAM_MODES.hyperbeam}>HyperBEAM</option>
        </select>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
            setMaximized((value) => !value);
          }}
          title={maximized ? 'Restore console' : 'Maximize console'}
          style={headerIconButtonStyle}
        >
          {maximized ? 'restore' : 'maximize'}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(false);
            setMaximized(false);
          }}
          title="Minimize console"
          style={headerIconButtonStyle}
        >
          minimize
        </button>
      </div>
      {open && (
        <>
          <div style={{ padding: '8px 9px 0' }}>
            <div style={{ overflowWrap: 'anywhere', marginBottom: 8, color: 'rgba(255,255,255,0.72)' }}>
              {modeEndpointLabel(mode)}
            </div>
            <LegacyAuthDemoPanel
              error={legacyAuthError}
              uploadError={legacyUploadError}
              uploadFile={legacyUploadFile}
              uploadResult={legacyUploadResult}
              uploadRunning={legacyUploadRunning}
              callDemoError={callDemoError}
              callDemoResult={callDemoResult}
              callDemoRunning={callDemoRunning}
              result={legacyAuthResult}
              running={legacyAuthRunning}
              channelIdValue={legacyUploadChannelIdInput}
              channelNameValue={legacyUploadChannelNameInput}
              descriptionValue={legacyUploadDescriptionInput}
              tagsValue={legacyUploadTagsInput}
              thumbnailValue={legacyUploadThumbnailInput}
              titleValue={legacyUploadTitleInput}
              tokenValue={legacyAuthTokenInput}
              trust={legacyAuthTrust}
              tokenInputRef={legacyAuthTokenInputRef}
              onFileChange={setLegacyUploadFile}
              onRun={runLegacyAuthDemo}
              onRunCallDemo={runCallDemo}
              onRunUpload={runLegacyAuthUploadDemo}
              onChannelIdChange={setLegacyUploadChannelIdInput}
              onChannelNameChange={setLegacyUploadChannelNameInput}
              onDescriptionChange={setLegacyUploadDescriptionInput}
              onTagsChange={setLegacyUploadTagsInput}
              onThumbnailChange={setLegacyUploadThumbnailInput}
              onTitleChange={setLegacyUploadTitleInput}
              onTokenChange={updateLegacyAuthTokenInput}
              onTokenPaste={pasteLegacyAuthToken}
            />
          </div>
          {activeTab === 'trace' && <ClaimTrace events={events} />}
          {activeTab === 'requests' && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 9px 8px' }}>
                {FILTERS.map((filter) => {
                  const active = activeFilters.has(filter.key);
                  const disabled = filterDisabledInMode(filter.key, mode);
                  return (
                    <button
                      key={filter.key}
                      type="button"
                      disabled={disabled}
                      onClick={() => !disabled && toggleFilter(filter.key)}
                      title={
                        disabled
                          ? `${filter.label} disabled in ${modeLabel(mode)}`
                          : active
                            ? `Remove ${filter.label} filter`
                            : `Filter ${filter.label}`
                      }
                      style={{
                        border: `1px solid ${
                          disabled ? 'rgba(255,255,255,0.12)' : active ? filter.color : 'rgba(255,255,255,0.22)'
                        }`,
                        borderRadius: 4,
                        padding: '1px 6px',
                        background: disabled
                          ? 'rgba(255,255,255,0.025)'
                          : active
                            ? 'rgba(255,255,255,0.12)'
                            : 'rgba(255,255,255,0.05)',
                        color: disabled ? 'rgba(255,255,255,0.28)' : filter.color,
                        cursor: disabled ? 'default' : 'pointer',
                        font: 'inherit',
                        textDecoration: disabled ? 'line-through' : 'none',
                      }}
                    >
                      {filter.label} {filterCounts[filter.key] || 0}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={copyEvents}
                  disabled={events.length === 0}
                  title="Copy HyperBEAM log"
                  style={{
                    marginLeft: 'auto',
                    border: '1px solid rgba(255,255,255,0.28)',
                    borderRadius: 4,
                    padding: '1px 6px',
                    background: copied ? '#de0050' : 'rgba(255,255,255,0.08)',
                    color: '#f9fafb',
                    cursor: events.length === 0 ? 'default' : 'pointer',
                    font: 'inherit',
                    opacity: events.length === 0 ? 0.55 : 1,
                  }}
                >
                  {copied ? 'copied' : 'copy'}
                </button>
                <button
                  type="button"
                  onClick={copyRelevantEvents}
                  disabled={events.length === 0}
                  title="Copy only the entries needed for debugging"
                  style={{
                    border: '1px solid rgba(255,255,255,0.28)',
                    borderRadius: 4,
                    padding: '1px 6px',
                    background: copiedRelevant ? '#de0050' : 'rgba(255,255,255,0.08)',
                    color: '#f9fafb',
                    cursor: events.length === 0 ? 'default' : 'pointer',
                    font: 'inherit',
                    opacity: events.length === 0 ? 0.55 : 1,
                  }}
                >
                  {copiedRelevant ? 'copied' : 'copy fix'}
                </button>
              </div>
              <div ref={logRef} style={{ padding: '0 9px 9px', minHeight: 0, overflow: 'auto' }}>
                {events.length === 0 && (
                  <div style={{ color: 'rgba(255,255,255,0.62)' }}>waiting for {modeWaitLabel(mode)} calls</div>
                )}
                {events.length !== 0 && visibleEvents.length === 0 && (
                  <div style={{ color: 'rgba(255,255,255,0.62)' }}>no calls match the active filters</div>
                )}
                {visibleEvents.map((event) => {
                  const index = events.indexOf(event);
                  const isExpanded = expanded[index];
                  return (
                    <div key={`${event.time}-${event.label}-${index}`} style={{ marginTop: 4 }}>
                      <button
                        type="button"
                        onClick={() => setExpanded((current) => ({ ...current, [index]: !current[index] }))}
                        style={{
                          width: '100%',
                          border: 0,
                          padding: '2px 0',
                          background: 'transparent',
                          color: 'rgba(255,255,255,0.84)',
                          cursor: 'pointer',
                          font: 'inherit',
                          textAlign: 'left',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <strong
                          style={{
                            color: eventColor(event),
                          }}
                        >
                          {isExpanded ? '-' : '+'}
                        </strong>{' '}
                        <strong
                          style={{
                            color: eventColor(event),
                          }}
                        >
                          {event.time}
                        </strong>{' '}
                        {event.label} {eventSummary(event, mode)}
                      </button>
                      {isExpanded && event.data !== undefined && (
                        <pre style={{ margin: '3px 0 0', whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.78)' }}>
                          {JSON.stringify(event.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const headerIconButtonStyle = {
  flex: '0 0 auto',
  height: 18,
  border: '1px solid rgba(255,255,255,0.28)',
  borderRadius: 4,
  padding: '0 6px',
  background: 'rgba(255,255,255,0.08)',
  color: '#f9fafb',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 10,
  lineHeight: 1,
} as const;

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${active ? 'rgba(14,165,233,0.68)' : 'rgba(255,255,255,0.18)'}`,
        borderRadius: 4,
        padding: '2px 8px',
        background: active ? 'rgba(14,165,233,0.2)' : 'rgba(255,255,255,0.045)',
        color: active ? '#e0f2fe' : 'rgba(255,255,255,0.72)',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function LegacyAuthDemoPanel({
  error,
  uploadError,
  uploadFile,
  uploadResult,
  uploadRunning,
  callDemoError,
  callDemoResult,
  callDemoRunning,
  result,
  running,
  channelIdValue,
  channelNameValue,
  descriptionValue,
  tagsValue,
  thumbnailValue,
  titleValue,
  tokenValue,
  trust,
  tokenInputRef,
  onFileChange,
  onRun,
  onRunCallDemo,
  onRunUpload,
  onChannelIdChange,
  onChannelNameChange,
  onDescriptionChange,
  onTagsChange,
  onThumbnailChange,
  onTitleChange,
  onTokenChange,
  onTokenPaste,
}: {
  error: string | null;
  uploadError: string | null;
  uploadFile: File | null;
  uploadResult: any;
  uploadRunning: boolean;
  callDemoError: string | null;
  callDemoResult: any;
  callDemoRunning: boolean;
  result: any;
  running: boolean;
  channelIdValue: string;
  channelNameValue: string;
  descriptionValue: string;
  tagsValue: string;
  thumbnailValue: string;
  titleValue: string;
  tokenValue: string;
  trust: LegacyAuthTrust;
  tokenInputRef: React.Ref<HTMLInputElement>;
  onFileChange: (file: File | null) => void;
  onRun: () => void;
  onRunCallDemo: () => void;
  onRunUpload: () => void;
  onChannelIdChange: (value: string) => void;
  onChannelNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onThumbnailChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onTokenPaste: (value: string) => void;
}) {
  return (
    <div
      style={{
        marginBottom: 8,
        padding: '7px 8px',
        border: '1px solid rgba(255,255,255,0.16)',
        borderRadius: 4,
        background: 'rgba(255,255,255,0.045)',
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 7 }}>
        <input
          ref={tokenInputRef}
          type="password"
          value={tokenValue}
          onChange={(event) => onTokenChange(event.currentTarget.value)}
          onPaste={(event) => {
            event.preventDefault();
            onTokenPaste(event.clipboardData.getData('text'));
          }}
          placeholder="optional auth token"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: '1 1 180px',
            minWidth: 0,
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            padding: '3px 6px',
            background: 'rgba(12,10,12,0.72)',
            color: '#f9fafb',
            font: 'inherit',
          }}
        />
        <input
          type="file"
          onChange={(event) => onFileChange(event.currentTarget.files?.[0] || null)}
          title={uploadFile ? uploadFile.name : 'Choose upload demo file'}
          style={{
            flex: '0 1 220px',
            minWidth: 150,
            color: 'rgba(255,255,255,0.72)',
            font: 'inherit',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 7 }}>
        <input
          type="text"
          value={channelIdValue}
          onChange={(event) => onChannelIdChange(event.currentTarget.value)}
          placeholder="native channel id"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: '1 1 180px',
            minWidth: 0,
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            padding: '3px 6px',
            background: 'rgba(12,10,12,0.72)',
            color: '#f9fafb',
            font: 'inherit',
          }}
        />
        <input
          type="text"
          value={channelNameValue}
          onChange={(event) => onChannelNameChange(event.currentTarget.value)}
          placeholder="channel name"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: '1 1 160px',
            minWidth: 0,
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            padding: '3px 6px',
            background: 'rgba(12,10,12,0.72)',
            color: '#f9fafb',
            font: 'inherit',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 7 }}>
        <input
          type="text"
          value={titleValue}
          onChange={(event) => onTitleChange(event.currentTarget.value)}
          placeholder="upload title"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: '1 1 180px',
            minWidth: 0,
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            padding: '3px 6px',
            background: 'rgba(12,10,12,0.72)',
            color: '#f9fafb',
            font: 'inherit',
          }}
        />
        <input
          type="text"
          value={tagsValue}
          onChange={(event) => onTagsChange(event.currentTarget.value)}
          placeholder="tags"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: '0 1 180px',
            minWidth: 120,
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            padding: '3px 6px',
            background: 'rgba(12,10,12,0.72)',
            color: '#f9fafb',
            font: 'inherit',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 7 }}>
        <input
          type="text"
          value={descriptionValue}
          onChange={(event) => onDescriptionChange(event.currentTarget.value)}
          placeholder="description"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: '1 1 240px',
            minWidth: 0,
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            padding: '3px 6px',
            background: 'rgba(12,10,12,0.72)',
            color: '#f9fafb',
            font: 'inherit',
          }}
        />
        <input
          type="url"
          value={thumbnailValue}
          onChange={(event) => onThumbnailChange(event.currentTarget.value)}
          placeholder="thumbnail url"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: '1 1 180px',
            minWidth: 0,
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 4,
            padding: '3px 6px',
            background: 'rgba(12,10,12,0.72)',
            color: '#f9fafb',
            font: 'inherit',
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ color: trust.allowed ? '#86efac' : '#ffb020' }}>{trust.label}</strong>
        <span style={{ color: 'rgba(255,255,255,0.66)', overflowWrap: 'anywhere' }}>{trust.node}</span>
        <button
          type="button"
          disabled={running || !trust.allowed}
          onClick={onRun}
          title={trust.allowed ? 'Run legacy auth through the configured HyperBEAM node' : trust.reason}
          style={{
            marginLeft: 'auto',
            border: `1px solid ${trust.allowed ? 'rgba(34,197,94,0.68)' : 'rgba(255,255,255,0.14)'}`,
            borderRadius: 4,
            padding: '2px 8px',
            background: trust.allowed ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.035)',
            color: trust.allowed ? '#dcfce7' : 'rgba(255,255,255,0.36)',
            cursor: running || !trust.allowed ? 'default' : 'pointer',
            font: 'inherit',
          }}
        >
          {running ? 'signing in' : 'sign in with token'}
        </button>
        <button
          type="button"
          disabled={uploadRunning || !trust.allowed}
          onClick={onRunUpload}
          title={trust.allowed ? 'Upload a small file through the configured HyperBEAM node' : trust.reason}
          style={{
            border: `1px solid ${trust.allowed ? 'rgba(14,165,233,0.68)' : 'rgba(255,255,255,0.14)'}`,
            borderRadius: 4,
            padding: '2px 8px',
            background: trust.allowed ? 'rgba(14,165,233,0.16)' : 'rgba(255,255,255,0.035)',
            color: trust.allowed ? '#e0f2fe' : 'rgba(255,255,255,0.36)',
            cursor: uploadRunning || !trust.allowed ? 'default' : 'pointer',
            font: 'inherit',
          }}
        >
          {uploadRunning ? 'uploading' : 'upload demo'}
        </button>
        <button
          type="button"
          disabled={callDemoRunning || !trust.allowed}
          onClick={onRunCallDemo}
          title={trust.allowed ? 'Run the tomorrow call demo sequence' : trust.reason}
          style={{
            border: `1px solid ${trust.allowed ? 'rgba(250,204,21,0.68)' : 'rgba(255,255,255,0.14)'}`,
            borderRadius: 4,
            padding: '2px 8px',
            background: trust.allowed ? 'rgba(250,204,21,0.14)' : 'rgba(255,255,255,0.035)',
            color: trust.allowed ? '#fef9c3' : 'rgba(255,255,255,0.36)',
            cursor: callDemoRunning || !trust.allowed ? 'default' : 'pointer',
            font: 'inherit',
          }}
        >
          {callDemoRunning ? 'running demo' : 'run call demo'}
        </button>
      </div>
      <div style={{ marginTop: 4, color: 'rgba(255,255,255,0.62)', overflowWrap: 'anywhere' }}>{trust.reason}</div>
      {error && <div style={{ marginTop: 6, color: '#ff8aa8', overflowWrap: 'anywhere' }}>{error}</div>}
      {result && (
        <pre
          style={{
            maxHeight: 170,
            overflow: 'auto',
            margin: '7px 0 0',
            whiteSpace: 'pre-wrap',
            color: 'rgba(255,255,255,0.78)',
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      {uploadError && <div style={{ marginTop: 6, color: '#ff8aa8', overflowWrap: 'anywhere' }}>{uploadError}</div>}
      {uploadResult && (
        <pre
          style={{
            maxHeight: 170,
            overflow: 'auto',
            margin: '7px 0 0',
            whiteSpace: 'pre-wrap',
            color: 'rgba(255,255,255,0.78)',
          }}
        >
          {JSON.stringify(uploadResult, null, 2)}
        </pre>
      )}
      {callDemoError && <div style={{ marginTop: 6, color: '#ff8aa8', overflowWrap: 'anywhere' }}>{callDemoError}</div>}
      {callDemoResult?.checks && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
          {Object.entries(callDemoResult.checks).map(([key, value]) => (
            <span
              key={key}
              style={{
                border: `1px solid ${value ? 'rgba(34,197,94,0.58)' : 'rgba(255,77,125,0.58)'}`,
                borderRadius: 4,
                padding: '1px 5px',
                color: value ? '#bbf7d0' : '#ffb3c5',
                background: value ? 'rgba(34,197,94,0.1)' : 'rgba(255,77,125,0.1)',
              }}
            >
              {key}: {value ? 'ok' : 'check'}
            </span>
          ))}
        </div>
      )}
      {callDemoResult && (
        <pre
          style={{
            maxHeight: 220,
            overflow: 'auto',
            margin: '7px 0 0',
            whiteSpace: 'pre-wrap',
            color: 'rgba(255,255,255,0.78)',
          }}
        >
          {JSON.stringify(callDemoResult, null, 2)}
        </pre>
      )}
    </div>
  );
}

function eventColor(event: HyperbeamDebugEvent) {
  if (event.label === 'request') return hyperbeamDebugColor('info');
  return hyperbeamDebugColor(event.level, event.data?.sourceLayer || event.data?.deviceLayer);
}

function eventSummary(event: HyperbeamDebugEvent, mode: HyperbeamMode) {
  const data = event.data || {};
  const bits = [
    mode,
    data.repeatCount ? `x${data.repeatCount}` : undefined,
    data.method,
    data.status ? String(data.status) : undefined,
    data.deviceLayer,
    data.sourceLayer,
    data.elapsedMs !== undefined ? `${data.elapsedMs}ms` : undefined,
    data.devicePath,
  ].filter(Boolean);
  return bits.length ? `- ${bits.join(' ')}` : '';
}

function modeLabel(mode: HyperbeamMode) {
  switch (mode) {
    case HYPERBEAM_MODES.original:
      return 'Original wiring';
    case HYPERBEAM_MODES.hyperbeam:
      return 'HyperBEAM wiring';
    default:
      return mode;
  }
}

function modeEndpointLabel(mode: HyperbeamMode) {
  if (mode === HYPERBEAM_MODES.original) return `${modeLabel(mode)} · normal Odysee/API calls`;
  return `${modeLabel(mode)} · authed calls and public devices through ${String(ODYSEE_HYPERBEAM_NODE_API).replace(
    /\/+$/,
    ''
  )}; original fallback disabled`;
}

function modeWaitLabel(mode: HyperbeamMode) {
  return mode === HYPERBEAM_MODES.original ? 'Original' : 'HyperBEAM';
}

function filterDisabledInMode(filter: FilterKey, mode: HyperbeamMode) {
  if (mode === HYPERBEAM_MODES.original) {
    return filter !== 'get' && filter !== 'failed' && filter !== 'original' && filter !== 'legacy-auth';
  }

  return false;
}

function emptyFilterCounts(): Record<FilterKey, number> {
  return FILTERS.reduce((counts, filter) => ({ ...counts, [filter.key]: 0 }), {} as Record<FilterKey, number>);
}

function incrementFilterCounts(
  current: Record<FilterKey, number>,
  event: HyperbeamDebugEvent
): Record<FilterKey, number> {
  let next = current;
  FILTERS.forEach((filter) => {
    if (eventMatchesFilter(event, filter.key)) {
      if (next === current) next = { ...current };
      next[filter.key] = Number(next[filter.key] || 0) + 1;
    }
  });
  return next;
}

function eventMatchesFilter(event: HyperbeamDebugEvent, filter: FilterKey) {
  const data = event.data || {};
  const label = String(event.label || '').toLowerCase();
  const device = String(data.device || '');
  const devicePath = String(data.devicePath || '');
  const sourceLayer = String(data.sourceLayer || '');
  const deviceLayer = String(data.deviceLayer || '');
  const isPlainRequest = event.label === 'request';

  switch (filter) {
    case 'failed':
      return (
        event.level === 'error' ||
        data.ok === false ||
        Number(data.status) >= 400 ||
        sourceLayer === 'native-missing' ||
        sourceLayer === 'native-failed'
      );
    case 'get':
      return String(data.method || '').toUpperCase() === 'GET';
    case 'original':
      if (isPlainRequest) return false;
      return sourceLayer === 'original';
    case 'native-device':
      if (isPlainRequest) return false;
      return deviceLayer === 'native-device';
    case 'legacy-auth':
      return (
        label.includes('legacy auth') ||
        device === '~odysee-legacy-auth@1.0' ||
        device === '~odysee-upload-demo@1.0' ||
        devicePath.includes('~odysee-legacy-auth@1.0') ||
        devicePath.includes('~odysee-upload-demo@1.0')
      );
    case 'fallback':
      if (isPlainRequest) return false;
      return sourceLayer.startsWith('fallback') || sourceLayer === 'device:fallback';
    case 'native:sdk-proxy':
      if (isPlainRequest) return false;
      return sourceLayer === 'native:sdk-proxy';
    default:
      return false;
  }
}

function eventKey(event: HyperbeamDebugEvent) {
  const data = event.data || {};
  const body = data.body || {};
  return JSON.stringify({
    label: event.label,
    level: event.level,
    method: data.method,
    status: data.status,
    ok: data.ok,
    pagePath: data.pagePath,
    devicePath: data.devicePath,
    device: data.device,
    deviceLayer: data.deviceLayer,
    sourceLayer: data.sourceLayer,
    sourceReason: data.sourceReason,
    reason: body.reason,
    kind: body.kind,
    key: body.key,
  });
}

function relevantEvents(events: Array<HyperbeamDebugEvent>, mode: HyperbeamMode) {
  const relevantIndexes = new Set<number>();

  events.forEach((event, index) => {
    if (isRelevant(event)) {
      relevantIndexes.add(index);
      const previous = events[index - 1];
      if (previous?.label === 'request') relevantIndexes.add(index - 1);
    }
  });

  return events
    .filter((_event, index) => relevantIndexes.has(index))
    .slice(-MAX_RELEVANT_EVENTS)
    .map((event) => compactEvent(event, mode));
}

function isRelevant(event: HyperbeamDebugEvent) {
  const data = event.data || {};
  const status = Number(data.status);
  const label = String(event.label || '').toLowerCase();
  const device = String(data.device || '');
  const devicePath = String(data.devicePath || '');
  const sourceLayer = String(data.sourceLayer || '');
  const deviceLayer = String(data.deviceLayer || '');
  return (
    event.level === 'error' ||
    data.ok === false ||
    status >= 400 ||
    sourceLayer === 'native:sdk-proxy' ||
    sourceLayer === 'native-device' ||
    deviceLayer === 'native-device' ||
    label.includes('legacy auth') ||
    device === '~odysee-legacy-auth@1.0' ||
    device === '~odysee-upload-demo@1.0' ||
    devicePath.includes('~odysee-legacy-auth@1.0') ||
    devicePath.includes('~odysee-upload-demo@1.0') ||
    sourceLayer.startsWith('fallback') ||
    sourceLayer === 'native-missing' ||
    sourceLayer === 'native-failed' ||
    sourceLayer === 'unknown' ||
    data.sourceReason === 'native_source_required'
  );
}

function compactEvent(event: HyperbeamDebugEvent, mode: HyperbeamMode) {
  const data = event.data || {};
  const body = data.body;
  return pruneEmpty({
    mode,
    time: event.time,
    firstSeen: data.firstSeen,
    lastSeen: data.lastSeen,
    repeatCount: data.repeatCount,
    label: event.label,
    level: event.level,
    method: data.method,
    status: data.status,
    ok: data.ok,
    device: data.device,
    deviceLayer: data.deviceLayer,
    sourceLayer: data.sourceLayer,
    sourceReason: data.sourceReason,
    elapsedMs: data.elapsedMs,
    devicePath: compactPath(data.devicePath),
    url: data.url ? limitString(sanitizeHyperbeamDebugUrl(String(data.url)), 360) : undefined,
    bodyBytes: data.bodyBytes,
    contentType: data.contentType,
    response: compactBody(body),
  });
}

function compactBody(body: any) {
  body = sanitizeHyperbeamDebugValue(body);
  if (body === undefined || body === null) return undefined;
  if (typeof body !== 'object') return limitString(String(body), 1200);

  return pruneEmpty({
    status: body.status,
    reason: body.reason,
    kind: body.kind,
    key: compactKey(body.key),
    error: body.error,
    message: body.message,
    missing_record_path: body.missing_record_path,
    body: typeof body.body === 'string' ? limitString(body.body, 1200) : undefined,
    sourceLayer:
      body['source-layer'] ||
      body.source_layer ||
      body.sourceLayer ||
      body.result?.['source-layer'] ||
      body.result?.source_layer ||
      body.result?.sourceLayer,
    resultStatus: body.result?.status,
    resultReason: body.result?.reason,
    resultKind: body.result?.kind,
    resultKey: compactKey(body.result?.key),
  });
}

function compactPath(value: any) {
  const path = String(value || '');
  return limitString(
    path.replace(/([?&](?:metadata64|params64|urls64|uri64|auth_token|token|signature)=)[^&\s]+/gi, '$1...'),
    260
  );
}

function compactKey(value: any) {
  value = sanitizeHyperbeamDebugValue(value);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;

  const parsed = parseJsonObject(value);
  if (parsed) {
    const claimIds = Array.isArray(parsed.claim_ids) ? parsed.claim_ids : undefined;
    const commentIds =
      typeof parsed.comment_ids === 'string' ? parsed.comment_ids.split(',').filter(Boolean) : undefined;
    return pruneEmpty({
      claim_ids_count: claimIds?.length,
      claim_ids_sample: claimIds?.slice(0, 5),
      comment_ids_count: commentIds?.length,
      comment_ids_sample: commentIds?.slice(0, 5),
      page: parsed.page,
      page_size: parsed.page_size,
      no_totals: parsed.no_totals,
      channel_id: parsed.channel_id,
      channel_name: parsed.channel_name,
      claim_id: parsed.claim_id,
      sort_by: parsed.sort_by,
      top_level: parsed.top_level,
    });
  }

  return limitString(value, 360);
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch (_error) {
    return undefined;
  }
}

function pruneEmpty<T extends Record<string, any>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')
  );
}

function limitString(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
