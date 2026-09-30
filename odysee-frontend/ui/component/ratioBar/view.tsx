import React from 'react';
import { RATIO_BAR_CLASSES } from './classes';
type Props = {
  likeCount: number;
  dislikeCount: number;
};

const RatioBar = (props: Props) => {
  const { likeCount, dislikeCount } = props;
  const like = (1 / (likeCount + dislikeCount)) * likeCount;

  if (like || dislikeCount) {
    return (
      <div className={RATIO_BAR_CLASSES.root}>
        <div
          className={RATIO_BAR_CLASSES.like}
          style={{
            flex: like,
          }}
        />
        <div
          className={RATIO_BAR_CLASSES.dislike}
          style={{
            flex: 1 - like,
          }}
        />
      </div>
    );
  } else {
    return <div className={RATIO_BAR_CLASSES.root} />;
  }
};

export default RatioBar;
