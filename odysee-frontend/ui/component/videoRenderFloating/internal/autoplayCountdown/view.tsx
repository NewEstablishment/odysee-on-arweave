import React from 'react';
import classnames from 'classnames';
import { FILE_VIEWER_CLASSES } from 'component/viewers/classes';
import Button from 'component/button';
import { BUTTON_LARGE_ICON_CLASS, BUTTON_PLAY_CLASS } from 'component/button/classes';
import UriIndicator from 'component/uriIndicator';
import I18nMessage from 'component/i18nMessage';
import debounce from 'util/debounce';
import * as ICONS from 'constants/icons';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectTitleForUri, selectClaimIsNsfwForUri } from 'redux/selectors/claims';
import { selectModal } from 'redux/selectors/app';
import { selectIsPlayerFloating, selectCanPlaybackFileForUri, selectHasUriPlaying } from 'redux/selectors/content';
import { doPlayNextUri, doSetShowAutoplayCountdownForUri } from 'redux/actions/content';
import { AUTOPLAY_COUNTDOWN_CLASSES } from './classes';

const DEBOUNCE_SCROLL_HANDLER_MS = 150;

const COUNTDOWN_TIME = 5;
type Props = {
  uri?: string;
  onCancel: () => void;
  // -- withPlaybackUris HOC --
  playNextUri: string | null | undefined;
  playPreviousUri?: string;
};

function isAnyInputFocused() {
  const activeElement = document.activeElement;
  const inputTypes = ['input', 'select', 'textarea'];
  return activeElement && inputTypes.includes(activeElement.tagName.toLowerCase());
}

