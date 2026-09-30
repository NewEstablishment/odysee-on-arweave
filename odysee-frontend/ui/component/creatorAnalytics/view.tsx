import { PAGE_MAIN_EMPTY_CLASS } from 'component/page/classes';
import * as ICONS from 'constants/icons';
import * as PAGES from 'constants/pages';
import React from 'react';
import { Lbryio } from 'lbryinc';
import ClaimPreview from 'component/claimPreview';
import Spinner from 'component/spinner';
import Icon from 'component/common/icon';
import Button from 'component/button';
import Yrbl from 'component/yrbl';
import ChannelThumbnail from 'component/channelThumbnail';
import { useNavigate } from 'react-router-dom';
import { formatLbryUrlForWeb } from 'util/url';
import Comments from 'comments';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { makeSelectClaimForUri, selectClaimsById, selectClaimForUri } from 'redux/selectors/claims';
import { doResolveUris as doResolveUrisAction, doFetchClaimListMine } from 'redux/actions/claims';
import { selectActiveChannelClaim } from 'redux/selectors/app';
import {
  selectMembershipTiersForCreatorId,
  selectMonthlyIncomeForChannelId,
  selectSupportersAmountForChannelId,
} from 'redux/selectors/memberships';
import { selectModerationBlockList } from 'redux/selectors/comments';
import { doSyncCommentModerationData } from 'redux/actions/comments';
import { doFetchViewCount } from 'lbryinc';
import { selectViewCount } from 'lbryinc';
import { CREATOR_ANALYTICS_CLASSES as C } from './classes';
import { SECTION_CLASSES } from 'component/common/section-classes';

type ChannelStats = {
  ChannelSubs: number;
  ChannelSubChange: number;
  AllContentViews: number;
  AllContentViewChange: number;
  VideoURITopNew: string;
  VideoViewsTopNew: number;
  VideoViewChangeTopNew: number;
  VideoURITopCommentNew: string;
  VideoCommentTopCommentNew: number;
  VideoCommentChangeTopCommentNew: number;
  VideoURITopAllTime: string;
  VideoViewsTopAllTime: number;
  VideoViewChangeTopAllTime: number;
};

type Props = {
  uri: string;
};

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function TrendIndicator({
  value,
  suffix = '',
  inheritStyle = false,
}: {
  value: number;
  suffix?: string;
  inheritStyle?: boolean;
}) {
  if (value === 0) {
    return <span className={`${C.trend} ${C.trendNeutral} ${inheritStyle ? C.trendInherited : ''}`}>0{suffix}</span>;
  }
  const isPositive = value > 0;
  return (
    <span className={`${C.trend} ${isPositive ? C.trendUp : C.trendDown} ${inheritStyle ? C.trendInherited : ''}`}>
      <Icon icon={isPositive ? ICONS.TRENDING : ICONS.DOWN} size={10} />
      {isPositive ? '+' : ''}
      {value}
      {suffix}
    </span>
  );
}

function normalizeUri(u: string) {
  return u && !u.startsWith('lbry://') ? `lbry://${u}` : u;
}

