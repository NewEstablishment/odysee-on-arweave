import { EMOTES_48px as ODYSEE_EMOTES, TWEMOTES } from 'constants/emotes';
import * as ICONS from 'constants/icons';
// import Icon from 'component/common/icon';
import Button from 'component/button';
import { FILE_ACTION_BUTTON_CLASS } from 'component/common/file-action-button-classes';
import CreditAmount from 'component/common/credit-amount';
import React from 'react';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'component/common/tabs';
import { FREE_GLOBAL_STICKERS, PAID_GLOBAL_STICKERS } from 'constants/stickers';
import { useIsMobile } from 'effects/use-screensize';
import classnames from 'classnames';
import { COMMENT_CREATE_CLASSES } from '../classes';
let gMountedOnce = false;
export const SELECTOR_TABS = {
  EMOJI: 0,
  STICKER: 1,
};
type Props = {
  claimIsMine?: boolean;
  isOpen?: boolean;
  openTab?: number;
  addEmoteToComment: (arg0: string) => void;
  handleSelectSticker: (arg0: any) => void;
  closeSelector?: () => void;
};
export default function CommentSelectors(props: Props) {
  const { claimIsMine, isOpen, openTab, addEmoteToComment, handleSelectSticker, closeSelector } = props;
  const tabProps = {
    closeSelector,
  };
  const [mount, setMount] = React.useState(gMountedOnce);
  React.useEffect(() => {
    // One-time mount prevention to avoid all emojis to be fetched on page load.
    // This is just a band aide since it would still fetch all when the selector
    // is opened. The panels need to be tweaked to support pagination.
    if (!mount && isOpen) {
      setTimeout(() => {
        setMount(true);
        gMountedOnce = true;
      }, 75);
    }
  }, [mount, isOpen]);
  return (
    <Tabs
      index={openTab}
      className={classnames(
        COMMENT_CREATE_CLASSES.tabs,
        COMMENT_CREATE_CLASSES.tabsComment,
        isOpen && COMMENT_CREATE_CLASSES.tabsOpen
      )}
      onChange={() => {}}
    >
      <TabList className={COMMENT_CREATE_CLASSES.tabList}>
        <Tab className={COMMENT_CREATE_CLASSES.tab}>{__('Emojis')}</Tab>
        <Tab className={COMMENT_CREATE_CLASSES.tab}>{__('Stickers')}</Tab>
      </TabList>

      <TabPanels>
        <TabPanel>{mount && <EmojisPanel handleSelect={(emote) => addEmoteToComment(emote)} {...tabProps} />}</TabPanel>

        <TabPanel>
          {mount && (
            <StickersPanel
              handleSelect={(sticker) => handleSelectSticker(sticker)}
              claimIsMine={claimIsMine}
              {...tabProps}
            />
          )}
        </TabPanel>
      </TabPanels>
    </Tabs>
  );
}
type EmojisProps = {
  handleSelect: (emoteName: string) => void;
  closeSelector: () => void;
};

function scrollToCategory(category, reference, isMobile) {
  const offset = isMobile ? 48 : 58;
  let categoryAnchor = reference.current.querySelector('#' + category.replace(/\s|&/g, ''));
  reference &&
    categoryAnchor &&
    reference.current.scrollTo({
      top: categoryAnchor.offsetTop - offset,
      behavior: 'smooth',
    });
}

function handleHover(name) {
  let preview = document.getElementById('emoji-code-preview');

  if (preview) {
    preview.innerHTML = name;
    preview.style.display = 'inline';
    if (name) preview.style.display = 'inline';
    else preview.style.display = 'none';
  }
}

const EmojisPanel = (emojisProps: EmojisProps) => {
  const { handleSelect, closeSelector } = emojisProps;
  const defaultRowProps = {
    handleSelect,
  };
  const isMobile = useIsMobile();
  const emojiSelectorRef = React.useRef();
  // prettier-ignore
  const CATEGORY_INFOS = [{
    key: 'odysee',
    name: 'Odysee',
    mainImg: '48%20px/smile%402x.png',
    images: ODYSEE_EMOTES
  }, {
    key: 'smilies',
    name: __('Smilies'),
    mainImg: 'twemoji/smilies/grinning.png',
    images: TWEMOTES.SMILIES
  }, {
    key: 'hand signals',
    name: __('Hand signals'),
    mainImg: 'twemoji/handsignals/waving_hand.png',
    images: TWEMOTES.HANDSIGNALS
  }, {
    key: 'activities',
    name: __('Activities'),
    mainImg: 'twemoji/activities/tennis.png',
    images: TWEMOTES.ACTIVITIES
  }, {
    key: 'symbols',
    name: __('Symbols'),
    mainImg: 'twemoji/symbols/sparkling_heart.png',
    images: TWEMOTES.SYMBOLS
  }, {
    key: 'animals & nature',
    name: __('Animals & Nature'),
    mainImg: 'twemoji/nature/dolphin.png',
    images: TWEMOTES.NATURE
  }, {
    key: 'food & drink',
    name: __('Food & Drink'),
    mainImg: 'twemoji/food/sushi.png',
    images: TWEMOTES.FOOD
  }, {
    key: 'flags',
    name: __('Flags'),
    mainImg: 'twemoji/flags/pirate_flag.png',
    images: TWEMOTES.FLAGS
  }];
  return (
    <div className={COMMENT_CREATE_CLASSES.selectorMenu} ref={emojiSelectorRef}>
      <Button button="close" icon={ICONS.REMOVE} onClick={closeSelector} />
      <div id="emoji-code-preview" className={COMMENT_CREATE_CLASSES.emojiPreview} />
      <div className={COMMENT_CREATE_CLASSES.emojiCategories}>
        {/* <Icon icon={ICONS.TIME} /> */}
        {CATEGORY_INFOS.map((x) => (
          <img
            key={x.key}
            onClick={() => scrollToCategory(x.key, emojiSelectorRef, isMobile)}
            onMouseEnter={() => handleHover(x.name)}
            onMouseLeave={() => handleHover('')}
            loading="lazy"
            src={`https://static.odycdn.com/emoticons/${x.mainImg}`}
          />
        ))}
      </div>

      {/* <EmoteCategory title={__('Recently used')} {...defaultRowProps} /> */}
      {CATEGORY_INFOS.map((x) => (
        <EmoteCategory key={x.key} title={x.name} images={x.images} {...defaultRowProps} handleHover={handleHover} />
      ))}
    </div>
  );
};