function AutoplayCountdown(props: Props) {
  const {
    uri,
    onCancel,
    // -- withPlaybackUris HOC --
    playNextUri,
    playPreviousUri,
  } = props;
  const dispatch = useAppDispatch();

  const playNextClaimTitle = useAppSelector((state) => selectTitleForUri(state, playNextUri));
  const modal = useAppSelector(selectModal);
  const isMature = useAppSelector((state) => selectClaimIsNsfwForUri(state, uri));
  const isFloating = useAppSelector(selectIsPlayerFloating);
  const canPlayback = useAppSelector((state) => selectCanPlaybackFileForUri(state, uri));
  const hasUriPlaying = useAppSelector((state) => selectHasUriPlaying(state));
  const [timer, setTimer] = React.useState(COUNTDOWN_TIME);
  const [timerCanceled, setTimerCanceled] = React.useState(false);
  const [timerPaused, setTimerPaused] = React.useState(false);
  const anyModalPresent = modal !== undefined && modal !== null;
  const isTimerPaused = timerPaused || anyModalPresent;
  const handleStopCountdown = React.useCallback(() => {
    setTimerCanceled(true);
    onCancel();
  }, [onCancel]);
  const handleCloseCountdown = React.useCallback(() => {
    handleStopCountdown();
    dispatch(
      doSetShowAutoplayCountdownForUri({
        uri,
        show: false,
      })
    );
  }, [dispatch, handleStopCountdown, uri]);
  const handlePlayNext = React.useCallback(
    (uri: string) => {
      handleStopCountdown();
      dispatch(
        doPlayNextUri({
          uri,
        })
      );
    },
    [dispatch, handleStopCountdown]
  );

  function shouldPauseAutoplay() {
    // TODO: use ref instead querySelector
    const elm = document.querySelector('[data-autoplay-countdown]');
    return isAnyInputFocused() || (elm && elm.getBoundingClientRect().top < 0);
  }

  React.useEffect(() => {
    setTimerCanceled(false);
  }, [uri]);
  // Update 'setTimerPaused'.
  React.useEffect(() => {
    // Ensure correct 'setTimerPaused' on initial render.
    setTimerPaused(shouldPauseAutoplay());
    const handleScroll = debounce((e) => {
      setTimerPaused(shouldPauseAutoplay());
    }, DEBOUNCE_SCROLL_HANDLER_MS);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll); // eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only
  }, []);
  // Update countdown timer.
  React.useEffect(() => {
    let interval;

    if (!timerCanceled && playNextUri) {
      if (isTimerPaused || isAnyInputFocused()) {
        clearInterval(interval);
        setTimer(COUNTDOWN_TIME);
      } else {
        interval = setInterval(() => {
          const newTime = timer - 1;

          if (newTime === 0) {
            if (isMature) setTimer(COUNTDOWN_TIME);
            handlePlayNext(playNextUri);
          } else {
            setTimer(timer - 1);
          }
        }, 1000);
      }
    }

    return () => {
      clearInterval(interval);
    };
  }, [handlePlayNext, isTimerPaused, playNextUri, isMature, timer, timerCanceled]);
  React.useEffect(() => {
    if (playNextUri === null) {
      handleStopCountdown();
    }
  }, [handleStopCountdown, playNextUri]);

  if (timerCanceled || !playNextUri) {
    return null;
  }

  return (
    <div className={FILE_VIEWER_CLASSES.overlay} data-file-viewer-overlay>
      <div className={AUTOPLAY_COUNTDOWN_CLASSES.root} data-autoplay-countdown>
        <div
          className={classnames(FILE_VIEWER_CLASSES.overlaySecondary, AUTOPLAY_COUNTDOWN_CLASSES.secondary)}
          data-file-viewer-overlay-secondary
        >
          <I18nMessage
            tokens={{
              channel: <UriIndicator link uri={playNextUri} />,
            }}
          >
            Up Next by %channel%
          </I18nMessage>
        </div>

        <div className={FILE_VIEWER_CLASSES.overlayTitle} data-file-viewer-overlay-title>
          {playNextClaimTitle}
        </div>
        <div className={AUTOPLAY_COUNTDOWN_CLASSES.timer}>
          <div
            className={classnames(
              AUTOPLAY_COUNTDOWN_CLASSES.button,
              AUTOPLAY_COUNTDOWN_CLASSES.progress[timer % COUNTDOWN_TIME]
            )}
          >
            <Button
              onClick={() => handlePlayNext(playNextUri)}
              iconSize={30}
              title={__('Play')}
              className={`${BUTTON_LARGE_ICON_CLASS} ${BUTTON_PLAY_CLASS}`}
            />
          </div>

          {isTimerPaused ? (
            <div
              className={classnames(
                FILE_VIEWER_CLASSES.overlaySecondary,
                AUTOPLAY_COUNTDOWN_CLASSES.secondary,
                AUTOPLAY_COUNTDOWN_CLASSES.counter
              )}
              data-file-viewer-overlay-secondary
            >
              {__('Autoplay timer paused.')}
            </div>
          ) : (
            <div
              className={classnames(
                FILE_VIEWER_CLASSES.overlaySecondary,
                AUTOPLAY_COUNTDOWN_CLASSES.secondary,
                AUTOPLAY_COUNTDOWN_CLASSES.counter
              )}
              data-file-viewer-overlay-secondary
            >
              {__(
                !canPlayback
                  ? 'Skipping to next playable content in %seconds_left% seconds...'
                  : 'Playing in %seconds_left% seconds...',
                {
                  seconds_left: timer,
                }
              ) + ' '}

              <Button
                label={__('Cancel')}
                button="link"
                onClick={() => {
                  handleStopCountdown();

                  // Don't close the floating player when cancelling an auto-skip unplayable countdown
                  // so that it can still be used for navigation
                  if (!isFloating || canPlayback) {
                    dispatch(
                      doSetShowAutoplayCountdownForUri({
                        uri,
                        show: false,
                      })
                    );
                  }
                }}
              />
            </div>
          )}

          {playPreviousUri && (
            <Button
              label={__('Play Previous')}
              button="link"
              icon={ICONS.PLAY_PREVIOUS}
              onClick={() => handlePlayNext(playPreviousUri)}
            />
          )}

          {hasUriPlaying && window.player && (
            <div>
              <Button
                label={__('Replay?')}
                button="link"
                icon={ICONS.REPLAY}
                onClick={() => {
                  handleCloseCountdown();
                  window.player.currentTime(0);
                  window.player.play();
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AutoplayCountdown;
