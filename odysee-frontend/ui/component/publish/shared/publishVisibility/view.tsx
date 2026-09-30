import React from 'react';
import { PUBLISH_DETAILS_TITLE_CLASS } from 'component/publish/shared/publish-details-classes';
import classnames from 'classnames';
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import { FormField } from 'component/common/form';
import PublishReleaseDate from 'component/publish/shared/publishReleaseDate';
import { MS } from 'constants/date-time';
import { getClaimScheduledState, isClaimPrivate, isClaimUnlisted } from 'util/claim';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectIsNonPublicVisibilityAllowed, selectPublishFormValue } from 'redux/selectors/publish';
import { doUpdatePublishForm } from 'redux/actions/publish';
import { PUBLISH_VISIBILITY_SCHEDULED_CLASS } from '../release-date-classes';

export const publishVisibilityOptionsClassName = (twoColumns = false) =>
  classnames('tw:grid tw:gap-app-s tw:upto-tablet:gap-app-xs tw:upto-xxsmall:grid-cols-1', {
    'tw:grid-cols-2': twoColumns,
    'tw:grid-cols-3 tw:upto-tablet:grid-cols-2': !twoColumns,
  });

export const publishVisibilityOptionClassName = (selected: boolean) =>
  classnames(
    'tw:flex tw:cursor-pointer tw:flex-col tw:gap-app-xs tw:rounded-app tw:border tw:border-app-border tw:bg-app-card tw:p-app-s tw:text-left tw:transition-[border-color] tw:duration-150 tw:ease-[ease] tw:enabled:hover:border-app-primary tw:disabled:cursor-default tw:disabled:opacity-40 tw:upto-tablet:p-app-xs',
    { 'tw:border-app-primary': selected }
  );

export const publishVisibilityOptionHeaderClassName =
  'tw:flex tw:items-center tw:gap-app-xs tw:text-app-small tw:font-bold tw:text-app-text';
export const publishVisibilityOptionDescriptionClassName =
  'tw:m-0 tw:text-app-xsmall tw:leading-[1.4] tw:text-app-text-subtitle';
export const publishVisibilityScheduledClassName = PUBLISH_VISIBILITY_SCHEDULED_CLASS;

const PublishVisibility = () => {
  const dispatch = useAppDispatch();
  const visibility: Visibility = useAppSelector((state) => selectPublishFormValue(state, 'visibility'));
  const scheduledShow: boolean = useAppSelector((state) => selectPublishFormValue(state, 'scheduledShow'));
  const ce: StreamClaim | null | undefined = useAppSelector((state) => selectPublishFormValue(state, 'claimToEdit'));
  const isNonPublicAllowed = useAppSelector(selectIsNonPublicVisibilityAllowed);
  let showEditWarning = false;

  if (ce) {
    const pastScheduledState = getClaimScheduledState(ce);
    const wasPublic = pastScheduledState === 'non-scheduled' && !isClaimUnlisted(ce) && !isClaimPrivate(ce);
    showEditWarning = wasPublic && visibility !== 'public';
  }

  function setVisibility(v: Visibility) {
    dispatch(doUpdatePublishForm({ visibility: v }));
  }

  return (
    <div>
      <h3 className={PUBLISH_DETAILS_TITLE_CLASS}>{__('Visibility')}</h3>
      <div className={publishVisibilityOptionsClassName()}>
        <button
          type="button"
          className={publishVisibilityOptionClassName(visibility === 'public')}
          onClick={() => setVisibility('public')}
        >
          <div className={publishVisibilityOptionHeaderClassName}>
            <Icon icon={ICONS.GLOBE} size={18} />
            <span>{__('Public')}</span>
          </div>
          <p className={publishVisibilityOptionDescriptionClassName}>{__(HELP.public)}</p>
        </button>

        <button
          type="button"
          className={publishVisibilityOptionClassName(visibility === 'unlisted')}
          onClick={() => isNonPublicAllowed && setVisibility('unlisted')}
          disabled={!isNonPublicAllowed}
        >
          <div className={publishVisibilityOptionHeaderClassName}>
            <Icon icon={ICONS.EYE_OFF} size={18} />
            <span>{__('Unlisted')}</span>
          </div>
          <p className={publishVisibilityOptionDescriptionClassName}>{__(HELP.unlisted)}</p>
          {visibility === 'unlisted' && showEditWarning && (
            <p className="tw:mt-app-s tw:rounded-app tw:border tw:border-[var(--color-text-warning)] tw:p-app-s tw:text-app-small tw:text-[var(--color-text-warning)]">
              {__(HELP.edit_warning)}
            </p>
          )}
        </button>

        <button
          type="button"
          className={publishVisibilityOptionClassName(visibility === 'scheduled')}
          onClick={() => isNonPublicAllowed && setVisibility('scheduled')}
          disabled={!isNonPublicAllowed}
        >
          <div className={publishVisibilityOptionHeaderClassName}>
            <Icon icon={ICONS.TIMERCHECK} size={18} />
            <span>{__('Scheduled')}</span>
          </div>
          <p className={publishVisibilityOptionDescriptionClassName}>{__(HELP.scheduled)}</p>
          {visibility === 'scheduled' && (
            <div className={publishVisibilityScheduledClassName} onClick={(e) => e.stopPropagation()}>
              {showEditWarning && (
                <p className="tw:mt-app-s tw:rounded-app tw:border tw:border-[var(--color-text-warning)] tw:p-app-s tw:text-app-small tw:text-[var(--color-text-warning)]">
                  {__(HELP.edit_warning)}
                </p>
              )}
              <FormField
                type="checkbox"
                name="scheduled::show"
                label={__("Show this on my channel's Upcoming section.")}
                checked={scheduledShow}
                onChange={() => dispatch(doUpdatePublishForm({ scheduledShow: !scheduledShow }))}
              />
              <PublishReleaseDate minDate={new Date(Date.now() + 30 * MS.MINUTE)} />
            </div>
          )}
        </button>
      </div>
      <p className="tw:mt-app-s tw:text-app-xsmall tw:text-app-text-subtitle">{__(HELP.chain_warning)}</p>
    </div>
  );
};

const HELP = {
  public: 'Content is visible to everyone.',
  unlisted: 'The content cannot be viewed without a special link.',
  scheduled: 'Set a date to make the content public.',
  chain_warning:
    'Note: The title, description, and other metadata are still public for unlisted and scheduled content.',
  edit_warning:
    'Editing previously public content may still allow it to be accessed by some applications if the data is being shared by others on the network. If you want to make sure the content is not accessible, you should delete and re-upload it.',
};

export default PublishVisibility;
