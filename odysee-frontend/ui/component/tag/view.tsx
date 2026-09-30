import * as ICONS from 'constants/icons';
import * as PAGES from 'constants/pages';
// import * as MATURE_TAGS from 'constants/ta';
import React from 'react';
import classnames from 'classnames';
import { MATURE_TAGS } from 'constants/tags';
import Button from 'component/button';
import { TAG_CLASSES } from './classes';
type Props = {
  name: string;
  title?: string;
  type?: string;
  onClick?: (arg0: any) => any;
  disabled?: boolean;
};
function Tag(props: Props) {
  const { name, onClick, type = 'link', disabled = false } = props;
  const isMature = name.split(' ').some((word) => MATURE_TAGS.includes(word));
  const clickProps = onClick
    ? {
        onClick,
      }
    : {
        navigate: `/$/${PAGES.DISCOVER}?t=${encodeURIComponent(name)}`,
      };
  let title;

  if (!onClick) {
    title = __('View tag');
  } else {
    title = type === 'add' ? __('Add tag') : __('Remove tag');
  }

  let iconRight = type !== 'link' && type !== 'large' && (type === 'remove' ? ICONS.REMOVE : ICONS.ADD);

  if (type === 'flow') {
    iconRight = null;
  }

  return (
    <Button
      {...clickProps}
      disabled={disabled}
      title={title}
      className={classnames(TAG_CLASSES.base, {
        [TAG_CLASSES.disabled]: disabled,
        [TAG_CLASSES.large]: type === 'large',
        [TAG_CLASSES.remove]: type === 'remove',
        // tag--add only adjusts the color, which causes issues with mature tag color clashing
        'tag--add': !isMature && type === 'add',
        [TAG_CLASSES.mature]: isMature,
        [TAG_CLASSES.flow]: type === 'flow',
      })}
      label={name}
      iconSize={12}
      iconRight={iconRight}
    />
  );
}

export default React.memo(Tag);
