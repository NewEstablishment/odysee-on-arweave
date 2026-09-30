import React from 'react';
import classnames from 'classnames';
import ChannelThumbnail from 'component/channelThumbnail';
import Icon from 'component/common/icon';
import { getClaimTitle } from 'util/claim';

const ENTRY_TITLE_CLASS =
  'tw:overflow-hidden tw:text-ellipsis tw:text-app-small tw:[display:-webkit-box] tw:[-webkit-box-orient:vertical] tw:[-webkit-line-clamp:1]';
const ENTRY_NAME_CLASS = 'tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-xsmall';

type Props = {
  uri: string;
  claim: Claim | null | undefined;
  // Get from parent, so we don't need to call the selector for each entry.
  resolvingUris: Array<string>;
  onClick?: (arg0: any) => void;
  noHoverHighlight?: boolean;
  iconRight?: string;
  iconRightOnHoverOnly?: boolean;
  iconRightErrorColor?: boolean;
  hideInvalid?: boolean;
};
export default function Entry(props: Props) {
  const { uri, claim, resolvingUris, onClick, noHoverHighlight, iconRight, iconRightOnHoverOnly, hideInvalid } = props;
  const title = getClaimTitle(claim);
  const name = claim?.name || '';
  const tooltip = [title || '', name, uri].join('\n');
  const isResolvingUri = resolvingUris.includes(uri);
  const isInvalid = claim === null;
  return (
    <div
      className={classnames(
        'tw:group/entry tw:flex tw:w-full tw:items-center tw:justify-between tw:rounded-app tw:px-app-s tw:py-app-s',
        noHoverHighlight
          ? 'tw:hover:[background:unset] tw:hover:text-[unset]'
          : 'tw:hover:bg-[var(--color-odysee)] tw:hover:text-[var(--color-odysee-contrast)]',
        {
          'tw:hidden': isInvalid && hideInvalid,
          'tw:pointer-events-none': !uri,
        }
      )}
      title={tooltip}
      onClick={onClick}
    >
      <div className="tw:flex">
        {claim ? (
          <>
            <ChannelThumbnail xsmall uri={uri} />
            <div className="tw:ml-app-xxs tw:flex tw:max-w-[75%] tw:flex-col">
              <span className={ENTRY_TITLE_CLASS}>{title || name}</span>
              <span
                className={classnames(ENTRY_NAME_CLASS, 'tw:text-app-text-subtitle', {
                  'tw:group-hover/entry:text-[unset]': !noHoverHighlight,
                  'tw:group-hover/entry:text-app-text-subtitle': noHoverHighlight,
                })}
              >
                {name}
              </span>
            </div>
          </>
        ) : (
          <>
            <ChannelThumbnail xsmall uri={uri} />
            <div className="tw:ml-app-xxs tw:flex tw:max-w-[75%] tw:flex-col">
              {uri === null ? (
                <span className={ENTRY_TITLE_CLASS}>{'---'}</span>
              ) : isResolvingUri || claim === undefined ? (
                <>
                  <span
                    className={`${ENTRY_TITLE_CLASS} tw:mb-app-xxxs tw:h-[0.9rem] tw:w-[15ch] tw:rounded-app tw:bg-[var(--color-header-button)]`}
                  />
                  <span
                    className={classnames(
                      ENTRY_NAME_CLASS,
                      'tw:h-[0.9rem] tw:w-1/2 tw:rounded-app tw:bg-[var(--color-header-button)] tw:text-app-text-subtitle',
                      {
                        'tw:group-hover/entry:text-[unset]': !noHoverHighlight,
                        'tw:group-hover/entry:text-app-text-subtitle': noHoverHighlight,
                      }
                    )}
                  />
                </>
              ) : (
                <>
                  <span className={ENTRY_TITLE_CLASS}>{'[Removed]'}</span>
                  <span
                    className={classnames(ENTRY_NAME_CLASS, 'tw:text-app-text-subtitle', {
                      'tw:group-hover/entry:text-[unset]': !noHoverHighlight,
                      'tw:group-hover/entry:text-app-text-subtitle': noHoverHighlight,
                    })}
                  >
                    {uri}
                  </span>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <div
        className={classnames('tw:pr-app-xs', {
          'tw:hidden tw:group-hover/entry:block': iconRightOnHoverOnly,
        })}
      >
        {iconRight && <Icon icon={iconRight} />}
      </div>
    </div>
  );
}
