import React from 'react';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectActiveChannelClaim } from 'redux/selectors/app';
import { selectBalance } from 'redux/selectors/wallet';
import { doClearPublish, doUpdatePublishForm, doPublishDesktop } from 'redux/actions/publish';
import { doToast } from 'redux/actions/notifications';
import TagsSearch from 'component/tagsSearch';
import DatePicker from 'react-datepicker';
import * as PUBLISH_TYPES from 'constants/publish_types';
import * as SETTINGS from 'constants/settings';
import { selectClientSetting, selectLanguage } from 'redux/selectors/settings';
import classnames from 'classnames';
import describeUnknown from 'util/describeUnknown';
import { LIVESTREAM_QUICK_CREATE_CLASSES as C } from './classes';

const DEFAULT_THUMBNAIL = `${window.location.origin}/public/img/livestream-default-thumb.svg`;

const INVALID_URI_CHARS = new Set([
  ' ',
  '=',
  '&',
  '#',
  ':',
  '$',
  '@',
  '%',
  '?',
  ';',
  '/',
  '\\',
  '\n',
  '"',
  '<',
  '>',
  '{',
  '}',
  '|',
  '^',
  '~',
  '[',
  ']',
  '`',
]);

function isInvalidUriCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return false;

  return (
    INVALID_URI_CHARS.has(char) ||
    (codePoint >= 0x0 && codePoint <= 0x8) ||
    (codePoint >= 0xb && codePoint <= 0xc) ||
    (codePoint >= 0xe && codePoint <= 0x1f) ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
    (codePoint >= 0xfffe && codePoint <= 0xffff)
  );
}

function titleToName(title: string): string {
  return Array.from(title)
    .map((char) => (isInvalidUriCharacter(char) ? '-' : char))
    .join('')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function dateToLinux(date: Date): number {
  return Math.round(date.getTime() / 1000);
}

function getDefaultScheduledDate(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1);
  d.setMinutes(0, 0, 0);
  return d;
}

type Props = {
  onCreated?: () => void;
};

