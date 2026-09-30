import React from 'react';
import classnames from 'classnames';
import Card from 'component/common/card';
import Button from 'component/button';
import { BUTTON_TOGGLE_CLASS } from 'component/button/classes';
import * as ICONS from 'constants/icons';
import * as SETTINGS from 'constants/settings';
import parseChapters from 'util/parse-chapters';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectClaimForUri } from 'redux/selectors/claims';
import { selectClientSetting } from 'redux/selectors/settings';
import { doSetClientSetting } from 'redux/actions/settings';
import { getClaimMetadata } from 'util/claim';
import { CHAPTERS_CARD_CLASSES } from './classes';

type Props = {
  uri?: string;
  description?: string;
  visible?: boolean;
  setVisible?: (val: boolean) => void;
};

export default function ChaptersCard(props: Props) {
  const { uri, description: descriptionProp, visible: visibleProp, setVisible: setVisibleProp } = props;

  const dispatch = useAppDispatch();
  const claim = useAppSelector((state) => (uri ? selectClaimForUri(state, uri) : undefined));
  const metadata = getClaimMetadata(claim);
  const reduxVisible = useAppSelector((state) => selectClientSetting(state, SETTINGS.CHAPTERS_CARD_VISIBLE)) || false;

  const description = descriptionProp !== undefined ? descriptionProp : metadata?.description;
  const visible = visibleProp !== undefined ? visibleProp : reduxVisible;
  const setVisible =
    setVisibleProp || ((val: boolean) => dispatch(doSetClientSetting(SETTINGS.CHAPTERS_CARD_VISIBLE, val)));

  const chapters = React.useMemo(() => parseChapters(description), [description]);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const activeItemRef = React.useRef(null);
  const listRef = React.useRef(null);

  React.useEffect(() => {
    function handleToggle() {
      setVisible(!visible);
    }
    window.addEventListener('toggleChaptersCard', handleToggle);
    return () => window.removeEventListener('toggleChaptersCard', handleToggle);
  }, [visible, setVisible]);

  React.useEffect(() => {
    if (chapters.length === 0) return;

    let currentPlayer = null;

    function onTimeUpdate() {
      const p = window.player;
      if (!p) return;
      const currentTime = p.currentTime();
      let idx = -1;
      for (let i = chapters.length - 1; i >= 0; i--) {
        if (currentTime >= chapters[i].time) {
          idx = i;
          break;
        }
      }
      setActiveIndex(idx);
    }

    function attach() {
      const p = window.player;
      if (!p) return;
      if (currentPlayer) {
        currentPlayer.off('timeupdate', onTimeUpdate);
        currentPlayer.off('seeked', onTimeUpdate);
      }
      currentPlayer = p;
      p.on('timeupdate', onTimeUpdate);
      p.on('seeked', onTimeUpdate);
      onTimeUpdate();
    }

    attach();
    window.addEventListener('playerReady', attach);

    return () => {
      window.removeEventListener('playerReady', attach);
      if (currentPlayer) {
        currentPlayer.off('timeupdate', onTimeUpdate);
        currentPlayer.off('seeked', onTimeUpdate);
      }
    };
  }, [chapters]);

  React.useEffect(() => {
    if (activeItemRef.current && listRef.current && visible) {
      const list = listRef.current;
      const item = activeItemRef.current;
      const listCenter = list.offsetHeight / 2;
      const topToScroll = item.offsetTop - list.offsetTop - listCenter;
      try {
        list.scrollTo({ top: topToScroll, behavior: 'smooth' });
      } catch (e) {}
    }
  }, [activeIndex, visible]);

  if (chapters.length === 0 || !visible) return null;

  function handleChapterClick(time, index) {
    setActiveIndex(index);
    if (window.player) {
      window.player.currentTime(time);
    } else {
      window.pendingSeekTime = time;
      const playButton = document.querySelector('.button-surface--play');
      if (playButton) (playButton as HTMLElement).click();
    }
    window.scrollTo(0, 0);
  }

  return (
    <Card
      className={CHAPTERS_CARD_CLASSES.root}
      smallTitle
      slimHeader
      singlePane
      title={
        <span className={CHAPTERS_CARD_CLASSES.title}>
          {__('Chapters')}
          <span className={CHAPTERS_CARD_CLASSES.count}>
            {activeIndex >= 0 ? activeIndex + 1 : 0}/{chapters.length}
          </span>
        </span>
      }
      titleActions={<Button className={BUTTON_TOGGLE_CLASS} icon={ICONS.REMOVE} onClick={() => setVisible(false)} />}
      body={
        <ul className={CHAPTERS_CARD_CLASSES.list} ref={listRef}>
          {chapters.map((chapter, i) => (
            <li
              key={i}
              ref={i === activeIndex ? activeItemRef : undefined}
              className={classnames(CHAPTERS_CARD_CLASSES.item, {
                [CHAPTERS_CARD_CLASSES.itemActive]: i === activeIndex,
              })}
            >
              <button className={CHAPTERS_CARD_CLASSES.button} onClick={() => handleChapterClick(chapter.time, i)}>
                <span className={CHAPTERS_CARD_CLASSES.timestamp}>
                  <span>{chapter.timestamp}</span>
                </span>
                <span className={CHAPTERS_CARD_CLASSES.label}>{chapter.label}</span>
              </button>
            </li>
          ))}
        </ul>
      }
    />
  );
}
