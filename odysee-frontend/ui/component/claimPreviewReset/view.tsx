import React from 'react';
import { SITE_HELP_EMAIL } from 'config';
import Button from 'component/button';
import { killStream } from 'util/livestream';
// import { iconClasses } from '@mui/material';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectClaimIsMineForUri, selectClaimForUri } from 'redux/selectors/claims';
import { doToast } from 'redux/actions/notifications';
import { selectActiveLivestreamForChannel } from 'redux/selectors/livestream';
import { getChannelIdFromClaim, getChannelNameFromClaim } from 'util/claim';

type Props = {
  uri: string;
};

const ClaimPreviewReset = (props: Props) => {
  const { uri } = props;
  const dispatch = useAppDispatch();
  const claim = useAppSelector((state) => selectClaimForUri(state, uri));
  const channelId = getChannelIdFromClaim(claim);
  const channelName = getChannelNameFromClaim(claim);
  const claimIsMine = useAppSelector((state) => (uri ? selectClaimIsMineForUri(state, uri) : false));
  const activeLivestreamForChannel = useAppSelector((state) => selectActiveLivestreamForChannel(state, channelId));

  if (!claimIsMine || !activeLivestreamForChannel) return null;

  const handleClick = async () => {
    try {
      await killStream(channelId, channelName);
      dispatch(
        doToast({
          message: __('Live stream successfully reset.'),
          isError: false,
        })
      );
    } catch {
      dispatch(
        doToast({
          message: __('There was an error resetting the live stream.'),
          isError: true,
        })
      );
    }
  };

  return (
    <p className="claim-preview-reset-surface tw:flex tw:flex-col tw:items-center tw:justify-between tw:rounded-app tw:border tw:border-app-primary tw:bg-[rgba(var(--color-primary-static),0.1)] tw:py-app-xxs tw:pr-app-xxs tw:pl-app-s tw:text-app-small tw:min-xsmall:flex-row">
      <span className="tw:inline-block tw:text-app-text tw:min-xsmall:mr-app-m tw:upto-small:mb-app-s">
        <Icon className="tw:mr-app-xxxs tw:mb-[-3px]" icon={ICONS.INFO} />
        {__(
          "If you're having trouble starting a stream or if your stream shows that you're live but aren't, try a reset. If the problem persists, please reach out at %SITE_HELP_EMAIL%.",
          {
            SITE_HELP_EMAIL,
          }
        )}
      </span>
      <Button
        button="primary"
        label={__('Reset stream')}
        className="claim-preview-reset-button-surface tw:w-full tw:min-xsmall:mt-0 tw:min-xsmall:w-auto"
        onClick={handleClick}
      />
    </p>
  );
};

export default ClaimPreviewReset;