export default function LivestreamQuickCreate({ onCreated }: Props) {
  const dispatch = useAppDispatch();
  const activeChannel = useAppSelector(selectActiveChannelClaim);
  const balance = useAppSelector(selectBalance);
  const clock24h = useAppSelector((state) => selectClientSetting(state, SETTINGS.CLOCK_24H));
  const appLanguage = useAppSelector((state) => selectLanguage(state));

  const [title, setTitle] = React.useState('');
  const [tags, setTags] = React.useState<Array<Tag>>([]);
  const [scheduled, setScheduled] = React.useState(false);
  const [scheduleDate, setScheduleDate] = React.useState<Date>(getDefaultScheduledDate);
  const [thumbnail, setThumbnail] = React.useState('');
  const [showThumb, setShowThumb] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);

  const channelName = activeChannel?.name;
  const channelId = activeChannel?.claim_id;
  const canPublish = title.trim().length > 0 && balance >= 0.001 && !publishing && !confirming;
  const generatedName = titleToName(title) || 'livestream';

  async function handleCreate() {
    if (!canPublish || !activeChannel) return;
    setPublishing(true);

    const name = generatedName;
    const releaseTime = scheduled ? dateToLinux(scheduleDate) : undefined;
    const thumbUrl = thumbnail || DEFAULT_THUMBNAIL;

    dispatch(doClearPublish());
    dispatch(
      doUpdatePublishForm({
        type: PUBLISH_TYPES.LIVESTREAM,
        liveCreateType: 'new_placeholder',
        title: title.trim(),
        name,
        channel: channelName,
        bid: 0.001,
        tags: tags.map((t) => (typeof t === 'string' ? { name: t } : t)),
        thumbnail_url: thumbUrl,
        thumbnail: thumbUrl,
        releaseTime,
        language: appLanguage || 'en',
        description: '',
        nsfw: false,
        contentIsFree: true,
      })
    );

    try {
      await dispatch(doPublishDesktop(undefined, false));
      dispatch(doToast({ message: __('Stream claim created! Waiting for confirmation...') }));
      setPublishing(false);
      setConfirming(true);

      // Poll for claim confirmation
      if (channelId) {
        const { doFetchNoSourceClaimsForChannelId } = await import('redux/actions/claims');
        let attempts = 0;
        const maxAttempts = 30; // 30 * 5s = 2.5 minutes max

        const pollInterval = setInterval(async () => {
          attempts++;
          await dispatch(doFetchNoSourceClaimsForChannelId(channelId));

          // Check if we now have approved claims
          const state = window.store?.getState?.();
          const claims = state?.livestream?.livestreamsByCreatorId?.[channelId];
          if ((claims && claims.length > 0) || attempts >= maxAttempts) {
            clearInterval(pollInterval);
            setConfirming(false);
            onCreated?.();
          }
        }, 5000);
      }
    } catch (e: unknown) {
      const msg = describeUnknown(e);
      dispatch(
        doToast({
          isError: true,
          message: msg || __('Failed to create stream claim.'),
        })
      );
      setPublishing(false);
    }
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (confirming) {
    return (
      <div className={C.root}>
        <div className={`${C.card} ${C.confirmingCard}`}>
          <div className={C.confirming}>
            <span className={C.spinner} />
            <h3 className={C.confirmingTitle}>{__('Confirming your stream claim...')}</h3>
            <p className={C.confirmingText}>
              {__('This usually takes 1-2 minutes. The stream page will load automatically once confirmed.')}
            </p>
            <div className={C.confirmingProgress}>
              <div className={C.confirmingBar} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={C.root}>
      <div className={C.card}>
        {/* Header */}
        <div className={C.header}>
          <div className={C.icon}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <div>
            <h2 className={C.title}>{__('Quick Stream Setup')}</h2>
            <p className={C.subtitle}>{__('Create a stream claim to go live. Only a title is required.')}</p>
          </div>
        </div>

        {/* Title */}
        <div className={C.section}>
          <label className={C.label}>{__('Stream Title')}</label>
          <input
            className={C.input}
            type="text"
            placeholder={__('Enter a title for your stream...')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            autoFocus
          />
          {title && (
            <span className={C.uri}>
              {channelName}/{generatedName}
            </span>
          )}
        </div>

        {/* When to go live */}
        <div className={C.section}>
          <label className={C.label}>{__('When do you want to go live?')}</label>
          <div className={C.schedule}>
            <button
              className={classnames(C.scheduleButton, {
                [C.scheduleButtonActive]: !scheduled,
              })}
              onClick={() => setScheduled(false)}
              type="button"
            >
              {__('Anytime')}
            </button>
            <button
              className={classnames(C.scheduleButton, {
                [C.scheduleButtonActive]: scheduled,
              })}
              onClick={() => setScheduled(true)}
              type="button"
            >
              {__('Scheduled')}
            </button>
          </div>
          {scheduled && (
            <div className={C.dateRow}>
              <DatePicker
                selected={scheduleDate}
                onChange={(d: Date | null) => d && setScheduleDate(d)}
                showTimeSelect
                dateFormat={clock24h ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd h:mm aa'}
                timeFormat={clock24h ? 'HH:mm' : 'h:mm aa'}
                className={`${C.input} ${C.dateInput}`}
                minDate={todayStart}
              />
            </div>
          )}
          <p className={C.hint}>
            {!scheduled
              ? __('Your stream will be ready anytime you start broadcasting.')
              : __('Scheduled streams appear on your channel page and for followers.')}
          </p>
        </div>

        {/* Tags */}
        <div className={C.section}>
          <label className={C.label}>{__('Tags')}</label>
          <TagsSearch
            onSelect={(newTags) => setTags(newTags)}
            onRemove={(tag) =>
              setTags((prev) =>
                prev.filter((t) => (typeof t === 'string' ? t : t.name) !== (typeof tag === 'string' ? tag : tag.name))
              )
            }
            tagsPassedIn={tags}
            limitSelect={5}
            placeholder={__('Add up to 5 tags...')}
            hideSuggestions
            disableControlTags
          />
        </div>

        {/* Thumbnail toggle */}
        <div className={C.section}>
          <button className={C.expandButton} onClick={() => setShowThumb(!showThumb)} type="button">
            <svg
              className={classnames(C.chevron, {
                [C.chevronOpen]: showThumb,
              })}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {__('Custom Thumbnail')}
            <span className={C.optional}>{__('optional')}</span>
          </button>

          {showThumb && (
            <div className={C.thumbnailSection}>
              <input
                className={C.input}
                type="text"
                placeholder={__('Paste image URL...')}
                value={thumbnail}
                onChange={(e) => setThumbnail(e.target.value)}
              />
              <div className={C.thumbnailPreview}>
                <img
                  src={thumbnail || DEFAULT_THUMBNAIL}
                  alt=""
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = DEFAULT_THUMBNAIL;
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Submit */}
        <button
          className={classnames(C.submit, {
            [C.submitPublishing]: publishing,
          })}
          onClick={handleCreate}
          disabled={!canPublish}
          type="button"
        >
          {publishing ? (
            <>
              <span className={C.spinner} />
              {__('Creating...')}
            </>
          ) : (
            <>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
              </svg>
              {__('Create Stream')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
