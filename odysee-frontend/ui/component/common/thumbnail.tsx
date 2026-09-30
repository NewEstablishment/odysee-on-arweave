import React from 'react';
import classnames from 'classnames';
import { CARD_CLASSES } from './card-classes';
type Props = {
  src: string;
  shouldObscure: boolean;
  className?: string;
};

const Thumbnail = (props: Props) => {
  const { className, src, shouldObscure } = props;
  return (
    <img
      alt={__('Image thumbnail')}
      className={classnames(
        'card__media',
        {
          [CARD_CLASSES.mediaNsfw]: shouldObscure,
        },
        className
      )}
      src={src}
    />
  );
};

export default Thumbnail;
