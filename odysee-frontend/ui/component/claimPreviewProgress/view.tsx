import React from 'react';
import { useAppSelector } from 'redux/hooks';
import { selectClaimForUri } from 'redux/selectors/claims';
import { selectContentPositionForUri } from 'redux/selectors/content';
import { CLAIM_PREVIEW_PROGRESS_CLASS } from './classes';
type Props = {
  uri: string;
};
function ClaimPreviewProgress(props: Props) {
  const { uri } = props;
  const claim = useAppSelector((state) => selectClaimForUri(state, uri));
  const position = useAppSelector((state) => selectContentPositionForUri(state, uri));
  const duration = claim?.value?.video?.duration || claim?.value?.audio?.duration;

  if (!position || !duration) {
    return null;
  }

  return (
    <div className={CLAIM_PREVIEW_PROGRESS_CLASS}>
      <div
        className="tw:h-[5px] tw:[background-image:var(--color-odysee-gradient)]"
        style={{
          width: `${(position / duration) * 100}%`,
        }}
      />
    </div>
  );
}

export default React.memo(ClaimPreviewProgress);
