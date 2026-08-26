import { useEffect, useRef } from 'react';
import Player from '../player';
import analytics from 'analytics';
import { sendAnalyticsAction } from 'analytics/hyperbeam';

export default function useEventTracking(
  claimId,
  userId,
  claimValues,
  channelTitle,
  embedded,
  uri,
  isLivestreamClaim,
  doAnalyticsViewForUri,
  doAnalyticsBuffer,
  claimRewards
) {
  const store = Player.usePlayer();
  const media = Player.useMedia();
  const firstPlayTrackedRef = useRef(false);
  const startTimeRef = useRef(null);
  const bufferStartRef = useRef(null);

  useEffect(() => {
    if (!media || !claimId) return;

    firstPlayTrackedRef.current = false;
    startTimeRef.current = null;
    bufferStartRef.current = null;
    const playerShim = {
      currentSource: () => ({
        type: media.currentSrc && media.currentSrc.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/mp4',
        src: media.currentSrc,
      }),
      get currentTime() {
        return media.currentTime;
      },
      get duration() {
        return media.duration;
      },
      get seeking() {
        return media.seeking;
      },
    };

    const handlePlay = () => {
      if (startTimeRef.current === null) {
        startTimeRef.current = performance.now();
      }
      if (!isLivestreamClaim) void sendAnalyticsAction('play', claimId);
    };

    const handlePause = () => {
      if (!isLivestreamClaim && firstPlayTrackedRef.current && !media.ended) {
        void sendAnalyticsAction('pause', claimId);
      }
    };

    const handleEnded = () => {
      if (!isLivestreamClaim && firstPlayTrackedRef.current) {
        analytics.video.videoCompleteEvent();
        void sendAnalyticsAction('complete', claimId, true);
        firstPlayTrackedRef.current = false;
        startTimeRef.current = null;
      }
    };

    const handlePlaying = () => {
      if (!firstPlayTrackedRef.current && startTimeRef.current !== null) {
        firstPlayTrackedRef.current = true;
        const secondsToLoad = (performance.now() - startTimeRef.current) / 1000;

        analytics.event.playerVideoStarted(embedded);

        if (!isLivestreamClaim && claimValues?.source?.size) {
          const contentInBits = Number(claimValues.source.size) * 8;
          const durationInSeconds = claimValues.video?.duration;
          let bitrateAsBitsPerSecond;
          if (durationInSeconds) {
            bitrateAsBitsPerSecond = Math.round(contentInBits / durationInSeconds);
          }

          analytics.video.videoStartEvent(
            claimId,
            secondsToLoad,
            'player-v10',
            userId,
            uri,
            playerShim,
            bitrateAsBitsPerSecond,
            isLivestreamClaim
          );
        } else {
          analytics.video.videoStartEvent(
            claimId,
            0,
            'player-v10',
            userId,
            uri,
            playerShim,
            undefined,
            isLivestreamClaim
          );
        }

        doAnalyticsViewForUri(uri).then(claimRewards);
      }

      analytics.video.videoIsPlaying(true, playerShim);

      if (bufferStartRef.current !== null) {
        const bufferDuration = (performance.now() - bufferStartRef.current) / 1000;
        doAnalyticsBuffer(uri, {
          timeAtBuffer: store.state.currentTime,
          bufferDuration,
          isLivestream: isLivestreamClaim,
          playPoweredBy: isLivestreamClaim ? 'lvs' : 'player-v10',
        });
        bufferStartRef.current = null;
      }
    };

    const handleWaiting = () => {
      if (firstPlayTrackedRef.current) {
        bufferStartRef.current = performance.now();
        analytics.video.videoIsPlaying(false, playerShim);
      }
    };

    media.addEventListener('play', handlePlay);
    media.addEventListener('pause', handlePause);
    media.addEventListener('ended', handleEnded);
    media.addEventListener('playing', handlePlaying);
    media.addEventListener('waiting', handleWaiting);

    return () => {
      media.removeEventListener('play', handlePlay);
      media.removeEventListener('pause', handlePause);
      media.removeEventListener('ended', handleEnded);
      media.removeEventListener('playing', handlePlaying);
      media.removeEventListener('waiting', handleWaiting);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media, claimId, uri]);
}
