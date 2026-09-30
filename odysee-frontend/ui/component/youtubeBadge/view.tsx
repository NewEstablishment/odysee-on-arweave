import * as React from 'react';
import { getTimeAgoStr } from 'util/time';
import { Lbryio } from 'lbryinc';
import { MEDIA_INFO_TEXT_CLASS, MEDIA_INFO_TEXT_CONSTRAINED_CLASS } from 'component/common/media-classes';
type Props = {
  channelClaimId: string;
};
export default function YoutubeBadge(props: Props) {
  const { channelClaimId } = props;
  const [isVerified, setIsVerified] = React.useState<boolean>();
  const [lastYtSyncDate, setLastYtSyncDate] = React.useState<string>();
  React.useEffect(() => {
    if (channelClaimId) {
      Lbryio.call('yt', 'get_youtuber', {
        channel_claim_id: channelClaimId,
      }).then((response) => {
        if (response.is_verified_youtuber) {
          setIsVerified(true);
          setLastYtSyncDate(response.last_synced);
        } else {
          setIsVerified(false);
          setLastYtSyncDate(undefined);
        }
      });
    } else {
      setIsVerified(false);
      setLastYtSyncDate(undefined);
    }
  }, [channelClaimId]);

  if (isVerified) {
    return (
      <>
        <label>{__('Official YouTube Creator')}</label>
        <div className={MEDIA_INFO_TEXT_CLASS}>
          <div className={`${MEDIA_INFO_TEXT_CLASS} ${MEDIA_INFO_TEXT_CONSTRAINED_CLASS}`}>
            {lastYtSyncDate &&
              __('Last checked %time_ago%', {
                time_ago: getTimeAgoStr(lastYtSyncDate),
              })}
          </div>
        </div>
      </>
    );
  } else {
    return null;
  }
}
