import React from 'react';
import { PUBLISH_DETAILS_TITLE_CLASS } from 'component/publish/shared/publish-details-classes';
import { PUBLISH_CONTROL_TAG_ITEMS_CLASS } from './classes';
import { FormField } from 'component/common/form';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import {
  CONTROL_TAGS,
  INTERNAL_TAG_PREFIX,
  DISABLE_SUPPORT_TAG,
  DISABLE_DOWNLOAD_BUTTON_TAG,
  DISABLE_REACTIONS_VIDEO_TAG,
  DISABLE_REACTIONS_COMMENTS_TAG,
  DISABLE_SLIMES_VIDEO_TAG,
  DISABLE_SLIMES_COMMENTS_TAG,
  DISABLE_COMMENTS_TAG,
} from 'constants/tags';

type Props = {
  tags: Array<Tag>;
  onSelect: (tags: Array<Tag>) => void;
  onRemove: (tag: Tag) => void;
};

const TAG_LABELS: Record<string, string> = {};
function getLabel(t: string): string {
  if (TAG_LABELS[t]) return TAG_LABELS[t];
  if (t === DISABLE_COMMENTS_TAG) return (TAG_LABELS[t] = __('Disable Comments'));
  if (t === DISABLE_SUPPORT_TAG) return (TAG_LABELS[t] = __('Disable Tipping and Boosting'));
  if (t === DISABLE_DOWNLOAD_BUTTON_TAG) return (TAG_LABELS[t] = __('Hide Download Button'));
  if (t === DISABLE_REACTIONS_VIDEO_TAG) return (TAG_LABELS[t] = __('Disable Likes/Dislikes'));
  if (t === DISABLE_REACTIONS_COMMENTS_TAG) return (TAG_LABELS[t] = __('Disable Likes/Dislikes'));
  if (t === DISABLE_SLIMES_VIDEO_TAG) return (TAG_LABELS[t] = __('Disable Dislikes'));
  if (t === DISABLE_SLIMES_COMMENTS_TAG) return (TAG_LABELS[t] = __('Disable Dislikes'));
  return (TAG_LABELS[t] = __(
    t
      .replace(INTERNAL_TAG_PREFIX, '')
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  ));
}

const CONTENT_TAGS = [DISABLE_DOWNLOAD_BUTTON_TAG, DISABLE_REACTIONS_VIDEO_TAG, DISABLE_SLIMES_VIDEO_TAG];
const COMMENT_TAGS = [DISABLE_COMMENTS_TAG, DISABLE_REACTIONS_COMMENTS_TAG, DISABLE_SLIMES_COMMENTS_TAG];
const OTHER_TAGS = CONTROL_TAGS.filter((t) => !CONTENT_TAGS.includes(t) && !COMMENT_TAGS.includes(t));

export default function PublishControlTags({ tags, onSelect, onRemove }: Props) {
  function handleToggle(tag: string) {
    const existing = tags.find((t) => t.name === tag);
    if (existing) {
      onRemove(existing);
    } else {
      onSelect([{ name: tag }]);
    }
  }

  function renderGroup(icon: string, title: string, groupTags: string[]) {
    if (groupTags.length === 0) return null;
    return (
      <div className="tw:rounded-app tw:border tw:border-app-border tw:bg-app-card tw:p-app-s tw:upto-tablet:p-app-xs">
        <div className="tw:mb-app-s tw:flex tw:items-center tw:gap-app-xs tw:text-app-small tw:font-bold tw:text-app-text">
          <Icon icon={icon} size={16} />
          <span>{title}</span>
        </div>
        <div className={PUBLISH_CONTROL_TAG_ITEMS_CLASS}>
          {groupTags.map((t) => (
            <FormField
              key={t}
              name={t}
              type="checkbox"
              blockWrap={false}
              label={getLabel(t)}
              checked={tags.some((te) => te.name === t)}
              onChange={() => handleToggle(t)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className={PUBLISH_DETAILS_TITLE_CLASS}>{__('User Interactions')}</h3>
      <div className="tw:grid tw:grid-cols-3 tw:gap-app-s tw:upto-tablet:grid-cols-2 tw:upto-tablet:gap-app-xs tw:upto-xxsmall:grid-cols-1">
        {renderGroup(ICONS.PLAY, __('Content'), CONTENT_TAGS)}
        {renderGroup(ICONS.COMMENTS_LIST, __('Comments'), COMMENT_TAGS)}
        {renderGroup(ICONS.FINANCE, __('Other'), OTHER_TAGS)}
      </div>
    </div>
  );
}
