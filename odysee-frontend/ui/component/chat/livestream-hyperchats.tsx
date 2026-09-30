import { parseSticker } from 'util/comments';
import * as ICONS from 'constants/icons';
import Button from 'component/button';
import ChannelThumbnail from 'component/channelThumbnail';
import classnames from 'classnames';
import CreditAmount from 'component/common/credit-amount';
import Icon from 'component/common/icon';
import React from 'react';
import Slide from '@mui/material/Slide';
import { Lbryio } from 'lbryinc';
import { CHAT_CLASSES } from './classes';

type ChatCommentData = {
  comment_id: string;
  channel_url: string;
  channel_id: string;
  channel_name?: string;
  comment: string;
  is_fiat: boolean;
  is_global_mod: boolean;
  is_moderator: boolean;
  is_pinned: boolean;
  removed: boolean;
  support_amount: number;
  timestamp: number;
  [key: string]: any;
};

type Props = {
  superChats: Array<ChatCommentData>;
  hyperchatsHidden?: boolean;
  selectedHyperchat: ChatCommentData | null | undefined;
  channelTitle?: string;
  isMobile?: boolean;
  noHyperchats?: boolean;
  toggleHyperChat: () => void;
  handleHyperchatClick: (comment: any) => void;
  pinnedComment: ChatCommentData | null | undefined;
  pinActive?: boolean;
  onPinClick?: () => void;
};
export default function LivestreamHyperchats(props: Props) {
  const {
    superChats: hyperChatsByAmount,
    hyperchatsHidden,
    isMobile,
    toggleHyperChat,
    handleHyperchatClick,
    selectedHyperchat,
    pinnedComment,
    pinActive,
    onPinClick,
  } = props;
  const superChatTopTen = React.useMemo(() => {
    return hyperChatsByAmount ? hyperChatsByAmount.slice(0, 10) : hyperChatsByAmount;
  }, [hyperChatsByAmount]);
  const [exchangeRate, setExchangeRate] = React.useState(0);
  React.useEffect(() => {
    if (!exchangeRate) Lbryio.getExchangeRates().then(({ LBC_USD }) => setExchangeRate(LBC_USD));
  }, [exchangeRate]);
  const stickerSuperChats = hyperChatsByAmount && hyperChatsByAmount.filter(({ comment }) => !!parseSticker(comment));
  const showMore = superChatTopTen && hyperChatsByAmount && superChatTopTen.length < hyperChatsByAmount.length;
  const elRef = React.useRef<HTMLDivElement>(null);
  return !superChatTopTen ? null : (
    <Slider isMobile={isMobile} hyperchatsHidden={hyperchatsHidden}>
      <div
        ref={elRef}
        className={classnames(CHAT_CLASSES.hyperchatsWrapper, isMobile && CHAT_CLASSES.hyperchatsWrapperMobile)}
      >
        <div className={CHAT_CLASSES.hyperchats}>
          {pinnedComment && onPinClick && (
            <div
              className={classnames(
                CHAT_CLASSES.hyperchat,
                CHAT_CLASSES.hyperchatPin,
                pinActive && CHAT_CLASSES.hyperchatActive,
                pinActive && CHAT_CLASSES.hyperchatPinActive
              )}
              onClick={onPinClick}
            >
              <Icon icon={ICONS.PIN} size={16} />
            </div>
          )}
          {superChatTopTen.map((hyperChat: ChatCommentData) => {
            const { comment_id, channel_url, support_amount, is_fiat } = hyperChat;
            const isSticker = stickerSuperChats && stickerSuperChats.includes(hyperChat);
            const basedAmount = is_fiat && exchangeRate ? support_amount : support_amount * 10 * exchangeRate;
            const levelClass =
              basedAmount >= 500
                ? CHAT_CLASSES.hyperchatLevel5
                : basedAmount >= 100
                  ? CHAT_CLASSES.hyperchatLevel4
                  : basedAmount >= 50
                    ? CHAT_CLASSES.hyperchatLevel3
                    : basedAmount >= 10
                      ? CHAT_CLASSES.hyperchatLevel2
                      : basedAmount >= 5
                        ? CHAT_CLASSES.hyperchatLevel1
                        : undefined;
            return (
              <div
                key={comment_id}
                className={classnames(
                  CHAT_CLASSES.hyperchat,
                  isMobile && CHAT_CLASSES.hyperchatMobile,
                  levelClass,
                  selectedHyperchat && selectedHyperchat.comment_id === comment_id && CHAT_CLASSES.hyperchatActive
                )}
                onClick={() => handleHyperchatClick(hyperChat)}
              >
                <ChannelThumbnail uri={channel_url} xxsmall showMemberBadge />

                <div
                  className={classnames(
                    CHAT_CLASSES.hyperchatInfo,
                    stickerSuperChats && !isSticker && CHAT_CLASSES.hyperchatInfoNotSticker
                  )}
                >
                  <div className={CHAT_CLASSES.hyperchatInfoUser}>
                    <CreditAmount
                      hideTitle
                      size={10}
                      className={CHAT_CLASSES.hyperchatAmount}
                      amount={support_amount}
                      isFiat={is_fiat}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {showMore && (
            <div className={CHAT_CLASSES.showHyperchats}>
              <Button
                title={__('Show More...')}
                button="inverse"
                className="close-button"
                onClick={() => toggleHyperChat()}
                iconRight={ICONS.ARROW_RIGHT}
              />
            </div>
          )}
        </div>
      </div>
    </Slider>
  );
}
type SliderProps = {
  isMobile?: boolean;
  hyperchatsHidden?: boolean;
  children: any;
};

const Slider = (sliderProps: SliderProps) => {
  const { hyperchatsHidden, children } = sliderProps;
  return (
    <Slide direction="left" in={!hyperchatsHidden} mountOnEnter unmountOnExit>
      {children}
    </Slide>
  );
};
