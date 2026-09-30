import { SITE_HELP_EMAIL, DOMAIN } from 'config';
import * as ICONS from 'constants/icons';
import * as React from 'react';
import Button from 'component/button';
import ClaimPreview from 'component/claimPreview';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import { ERROR_PANEL_CLASS } from 'component/common/error-classes';
import { YOUTUBE_STATUSES } from 'lbryinc';
import { buildURI } from 'util/lbryURI';
import Spinner from 'component/spinner';
import Icon from 'component/common/icon';
import I18nMessage from 'component/i18nMessage';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doClaimYoutubeChannels, doUserFetch, doCheckYoutubeTransfer } from 'redux/actions/user';
import {
  selectYoutubeChannels,
  selectYouTubeImportVideosComplete,
  selectYouTubeImportPending,
  selectUserIsPending,
} from 'redux/selectors/user';
import { doResolveUris } from 'redux/actions/claims';
import {
  YOUTUBE_TRANSFER_HELP_LABEL_CLASS,
  YOUTUBE_TRANSFER_HELP_LIST_CLASS,
  YOUTUBE_TRANSFER_SELF_SYNC_HEADER_CLASS,
  YOUTUBE_TRANSFER_TOKEN_CLASS,
  YOUTUBE_TRANSFER_TOKEN_HELP_CLASS,
} from './classes';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { HELP_CLASS, HELP_INLINE_CLASS } from 'component/common/help-classes';
type Props = {
  alwaysShow?: boolean;
  addNewChannel?: boolean;
  autoOpenSync?: boolean;
  hideChannelLink?: boolean;
};
const AUTO_OPEN_SYNC_PARAM = 'open_in_sync';
const AUTO_OPEN_SYNC_PARAM_ALT = 'open_app';
export default function YoutubeTransferStatus(props: Props) {
  const { alwaysShow = false, addNewChannel, autoOpenSync = false } = props;
  const dispatch = useAppDispatch();

  const youtubeChannels = useAppSelector(selectYoutubeChannels);
  const youtubeImportPending = useAppSelector(selectYouTubeImportPending);
  const userFetchPending = useAppSelector(selectUserIsPending);
  const videosImported = useAppSelector(selectYouTubeImportVideosComplete);
  const claimChannels = () => dispatch(doClaimYoutubeChannels());
  const updateUser = () => dispatch(doUserFetch());
  const checkYoutubeTransfer = () => dispatch(doCheckYoutubeTransfer());

  const hasChannels = youtubeChannels && youtubeChannels.length > 0;
  const transferEnabled = youtubeChannels.some((status) => status.transferable);
  const hasPendingTransfers = youtubeChannels.some(
    (status) => status.transfer_state === YOUTUBE_STATUSES.YOUTUBE_SYNC_PENDING_TRANSFER
  );
  const firstAvailableToken = hasChannels
    ? youtubeChannels.find((channel) => channel.status_token)?.status_token
    : null;
  const selfSyncDeepLink = firstAvailableToken ? `odysee://token/${firstAvailableToken}` : null;
  const selfSyncLauncherUrl = selfSyncDeepLink
    ? `https://${DOMAIN}/$/spinner?launch=${encodeURIComponent(selfSyncDeepLink)}`
    : null;
  const showSelfSyncCard = Boolean(firstAvailableToken);
  const hasAutoOpenedRef = React.useRef(false);

  function clearAutoOpenParamsFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete(AUTO_OPEN_SYNC_PARAM);
    url.searchParams.delete(AUTO_OPEN_SYNC_PARAM_ALT);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  // State for token visibility
  const [isTokenVisible, setIsTokenVisible] = React.useState(false);
  const isYoutubeTransferComplete =
    hasChannels &&
    youtubeChannels.every(
      (channel) =>
        channel.transfer_state === YOUTUBE_STATUSES.YOUTUBE_SYNC_COMPLETED_TRANSFER ||
        channel.sync_status === YOUTUBE_STATUSES.YOUTUBE_SYNC_ABANDONDED
    );
  const isNotElligible =
    hasChannels && youtubeChannels.every((channel) => channel.sync_status === YOUTUBE_STATUSES.YOUTUBE_SYNC_ABANDONDED);
  let total;
  let complete;

  if (hasPendingTransfers && videosImported) {
    complete = videosImported[0];
    total = videosImported[1];
  }

  function getMessage(channel) {
    const { transferable, transfer_state: transferState, sync_status: syncStatus } = channel;

    if (!transferable) {
      switch (transferState) {
        case YOUTUBE_STATUSES.YOUTUBE_SYNC_NOT_TRANSFERRED:
          return syncStatus[0].toUpperCase() + syncStatus.slice(1);

        case YOUTUBE_STATUSES.YOUTUBE_SYNC_PENDING_TRANSFER:
          return __('Transfer in progress');

        case YOUTUBE_STATUSES.YOUTUBE_SYNC_COMPLETED_TRANSFER:
          return __('Completed transfer');

        case YOUTUBE_STATUSES.YOUTUBE_SYNC_ABANDONDED:
          return __('This channel not eligible to by synced');
      }
    } else {
      return __('Ready to transfer');
    }
  }

  React.useEffect(() => {
    // If a channel is transferable, there's nothing to check
    if (hasPendingTransfers) {
      checkYoutubeTransfer();
      let interval = setInterval(() => {
        checkYoutubeTransfer();
        updateUser();
      }, 60 * 1000);
      return () => {
        clearInterval(interval);
      };
    }
  }, [hasPendingTransfers]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!autoOpenSync || hasAutoOpenedRef.current || !selfSyncLauncherUrl) {
      return;
    }

    hasAutoOpenedRef.current = true;
    clearAutoOpenParamsFromUrl();
    const launcherWindow = window.open(selfSyncLauncherUrl, '_blank');

    if (!launcherWindow) {
      window.location.href = selfSyncLauncherUrl;
    }
  }, [autoOpenSync, selfSyncLauncherUrl]);
  return (
    (alwaysShow || (hasChannels && !isYoutubeTransferComplete)) && (
      <Card
        title={
          isNotElligible
            ? __('Process complete')
            : isYoutubeTransferComplete
              ? __('Transfer complete')
              : youtubeChannels.length > 1
                ? __('Your YouTube channels')
                : __('Your YouTube channel')
        }
        subtitle={
          <span>
            {hasPendingTransfers &&
              __('Your videos are currently being transferred. There is nothing else for you to do.')}
            {transferEnabled && !hasPendingTransfers && __('Your videos are ready to be transferred.')}
            {!transferEnabled &&
              !hasPendingTransfers &&
              !isYoutubeTransferComplete &&
              !isNotElligible &&
              __('Please check back later, this may take a few hours.')}

            {isYoutubeTransferComplete && !isNotElligible && __('View your channel or choose a new channel to sync.')}
            {isNotElligible && (
              <I18nMessage
                tokens={{
                  here: (
                    <Button
                      button="link"
                      href="https://help.odysee.tv/category-syncprogram/limits/#requirements/"
                      label={__('here')}
                    />
                  ),
                  email: SITE_HELP_EMAIL,
                }}
              >
                Email %email% if you think there has been a mistake. Make sure your channel qualifies %here%.
              </I18nMessage>
            )}
          </span>
        }
        body={
          <section>
            {youtubeChannels.map((channel, index) => {
              const {
                lbry_channel_name: channelName,
                channel_claim_id: claimId,
                sync_status: syncStatus,
                total_subs: totalSubs,
                total_videos: totalVideos,
                vip: isVip,
                reviewed: isReviewed,
              } = channel;
              const url = buildURI({
                channelName,
                channelClaimId: claimId,
              });
              dispatch(doResolveUris([url]));
              const transferState = getMessage(channel);
              const isWaitingForSync =
                syncStatus === YOUTUBE_STATUSES.YOUTUBE_SYNC_QUEUED ||
                syncStatus === YOUTUBE_STATUSES.YOUTUBE_SYNC_PENDING ||
                syncStatus === YOUTUBE_STATUSES.YOUTUBE_SYNC_PENDING_EMAIL ||
                syncStatus === YOUTUBE_STATUSES.YOUTUBE_SYNC_PENDINGUPGRADE ||
                syncStatus === YOUTUBE_STATUSES.YOUTUBE_SYNC_SYNCING;
              const isAutomatedSync = isVip === true;
              const isNotEligible = syncStatus === YOUTUBE_STATUSES.YOUTUBE_SYNC_ABANDONDED && isReviewed === true;
              return (
                <div key={url} className={`${CARD_CLASSES.inline} sync-state`}>
                  {claimId ? (
                    <ClaimPreview
                      uri={url}
                      actions={
                        <div className={HELP_CLASS}>
                          <div>{transferState}</div>
                          {!isAutomatedSync && (
                            <div className={HELP_INLINE_CLASS}>
                              {__(
                                'This channel is not automatically syncing right now. Reach out to hello@odysee.com to try our self sync tool.'
                              )}
                            </div>
                          )}
                        </div>
                      }
                      properties={false}
                      hideJoin
                    />
                  ) : (
                    <div className={ERROR_PANEL_CLASS}>
                      {isNotEligible ? (
                        <div>
                          {__(
                            '%channelName% is not eligible to be synced, reach out to hello@odysee.com for access to the self sync tool.',
                            {
                              channelName,
                            }
                          )}
                        </div>
                      ) : (
                        <div className="progress">
                          <div className="tw:flex tw:items-center tw:[&:not(:first-of-type)]:mt-app-s">
                            {__('Claim your handle %handle%', {
                              handle: channelName,
                            })}
                            <Icon icon={ICONS.COMPLETED} className="tw:ml-app-s tw:stroke-app-primary" />
                          </div>
                          <div className="tw:flex tw:items-center tw:[&:not(:first-of-type)]:mt-app-s">
                            {__('Agree to sync')}{' '}
                            <Icon icon={ICONS.COMPLETED} className="tw:ml-app-s tw:stroke-app-primary" />
                          </div>
                          <div className="tw:flex tw:items-center tw:[&:not(:first-of-type)]:mt-app-s">
                            {isReviewed === false ? (
                              <>
                                {__('Automated sync status is still under review')}
                                <Icon icon={ICONS.NOT_COMPLETED} className="tw:ml-app-s" />
                              </>
                            ) : isAutomatedSync ? (
                              <>
                                {__('Wait for your videos to be synced')}
                                {isWaitingForSync ? (
                                  <Spinner type="small" />
                                ) : (
                                  <Icon icon={ICONS.COMPLETED} className="tw:ml-app-s tw:stroke-app-primary" />
                                )}
                              </>
                            ) : (
                              <>
                                {__(
                                  'Wait for sync to start or reach out to hello@odysee.com to try our self sync tool'
                                )}
                                <Icon icon={ICONS.NOT_COMPLETED} className="tw:ml-app-s" />
                              </>
                            )}
                          </div>
                          <div className={HELP_INLINE_CLASS}>
                            {__('Syncing %total_videos% videos from your channel with %total_subs% subscriptions.', {
                              total_videos: totalVideos,
                              total_subs: totalSubs,
                            })}
                          </div>
                          <div className={HELP_INLINE_CLASS}>
                            {' '}
                            {__(
                              '*Not all content may be processed, there are limitations based on both Youtube and Odysee activity. Click Learn More at the bottom to see the latest requirements and limits. We have a self sync tool to process the rest, reach out to hello@odysee.com to get access. '
                            )}{' '}
                          </div>

                          <div className="tw:flex tw:items-center tw:[&:not(:first-of-type)]:mt-app-s">
                            {__('Claim your channel')}
                            <Icon icon={ICONS.NOT_COMPLETED} className="tw:ml-app-s" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {videosImported && (
              <div className={`section ${HELP_CLASS}`}>
                {__('%complete% / %total% videos transferred', {
                  complete,
                  total,
                })}
              </div>
            )}
          </section>
        }
        actions={
          <>
            <div className={SECTION_CLASSES.actions}>
              {!isYoutubeTransferComplete && (
                <Button
                  button="primary"
                  disabled={youtubeImportPending || !transferEnabled}
                  onClick={claimChannels}
                  label={youtubeChannels.length > 1 ? __('Claim Channels') : __('Claim Channel')}
                />
              )}
            </div>
            {addNewChannel && (
              <div className={`${SECTION_CLASSES.actions} section__actions--above-list`}>
                <Button button="primary" label={__('Add Another Channel')} onClick={addNewChannel} />
              </div>
            )}

            <p className={HELP_CLASS}>
              {youtubeChannels.length > 1
                ? __('You will be able to claim your channels once they finish syncing.')
                : __('You will be able to claim your channel once it has finished syncing.')}{' '}
              {youtubeImportPending &&
                __('You will not be able to edit the channel or content until the transfer process completes.')}{' '}
              <Button
                button="link"
                label={__('Learn More')}
                href="https://help.odysee.tv/category-syncprogram/category-walkthrough/claimingyourchannel/"
              />
            </p>

            {/* Self-Sync Alternative */}
            {showSelfSyncCard && (
              <div className="card tw:mt-app-m tw:rounded-app tw:border tw:border-app-border tw:bg-app-card-highlighted">
                <div className={YOUTUBE_TRANSFER_SELF_SYNC_HEADER_CLASS}>
                  <h4 className="tw:m-0 tw:[font-size:var(--font-base)] tw:font-semibold tw:text-app-text">
                    {__('Want to sync more content?')}{' '}
                    <Button
                      button="link"
                      label={__('Try Self-Sync')}
                      href="https://sync.odysee.tv/"
                      className="header-link"
                    />
                  </h4>
                </div>
                <div className="card__body tw:p-app-s tw:upto-small:p-0">
                  <p className="tw:mb-app-s tw:text-app-small tw:leading-[1.5] tw:text-app-text-subtitle">
                    {__(
                      'Use our desktop sync tool to transfer content from any of your YouTube channels, including inactive or never-synced channels. Even if you have already synced channels, you can still use this tool to sync more content, even those outside of our default sync limits, e.g. longer videos.'
                    )}
                  </p>

                  {firstAvailableToken && (
                    <div className="tw:my-app-s tw:rounded-app tw:border tw:border-app-border tw:bg-app-card tw:p-app-s">
                      <div className="tw:mb-app-s tw:flex tw:items-baseline tw:gap-app-xs tw:text-app-small tw:font-semibold tw:text-app-text">
                        <strong>{__('Your token:')}</strong>
                      </div>
                      <div className={YOUTUBE_TRANSFER_TOKEN_CLASS}>
                        <div className="tw:mb-app-xs tw:flex tw:items-stretch tw:gap-app-xs">
                          <code
                            className={`tw:flex tw:min-h-[2.2rem] tw:flex-1 tw:cursor-pointer tw:items-center tw:rounded-app tw:border tw:border-app-border tw:bg-[var(--color-input-bg)] tw:px-app-s tw:py-app-xs tw:text-app-small tw:font-normal tw:text-app-text tw:[word-break:break-all] tw:[transition:all_0.2s_ease] tw:hover:border-app-primary ${
                              isTokenVisible
                                ? "tw:select-all tw:[font-family:Monaco,Menlo,'Ubuntu_Mono',monospace] tw:hover:bg-app-card-highlighted"
                                : 'tw:select-none tw:tracking-[2px] tw:hover:bg-app-primary tw:hover:text-[var(--color-primary-alt)]'
                            }`}
                            style={
                              !isTokenVisible
                                ? {
                                    fontFamily:
                                      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", Ubuntu, Cantarell, "Helvetica Neue", sans-serif',
                                  }
                                : undefined
                            }
                            onClick={() => setIsTokenVisible(!isTokenVisible)}
                            title={isTokenVisible ? __('Click to hide token') : __('Click to reveal token')}
                          >
                            {isTokenVisible ? firstAvailableToken : '••••••••••••••••••••••••••••••••'}
                          </code>
                          <Button
                            button="secondary"
                            className="tw:m-0 tw:flex tw:size-[2.2rem] tw:min-w-[2.2rem] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-app tw:p-0 tw:[&_.icon]:size-app-m tw:[&_.icon]:stroke-[2.5]"
                            icon={ICONS.COPY}
                            aria-label={__('Copy token')}
                            title={__('Copy token to clipboard')}
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(firstAvailableToken);
                              } catch (err) {
                                console.log('Failed to copy token:', err);
                              }
                            }}
                          />
                        </div>
                        <p className={YOUTUBE_TRANSFER_TOKEN_HELP_CLASS}>
                          {isTokenVisible
                            ? __(
                                'This token is private and you should not share it. Copy this token and paste it into the sync tool when prompted. Click the token to hide it.'
                              )
                            : __(
                                'This token is private and you should not share it. Click the copy button to copy your token, or click the token field to reveal it.'
                              )}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="tw:mt-app-s">
                    <p className={YOUTUBE_TRANSFER_HELP_LABEL_CLASS}>
                      <strong>{__('Important Notes:')}</strong>
                    </p>
                    <ul className={YOUTUBE_TRANSFER_HELP_LIST_CLASS}>
                      <li>
                        {__(
                          'For channels with many videos, you may need to use the "Use browser cookies" option (right click > preferences from the taskbar). We find that Firefox works the best on Windows. You\'ll want to Download and sign into YouTube on Firefox, and then set this option. This works well for age-gated videos too.  '
                        )}
                      </li>
                      <li>{__("To retry any failures, you'll need to quit and restart the app at this time.")}</li>
                      <li>
                        {__(
                          'For new users, the sync tool will make a new channel for you. To sync into an existing Odysee channel, please reach out to hello@odysee.com. '
                        )}
                      </li>
                      <li>
                        {__(
                          'Existing synced channels that have uploaded content manually while sync was turned off, content will not be de-duplicated. Reach out to hello@odysee.com for help first if you have many manual uploads.'
                        )}
                      </li>
                    </ul>
                  </div>

                  <div className={`${CARD_CLASSES.actionsInline} tw:!mt-app-m tw:mb-app-s tw:flex-wrap tw:gap-app-s`}>
                    <Button
                      button="secondary"
                      label={__('Download Sync Tool')}
                      href="https://sync.odysee.tv/"
                      iconRight="EXTERNAL"
                    />
                    <Button
                      button="link"
                      label={__('How to use')}
                      href="https://help.odysee.tv/category-syncprogram/synctool/"
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        }
      />
    )
  );
}