export default function CreatorAnalytics(props: Props) {
  const { uri } = props;
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const claim = useAppSelector((state) => makeSelectClaimForUri(uri)(state));
  const claimId = claim?.claim_id;
  const activeChannel = useAppSelector(selectActiveChannelClaim);

  const [stats, setStats] = React.useState<ChannelStats | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fetching, setFetching] = React.useState(false);
  const [recentComments, setRecentComments] = React.useState<any[]>([]);
  const blockedChannels = useAppSelector(selectModerationBlockList);

  const membershipTiers = useAppSelector((state) =>
    claimId ? selectMembershipTiersForCreatorId(state, claimId) : undefined
  );
  const monthlyIncome = useAppSelector((state) => (claimId ? selectMonthlyIncomeForChannelId(state, claimId) : 0));
  const supporterCount = useAppSelector((state) => (claimId ? selectSupportersAmountForChannelId(state, claimId) : 0));
  const hasMemberships = membershipTiers && membershipTiers.length > 0 && (supporterCount > 0 || monthlyIncome > 0);

  const claimsById = useAppSelector(selectClaimsById);
  const [channelClaimIds, setChannelClaimIds] = React.useState<string[]>([]);
  const viewCountById = useAppSelector(selectViewCount);
  const topNewClaim = useAppSelector((state) =>
    stats?.VideoURITopNew ? selectClaimForUri(state, stats.VideoURITopNew) : undefined
  );
  const topCommentClaim = useAppSelector((state) =>
    stats?.VideoURITopCommentNew ? selectClaimForUri(state, stats.VideoURITopCommentNew) : undefined
  );
  const topAllTimeClaim = useAppSelector((state) =>
    stats?.VideoURITopAllTime ? selectClaimForUri(state, stats.VideoURITopAllTime) : undefined
  );

  React.useEffect(() => {
    if (!claimId) return;
    dispatch(doFetchClaimListMine(1, 99999, true, ['stream'], true, [claimId]));
  }, [claimId, dispatch]);

  React.useEffect(() => {
    dispatch(doSyncCommentModerationData());
  }, [dispatch]);

  React.useEffect(() => {
    if (!claimId || !claimsById) return;
    const ids = Object.keys(claimsById)
      .filter((id) => {
        const c = claimsById[id];
        return (
          c &&
          c.signing_channel?.claim_id === claimId &&
          c.value_type === 'stream' &&
          !id.startsWith('pending-') &&
          c.confirmations > 0
        );
      })
      .sort((a, b) => (claimsById[b]?.timestamp || 0) - (claimsById[a]?.timestamp || 0));
    setChannelClaimIds(ids);
  }, [claimId, claimsById]);

  const channelClaims = channelClaimIds.map((id) => claimsById[id]).filter(Boolean);
  const recentClaims = channelClaims.slice(0, 10);

  React.useEffect(() => {
    if (recentClaims.length > 0) {
      const ids = recentClaims.map((c: any) => c.claim_id).join(',');
      dispatch(doFetchViewCount(ids));
    }
  }, [channelClaimIds.length, claimId]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    setStats(null);
    setError(null);
  }, [claimId]);

  React.useEffect(() => {
    if (!claimId) return;
    setFetching(true);
    Lbryio.call('channel', 'stats', { claim_id: claimId })
      .then((res: ChannelStats) => {
        setStats(res);
        setFetching(false);
        res.VideoURITopNew = normalizeUri(res.VideoURITopNew);
        res.VideoURITopCommentNew = normalizeUri(res.VideoURITopCommentNew);
        res.VideoURITopAllTime = normalizeUri(res.VideoURITopAllTime);
        const uris = [res.VideoURITopNew, res.VideoURITopCommentNew, res.VideoURITopAllTime].filter(Boolean);
        if (uris.length > 0) dispatch(doResolveUrisAction(uris));
      })
      .catch(() => {
        setError('error');
        setFetching(false);
      });
  }, [claimId, dispatch]);

  React.useEffect(() => {
    if (!channelClaimIds.length || !claimId || !claim) return;
    const channelName = claim.name;
    const claimTitles: Record<string, string> = {};
    const claimUrlMap: Record<string, string> = {};
    channelClaimIds.forEach((id) => {
      const c = claimsById[id];
      if (c) {
        claimTitles[id] = c.value?.title || c.name;
        claimUrlMap[id] = formatLbryUrlForWeb(c.canonical_url || c.permanent_url);
      }
    });

    const fetchPromises = channelClaimIds.slice(0, 20).map((cid: string) =>
      Comments.comment_list({
        page: 1,
        claim_id: cid,
        page_size: 1,
        sort_by: 0,
        channel_id: claimId,
        channel_name: channelName,
        top_level: true,
      } as any)
        .then((r: any) =>
          (r?.items || []).map((item: any) => ({
            ...item,
            _claimTitle: claimTitles[cid] || '',
            _claimUrl: claimUrlMap[cid] || '',
          }))
        )
        .catch(() => [])
    );

    Promise.all(fetchPromises).then((results) => {
      const all = results.flat();
      const filtered = all.filter((c: any) => c.comment && c.comment.trim() && c.channel_id && c.channel_name);
      filtered.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));
      const top = filtered.slice(0, 10);
      if (top.length === 0) return;

      const channelUrls = [...new Set(top.map((c: any) => c.channel_url).filter(Boolean))] as string[];
      dispatch(doResolveUrisAction(channelUrls))
        .then(() => {
          const freshClaimsByUri = window.store?.getState?.()?.claims?.claimsByUri || {};
          const valid = top.filter((c: any) => !c.channel_url || freshClaimsByUri[c.channel_url] != null);
          setRecentComments(valid.slice(0, 5));
        })
        .catch(() => setRecentComments(top.slice(0, 5)));
    });
  }, [channelClaimIds.length, claimId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!stats && fetching) {
    return (
      <div className={PAGE_MAIN_EMPTY_CLASS}>
        <Spinner delayed />
      </div>
    );
  }

  if (error || (!stats && !fetching)) {
    return (
      <Yrbl
        type="sad"
        title={__('No stats available')}
        subtitle={__('Stats will appear once your content gets some views. Make sure data sharing is enabled.')}
        actions={
          <div className={SECTION_CLASSES.actions}>
            <Button button="primary" label={__('Upload Something')} onClick={() => navigate(`/$/${PAGES.UPLOAD}`)} />
          </div>
        }
      />
    );
  }

  if (!stats) return null;

  return (
    <div className={C.root}>
      <div className={C.overview}>
        <div className={C.statCard}>
          <div className={C.statIconRed}>
            <Icon icon={ICONS.SUBSCRIBE} size={28} />
          </div>
          <div className={C.statBody}>
            <span className={C.statValue}>{formatNumber(stats.ChannelSubs)}</span>
            <span className={C.statLabel}>{__('Followers')}</span>
            <TrendIndicator value={stats.ChannelSubChange} suffix={__(' this week')} />
          </div>
        </div>

        <div className={C.statCard}>
          <div className={C.statIconGreen}>
            <Icon icon={ICONS.EYE} size={28} />
          </div>
          <div className={C.statBody}>
            <span className={C.statValue}>{formatNumber(stats.AllContentViews)}</span>
            <span className={C.statLabel}>{__('Total Views')}</span>
            <TrendIndicator value={stats.AllContentViewChange} suffix={__(' this week')} />
          </div>
        </div>

        <div className={C.statCard}>
          <div className={C.statIconBlue}>
            <Icon icon={ICONS.PUBLISH} size={28} />
          </div>
          <div className={C.statBody}>
            <span className={C.statValue}>{channelClaims.length}</span>
            <span className={C.statLabel}>{__('Uploads')}</span>
          </div>
        </div>

        {hasMemberships && (
          <>
            <div className={C.statCard}>
              <div>
                <Icon icon={ICONS.MEMBERSHIP} size={20} />
              </div>
              <div className={C.statBody}>
                <span className={C.statValue}>{supporterCount}</span>
                <span className={C.statLabel}>{__('Members')}</span>
              </div>
            </div>

            <div className={C.statCard}>
              <div>
                <Icon icon={ICONS.FINANCE} size={20} />
              </div>
              <div className={C.statBody}>
                <span className={C.statValue}>{formatCurrency(monthlyIncome || 0)}</span>
                <span className={C.statLabel}>{__('Monthly Income')}</span>
              </div>
            </div>
          </>
        )}
      </div>

      <div className={C.sections}>
        <div className={C.main}>
          <div className={C.section}>
            <h2 className={C.sectionTitle}>{__('Top Content')}</h2>
            <div className={C.topContent}>
              {stats.VideoURITopNew && topNewClaim && (
                <div className={C.topItem} data-creator-analytics-top-item>
                  <span className={C.topBadge}>{__('Trending')}</span>
                  <ClaimPreview uri={stats.VideoURITopNew} />
                  <div className={C.topMeta}>
                    <span>
                      {formatNumber(stats.VideoViewsTopNew)} {__('views')}
                    </span>
                    <span>·</span>
                    <TrendIndicator value={stats.VideoViewChangeTopNew} suffix={__(' this week')} inheritStyle />
                  </div>
                </div>
              )}

              {stats.VideoURITopCommentNew && stats.VideoCommentTopCommentNew > 0 && topCommentClaim && (
                <div className={C.topItem} data-creator-analytics-top-item>
                  <span className={C.topBadge}>{__('Most Discussed')}</span>
                  <ClaimPreview uri={stats.VideoURITopCommentNew} />
                  <div className={C.topMeta}>
                    <span>
                      {formatNumber(stats.VideoCommentTopCommentNew)} {__('comments')}
                    </span>
                    <span>·</span>
                    <TrendIndicator
                      value={stats.VideoCommentChangeTopCommentNew}
                      suffix={__(' this week')}
                      inheritStyle
                    />
                  </div>
                </div>
              )}

              {stats.VideoURITopAllTime && topAllTimeClaim && (
                <div className={C.topItem} data-creator-analytics-top-item>
                  <span className={C.topBadge}>{__('All-Time Best')}</span>
                  <ClaimPreview uri={stats.VideoURITopAllTime} />
                  <div className={C.topMeta}>
                    <span>
                      {formatNumber(stats.VideoViewsTopAllTime)} {__('views')}
                    </span>
                    <span>·</span>
                    <TrendIndicator value={stats.VideoViewChangeTopAllTime} suffix={__(' this week')} inheritStyle />
                  </div>
                </div>
              )}
            </div>
          </div>

          {recentClaims.length > 0 && (
            <div className={C.section}>
              <div className={C.sectionHeader}>
                <h2 className={`${C.sectionTitle} ${C.sectionTitleInline}`}>{__('Recent Uploads')}</h2>
                <Button button="link" label={__('View all')} navigate={`/$/${PAGES.UPLOADS}`} />
              </div>
              <table className={C.table}>
                <thead>
                  <tr>
                    <th className={C.tableHeaderCell}>{__('Title')}</th>
                    <th className={C.tableHeaderCell}>{__('Views')}</th>
                    <th className={C.tableHeaderCell}>{__('Published')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentClaims.map((c: any) => {
                    const views = viewCountById?.[c.claim_id] ?? null;
                    const title = c.value?.title || c.name;
                    const date = c.timestamp ? new Date(c.timestamp * 1000) : null;
                    return (
                      <tr
                        key={c.claim_id}
                        className={C.tableRow}
                        onClick={() => navigate(formatLbryUrlForWeb(c.canonical_url || c.permanent_url))}
                      >
                        <td className={`${C.tableCell} ${C.tableRowCell} ${C.tableTitle}`}>{title}</td>
                        <td className={`${C.tableCell} ${C.tableRowCell} ${C.tableViews}`}>
                          {views !== null ? formatNumber(views) : '--'}
                        </td>
                        <td className={`${C.tableCell} ${C.tableRowCell} ${C.tableDate}`}>
                          {date ? date.toLocaleDateString() : '--'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {recentComments.length > 0 && (
            <div className={C.section}>
              <h2 className={C.sectionTitle}>{__('Recent Comments')}</h2>
              <div className={C.comments}>
                {recentComments.map((comment: any) => (
                  <div
                    key={comment.comment_id}
                    className={C.comment}
                    onClick={() => comment._claimUrl && navigate(`${comment._claimUrl}?lc=${comment.comment_id}`)}
                  >
                    {blockedChannels.includes(comment.channel_url) && (
                      <span className={C.commentBadge}>{__('Blocked')}</span>
                    )}
                    <div className={C.commentHeader}>
                      {comment.channel_url ? (
                        <span
                          className={`${C.commentAuthor} ${C.link}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(formatLbryUrlForWeb(comment.channel_url));
                          }}
                        >
                          {comment.channel_name}
                        </span>
                      ) : (
                        <span className={C.commentAuthor}>{__('Anonymous')}</span>
                      )}
                      <span className={C.commentTime}>
                        {comment.timestamp ? new Date(comment.timestamp * 1000).toLocaleDateString() : ''}
                      </span>
                    </div>
                    <p className={C.commentText}>{comment.comment}</p>
                    {comment._claimTitle && (
                      <span
                        className={`${C.commentClaim} ${C.link}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(comment._claimUrl);
                        }}
                      >
                        {__('on')} {comment._claimTitle}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={C.sidebar}>
          <div className={C.section}>
            <h2 className={C.sectionTitle}>{__('Quick Actions')}</h2>
            <div className={C.actions}>
              <Button
                button="secondary"
                className={C.actionButton}
                icon={ICONS.PUBLISH}
                label={__('Upload')}
                navigate={`/$/${PAGES.UPLOAD}`}
              />
              <Button
                button="secondary"
                className={C.actionButton}
                icon={ICONS.POST}
                label={__('Post')}
                navigate={`/$/${PAGES.POST}`}
              />
              <Button
                button="secondary"
                className={C.actionButton}
                icon={ICONS.LIVESTREAM}
                label={__('Go Live')}
                navigate={`/$/${PAGES.LIVESTREAM}`}
              />
              <Button
                button="secondary"
                className={C.actionButton}
                icon={ICONS.SETTINGS}
                label={__('Settings')}
                navigate={
                  activeChannel?.canonical_url
                    ? formatLbryUrlForWeb(activeChannel.canonical_url) + '?view=settings'
                    : undefined
                }
              />
            </div>
          </div>

          {activeChannel && (
            <div className={C.section}>
              <h2 className={C.sectionTitle}>{__('Channel')}</h2>
              <Button
                button="secondary"
                className={C.channelButton}
                contentClassName={C.channelContent}
                navigate={formatLbryUrlForWeb(activeChannel.canonical_url || activeChannel.permanent_url)}
              >
                <ChannelThumbnail uri={activeChannel.permanent_url} className="tw:shrink-0" xsmall />
                <div className={C.channelInfo}>
                  <span className={C.channelName} data-dashboard-channel-name>
                    {activeChannel.value?.title || activeChannel.name}
                  </span>
                  <span className={C.channelUrl} data-dashboard-channel-url>
                    {activeChannel.name}
                  </span>
                </div>
              </Button>
            </div>
          )}

          {hasMemberships && (
            <div className={C.section}>
              <h2 className={C.sectionTitle}>{__('Membership')}</h2>
              <div className={C.membershipSummary}>
                <div className={C.membershipRow}>
                  <span>{__('Members')}</span>
                  <span>{supporterCount}</span>
                </div>
                <div className={C.membershipRow}>
                  <span>{__('Tiers')}</span>
                  <span>{membershipTiers?.length || 0}</span>
                </div>
                <div className={C.membershipRow}>
                  <span>{__('Monthly')}</span>
                  <span>{formatCurrency(monthlyIncome || 0)}</span>
                </div>
              </div>
              <Button button="link" label={__('Manage Memberships')} navigate={`/$/${PAGES.CREATOR_MEMBERSHIPS}`} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
