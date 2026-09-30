import { SITE_NAME, WEB_PUBLISH_SIZE_LIMIT_GB } from 'config';
import { BITRATE } from 'constants/publish';
import * as ICONS from 'constants/icons';
import React, { useState, useEffect } from 'react';
import Card from 'component/common/card';
import { CARD_CLASSES } from 'component/common/card-classes';
import { EMPTY_CENTERED_TIGHT_CLASS, EMPTY_CLASS } from 'component/common/empty-classes';
import { DISABLED_CLASS } from 'component/common/state-classes';
import { PUBLISH_ROW_NO_MARGIN_CLASS } from 'component/publish/shared/publish-row-classes';
import { FormField } from 'component/common/form';
import {
  FIELDSET_GROUP_CLASS,
  FIELDSET_GROUP_PAGINATE_CLASS,
} from 'component/common/form-components/fieldset-group-classes';
import Spinner from 'component/spinner';
import PublishName from '../../shared/publishName';
import useThrottle from 'effects/use-throttle';
import CopyableText from 'component/copyableText';
import dayjs from 'util/dayjs';
import classnames from 'classnames';
import ReactPaginateImport from 'react-paginate';
const ReactPaginate = (ReactPaginateImport as any).default || ReactPaginateImport;
import FileSelector from 'component/common/file-selector';
import Button from 'component/button';
import Icon from 'component/common/icon';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectBalance } from 'redux/selectors/wallet';
import { selectIsStillEditing, selectPublishFormValue } from 'redux/selectors/publish';
import {
  doUpdateFile,
  doUpdatePublishForm as doUpdatePublishFormAction,
  doUpdateTitle as doUpdateTitleAction,
} from 'redux/actions/publish';
import { PUBLISH_UPLOAD_ERROR_CLASS } from './classes';
import { TABLE_CLASS, TABLE_ITEM_LABEL_CLASS, TABLE_WRAPPER_CLASS } from 'component/common/table-classes';
import { HELP_CLASS, HELP_WARNING_CLASS } from 'component/common/help-classes';
type Props = {
  uri: string | null | undefined;
  disabled: boolean;
  livestreamData: Array<LivestreamReplayItem>;
  isCheckingLivestreams: boolean;
  inEditMode: boolean;
  hideTitleUrl?: boolean;
};
const INPUT_THROTTLE_MS = 750;
const REPLAY_TABLE_CLASS = `${TABLE_CLASS} tw:border-separate tw:[border-spacing:0] tw:[&_td:nth-of-type(1)]:max-w-[4rem] tw:[&_td:nth-of-type(2)]:min-w-[8.5rem] tw:[&_td:nth-of-type(3)]:w-[4rem] tw:[&_td:nth-of-type(3)]:min-w-[9rem] tw:[&_td:nth-of-type(4)]:hidden tw:small:[&_td:nth-of-type(2)]:w-[40%] tw:small:[&_td:nth-of-type(3)]:w-[5rem] tw:small:[&_td:nth-of-type(4)]:table-cell tw:small:[&_td:nth-of-type(4)]:w-full`;
const REPLAY_ROW_CLASS =
  'tw:cursor-pointer tw:rounded-app tw:[&_.radio]:cursor-pointer tw:[&_fieldset-section.radio]:pt-0 tw:[&_td]:bg-[rgba(var(--color-header-button-base),0.3)] tw:[&_td]:pr-app-m tw:[&_td]:![border-bottom:unset] tw:[&_td:first-child]:pl-app-s tw:[&_td:first-child]:pr-0 tw:[&_td:first-child]:[border-radius:var(--border-radius)_0_0_var(--border-radius)] tw:[&_td:last-child]:[border-radius:0_var(--border-radius)_var(--border-radius)_0] tw:hover:bg-[rgba(var(--color-header-button-base),0.6)] tw:hover:[&_td_label]:cursor-pointer tw:hover:[&_input]:cursor-pointer tw:hover:[&_fieldset-section.radio_label::before]:[box-shadow:0_0_0_2px_var(--color-primary)_inset] tw:upto-small:[&_td]:p-app-xs';