type StickersProps = {
  claimIsMine: any;
  handleSelect: (arg0: any) => void;
  closeSelector: () => void;
};

const StickersPanel = (stickersProps: StickersProps) => {
  const { claimIsMine, handleSelect, closeSelector } = stickersProps;
  const defaultRowProps = {
    handleSelect,
  };
  const stickerSelectorRef = React.useRef();
  const isMobile = useIsMobile();
  return (
    <div className={COMMENT_CREATE_CLASSES.selectorMenu} ref={stickerSelectorRef}>
      <Button button="close" icon={ICONS.REMOVE} onClick={closeSelector} />
      <div id="emoji-code-preview" className={COMMENT_CREATE_CLASSES.emojiPreview} />
      <div className={COMMENT_CREATE_CLASSES.emojiCategories}>
        <img
          onClick={() => scrollToCategory('free', stickerSelectorRef, isMobile)}
          onMouseEnter={() => handleHover(__('Free'))}
          onMouseLeave={() => handleHover('')}
          loading="lazy"
          src="https://static.odycdn.com/stickers/HYPE/PNG/hype_with_border.png"
        />
        {!claimIsMine && (
          <img
            onClick={() => scrollToCategory('tips', stickerSelectorRef, isMobile)}
            onMouseEnter={() => handleHover(__('Tips'))}
            onMouseLeave={() => handleHover('')}
            loading="lazy"
            src="https://static.odycdn.com/stickers/TIPS/png/with%20borderlarge$tip.png"
          />
        )}
      </div>
      <StickerCategory
        title={__('Free')}
        images={FREE_GLOBAL_STICKERS}
        {...defaultRowProps}
        handleHover={handleHover}
      />
      {!claimIsMine && (
        <StickerCategory
          title={__('Tips')}
          images={PAID_GLOBAL_STICKERS}
          {...defaultRowProps}
          handleHover={handleHover}
        />
      )}
    </div>
  );
};

type RowProps = {
  title: string;
  images?: any;
  handleSelect: (arg0: string) => void;
  handleHover: (arg0: string) => void;
};

const EmoteCategory = (rowProps: RowProps) => {
  const { images, title, handleSelect, handleHover } = rowProps;
  return (
    <>
      <a id={title.replace(/\s|&/g, '').toLowerCase()}>
        <label id={title} className={COMMENT_CREATE_CLASSES.categoryTitle}>
          {title}
        </label>
      </a>

      <div className={classnames(COMMENT_CREATE_CLASSES.selectorItems, COMMENT_CREATE_CLASSES.emoteItems)}>
        {images &&
          images.map((emote) => {
            const { name, url } = emote;
            return (
              <Button
                key={name}
                title={name}
                button="alt"
                className={FILE_ACTION_BUTTON_CLASS}
                onClick={() => handleSelect(name)}
                onMouseEnter={() => handleHover(name)}
                onMouseLeave={() => handleHover('')}
              >
                <img src={url} loading="lazy" />
              </Button>
            );
          })}
      </div>
    </>
  );
};

const StickerCategory = (rowProps: RowProps) => {
  const { images, title, handleSelect, handleHover } = rowProps;
  return (
    <>
      <a id={title.replace(/\s|&/g, '').toLowerCase()}>
        <label id={title} className={COMMENT_CREATE_CLASSES.categoryTitle}>
          {title}
        </label>
      </a>
      <div className={classnames(COMMENT_CREATE_CLASSES.selectorItems, COMMENT_CREATE_CLASSES.stickerItems)}>
        {images &&
          images.map((sticker) => {
            const { price, url, name } = sticker;
            return (
              <Button
                key={name}
                title={name}
                button="alt"
                className={FILE_ACTION_BUTTON_CLASS}
                onClick={() => handleSelect(sticker)}
                onMouseEnter={() => handleHover(sticker)}
                onMouseLeave={() => handleHover('')}
              >
                <StickerWrapper price={price}>
                  <img src={url} loading="lazy" />
                  {price && price > 0 && <CreditAmount superChatLight amount={price} size={2} isFiat />}
                </StickerWrapper>
              </Button>
            );
          })}
      </div>
    </>
  );
};

type StickerProps = {
  price?: number;
  children: any;
};

const StickerWrapper = (stickerProps: StickerProps) => {
  const { price, children } = stickerProps;
  return price ? <div className={COMMENT_CREATE_CLASSES.pricedSticker}>{children}</div> : children;
};