const REPLAY_ROW_SELECTED_CLASS =
  'tw:!bg-[rgba(var(--color-background-base),1)] tw:[&_td]:!rounded-none tw:[&_td:first-child]:![border-radius:var(--border-radius)_0_0_var(--border-radius)] tw:[&_td:last-child]:![border-radius:0_var(--border-radius)_var(--border-radius)_0]';

const normalizeUrlForProtocol = (url) => {
  if (url && url.startsWith('https://')) {
    return url;
  } else {
    if (url && url.startsWith('http://')) {
      return url;
    } else if (url) {
      return `https://${url}`;
    } else return __('Click Check for Replays to update...');
  }
};

function PublishLivestream(props: Props) {
  const { uri, disabled, livestreamData, isCheckingLivestreams, inEditMode, hideTitleUrl } = props;
  const dispatch = useAppDispatch();
  const title = useAppSelector((state) => selectPublishFormValue(state, 'title'));
  const filePath = useAppSelector((state) => selectPublishFormValue(state, 'filePath'));
  const fileBitrate = useAppSelector((state) => state.publish.fileBitrate);
  const fileSizeTooBig = useAppSelector((state) => state.publish.fileSizeTooBig);
  const liveCreateType = useAppSelector((state) => state.publish.liveCreateType);
  const liveEditType = useAppSelector((state) => state.publish.liveEditType);
  const isStillEditing = useAppSelector((state) => selectIsStillEditing(state));
  const balance = useAppSelector((state) => selectBalance(state));
  const publishing = useAppSelector((state) => selectPublishFormValue(state, 'publishing'));
  const duration = useAppSelector((state) => selectPublishFormValue(state, 'fileDur'));
  const isVid = useAppSelector((state) => selectPublishFormValue(state, 'fileVid'));
  const updatePublishForm = (value: UpdatePublishState) => dispatch(doUpdatePublishFormAction(value));
  const doUpdateTitle = (t: string, manual: boolean) => dispatch(doUpdateTitleAction(t, manual));
  const doUpdateFileFn = (file: WebFile, clearName: boolean) => dispatch(doUpdateFile(file, clearName));
  const livestreamDataStr = JSON.stringify(livestreamData);
  const hasLivestreamData = livestreamData && Boolean(livestreamData.length);
  const [urlChangedManually, setUrlChangedManually] = React.useState(false);
  const [titleValue, setTitleValue] = React.useState(title);
  const throttledTitle = useThrottle(titleValue, INPUT_THROTTLE_MS);
  const [selectedFileIndex, setSelectedFileIndex] = useState(null);
  const PAGE_SIZE = 4;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages =
    hasLivestreamData && livestreamData.length > PAGE_SIZE ? Math.ceil(livestreamData.length / PAGE_SIZE) : 1;
  const replayTitleLabel = !inEditMode ? __('Select Replay') : __('Use Replay');
  const TV_PUBLISH_SIZE_LIMIT_GB_STR = String(WEB_PUBLISH_SIZE_LIMIT_GB);

  const UPLOAD_SIZE_MESSAGE = __('%SITE_NAME% uploads are limited to %limit% GB.', {
    SITE_NAME,
    limit: TV_PUBLISH_SIZE_LIMIT_GB_STR,
  });

  const showReplaySelector = liveCreateType === 'choose_replay' || liveCreateType === 'edit_placeholder';

  // assert(inEditMode ? liveCreateType === 'edit_placeholder' : true, liveCreateType);

  // update remoteUrl when replay selected
  useEffect(() => {
    const livestreamData = JSON.parse(livestreamDataStr);

    if (selectedFileIndex !== null && livestreamData && livestreamData.length) {
      dispatch(
        doUpdatePublishFormAction({
          remoteFileUrl: normalizeUrlForProtocol(livestreamData[selectedFileIndex].data.fileLocation),
        })
      );
    }
  }, [selectedFileIndex, dispatch, livestreamDataStr]);

  function handlePaginateReplays(page) {
    setCurrentPage(page);
  }

  function handleTitleChange(event) {
    setTitleValue(event.target.value);
  }

  function flushTitle() {
    doUpdateTitle(titleValue || '', urlChangedManually);
  }

  function handleFileChange(file: WebFile, clearName = true) {
    doUpdateFileFn(file, clearName);
  }

  function getUploadMessage() {
    if (fileSizeTooBig) {
      return (
        <p className={PUBLISH_UPLOAD_ERROR_CLASS}>
          <Icon icon={ICONS.INFO} />
          {UPLOAD_SIZE_MESSAGE}{' '}
          <Button button="link" label={__('Upload Guide')} href="https://help.odysee.tv/category-uploading/" />
        </p>
      );
    }

    if (fileBitrate > BITRATE.RECOMMENDED) {
      return (
        <p className={HELP_WARNING_CLASS}>
          <Icon icon={ICONS.INFO} />
          {fileBitrate > BITRATE.MAX
            ? __(
                'Your video has a bitrate over ~16 Mbps and cannot be processed at this time. We suggest transcoding to provide viewers the best experience.'
              )
            : __(
                'Your video has a bitrate over 8 Mbps. We suggest transcoding to provide viewers the best experience.'
              )}{' '}
          <Button button="link" label={__('Upload Guide')} href="https://help.odysee.tv/category-uploading/" />
        </p>
      );
    }

    if (isVid && !duration) {
      return (
        <p className={HELP_WARNING_CLASS}>
          <Icon icon={ICONS.INFO} />
          {__(
            "Couldn't detect the video encoding. This video will not be playable in most browsers. We recommend to use H264/AAC encoding with MP4 container."
          )}{' '}
          <Button button="link" label={__('Upload Guide')} href="https://help.odysee.tv/category-uploading/" />
        </p>
      );
    }

    if (!isStillEditing) {
      return (
        <p className={HELP_CLASS}>
          <Icon icon={ICONS.INFO} />
          {__(
            'For video content, use MP4s in H264/AAC format and a friendly bitrate (under 8 Mbps) for more reliable streaming. %SITE_NAME% uploads are restricted to %limit% GB.',
            {
              SITE_NAME,
              limit: TV_PUBLISH_SIZE_LIMIT_GB_STR,
            }
          )}{' '}
          <Button button="link" label={__('Upload Guide')} href="https://help.odysee.tv/category-uploading/" />
        </p>
      );
    }
  }

  React.useEffect(() => {
    if (liveEditType !== 'use_replay') {
      setSelectedFileIndex(null);
    }
  }, [liveEditType, dispatch]);
  React.useEffect(() => {
    if (title !== titleValue) {
      setTitleValue(title);
    } // eslint-disable-next-line react-hooks/exhaustive-deps -- one way update only
  }, [title]);
  React.useEffect(() => {
    doUpdateTitle(throttledTitle || '', urlChangedManually);
  }, [throttledTitle, urlChangedManually]); // eslint-disable-line react-hooks/exhaustive-deps -- avoid recreating dispatcher
  return (
    <Card
      className={classnames({
        [CARD_CLASSES.disabled]: disabled || balance === 0,
      })}
      actions={
        <div className={PUBLISH_ROW_NO_MARGIN_CLASS}>
          <React.Fragment>
            {!hideTitleUrl && (
              <>
                <FormField
                  type="text"
                  name="content_title"
                  label={__('Title')}
                  placeholder={__('Descriptive titles work best')}
                  disabled={disabled}
                  value={titleValue}
                  onChange={handleTitleChange}
                  onBlur={flushTitle}
                  className={FIELDSET_GROUP_CLASS}
                  max={200}
                  autoFocus
                  autoComplete="off"
                />
                <PublishName uri={uri} onChange={() => setUrlChangedManually(true)} />
              </>
            )}
            <>
              {inEditMode && (
                <fieldset-group class={FIELDSET_GROUP_CLASS}>
                  <fieldset-section>
                    <label
                      style={{
                        marginBottom: 'var(--spacing-s)',
                      }}
                    >
                      {inEditMode && (
                        <FormField
                          name="reuse-replay"
                          label={__('Update only')}
                          key="reuse-replay"
                          type="radio"
                          checked={liveEditType === 'update_only'}
                          onChange={() => updatePublishForm({ liveEditType: 'update_only' })}
                        />
                      )}
                    </label>
                  </fieldset-section>
                </fieldset-group>
              )}
              {showReplaySelector && hasLivestreamData && !isCheckingLivestreams && (
                <>
                  {inEditMode && (
                    <label style={{ marginTop: 0 }}>
                      <FormField
                        name="show-replays"
                        label={replayTitleLabel}
                        key="show-replays"
                        type="radio"
                        checked={liveEditType === 'use_replay'}
                        onChange={() =>
                          updatePublishForm({
                            liveEditType: 'use_replay',
                            remoteFileUrl: undefined,
                          })
                        }
                      />
                    </label>
                  )}
                  <div
                    className={classnames('tw:overflow-hidden tw:rounded-app tw:bg-app-background', {
                      [DISABLED_CLASS]: inEditMode && liveEditType !== 'use_replay',
                    })}
                  >
                    <fieldset-section>
                      <div className={`${TABLE_WRAPPER_CLASS} tw:p-app-xxs tw:pt-0`}>
                        <table className={REPLAY_TABLE_CLASS}>
                          <tbody>
                            {livestreamData
                              .slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
                              .map((item, i) => {
                                const useStr = item.data.fileDuration && isNaN(item.data.fileDuration);
                                const durationMinutes = !useStr ? Math.floor(item.data.fileDuration / 60) : null;
                                const durationElem = useStr
                                  ? item.data.fileDuration
                                  : durationMinutes === 1
                                    ? __('%duration% minute', {
                                        duration: durationMinutes,
                                      })
                                    : __('%duration% minutes', {
                                        duration: durationMinutes,
                                      });
                                return (
                                  <React.Fragment key={item.data.fileLocation}>
                                    <tr className="tw:h-app-xxs" />
                                    <tr
                                      onClick={() => setSelectedFileIndex((currentPage - 1) * PAGE_SIZE + i)}
                                      className={classnames(REPLAY_ROW_CLASS, {
                                        [REPLAY_ROW_SELECTED_CLASS]:
                                          selectedFileIndex === (currentPage - 1) * PAGE_SIZE + i,
                                        'tw:bg-[rgba(var(--color-header-button-base),0.4)]':
                                          selectedFileIndex !== (currentPage - 1) * PAGE_SIZE + i,
                                      })}
                                    >
                                      <td>
                                        <FormField
                                          name="livestream-file"
                                          type="radio"
                                          checked={selectedFileIndex === (currentPage - 1) * PAGE_SIZE + i}
                                          label={null}
                                          onChange={() => {}}
                                          onClick={() => setSelectedFileIndex((currentPage - 1) * PAGE_SIZE + i)}
                                        />
                                      </td>
                                      <td>
                                        <div className="tw:flex tw:h-[4rem] tw:w-full tw:flex-row tw:overflow-hidden">
                                          {item.data.thumbnails.slice(0, 3).map((thumb) => (
                                            <img
                                              key={thumb}
                                              className="tw:mx-app-xxxs tw:my-0 tw:rounded-app tw:object-cover"
                                              src={thumb}
                                            />
                                          ))}
                                        </div>
                                      </td>
                                      <td>
                                        {durationElem}
                                        <div className={TABLE_ITEM_LABEL_CLASS}>
                                          {dayjs(item.data.uploadedAt).from(dayjs())}
                                        </div>
                                      </td>
                                      <td>
                                        <CopyableText
                                          primaryButton
                                          copyable={normalizeUrlForProtocol(item.data.fileLocation)}
                                          snackMessage={__('Url copied.')}
                                        />
                                      </td>
                                    </tr>
                                  </React.Fragment>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </fieldset-section>
                    {totalPages > 1 && (
                      <fieldset-group class={`${FIELDSET_GROUP_PAGINATE_CLASS} tw:!mt-app-xxs tw:!p-app-xxs`}>
                        <fieldset-section>
                          <ReactPaginate
                            pageCount={totalPages}
                            pageRangeDisplayed={2}
                            previousLabel="‹"
                            nextLabel="›"
                            activeClassName="pagination__item--selected"
                            pageClassName="pagination__item"
                            previousClassName="pagination__item pagination__item--previous"
                            nextClassName="pagination__item pagination__item--next"
                            breakClassName="pagination__item pagination__item--break"
                            marginPagesDisplayed={2}
                            onPageChange={(e) => handlePaginateReplays(e.selected + 1)}
                            forcePage={currentPage - 1}
                            initialPage={currentPage - 1}
                            containerClassName="pagination"
                          />
                        </fieldset-section>
                      </fieldset-group>
                    )}
                  </div>
                </>
              )}
              {showReplaySelector && !hasLivestreamData && !isCheckingLivestreams && (
                <>
                  {inEditMode && (
                    <label className={DISABLED_CLASS} style={{ marginTop: 0 }}>
                      <FormField
                        name="show-replays"
                        label={replayTitleLabel}
                        key="show-replays"
                        type="radio"
                        checked={liveEditType === 'use_replay'}
                        onChange={() =>
                          updatePublishForm({
                            liveEditType: 'use_replay',
                          })
                        }
                      />
                    </label>
                  )}
                  <div
                    className={`${EMPTY_CLASS} ${DISABLED_CLASS}`}
                    style={{
                      marginLeft: 'var(--spacing-m)',
                    }}
                  >
                    {__('No replays found.')}
                  </div>
                </>
              )}
              {showReplaySelector && isCheckingLivestreams && (
                <>
                  {inEditMode && (
                    <label className={DISABLED_CLASS} style={{ marginTop: 0 }}>
                      <FormField
                        name="replay-source"
                        label={replayTitleLabel}
                        value="choose"
                        key="show-replays-spin"
                        type="radio"
                        checked={liveEditType === 'use_replay'}
                        onChange={() =>
                          updatePublishForm({
                            liveEditType: 'use_replay',
                          })
                        }
                      />
                    </label>
                  )}
                  <div className={`main ${EMPTY_CENTERED_TIGHT_CLASS}`}>
                    <Spinner type="small" />
                  </div>
                </>
              )}

              {inEditMode && (
                <div className="tw:mt-app-m tw:[&_.help]:mb-0">
                  <label
                    style={{
                      marginTop: 0,
                    }}
                  >
                    <FormField
                      name="replay-source"
                      label={__('Upload Replay')}
                      type="radio"
                      checked={liveEditType === 'upload_replay'}
                      onChange={() => updatePublishForm({ liveEditType: 'upload_replay' })}
                    />
                  </label>
                  <FileSelector
                    disabled={liveEditType !== 'upload_replay'}
                    currentPath={typeof filePath === 'string' ? filePath : filePath?.name}
                    onFileChosen={handleFileChange}
                    accept={'video/mp4,video/x-m4v,video/*'}
                    placeholder={__('Select video replay file to upload')}
                  />
                  {getUploadMessage()}
                </div>
              )}
            </>
          </React.Fragment>
        </div>
      }
    />
  );
}

export default PublishLivestream;
