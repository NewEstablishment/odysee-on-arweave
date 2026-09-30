import React, { useState } from 'react';
import classnames from 'classnames';
import Icon from 'component/common/icon';
import Button from 'component/button';
import * as ICONS from 'constants/icons';
// import twemoji from 'twemoji';
import Tooltip from 'component/common/tooltip';
import { CARD_CLASSES } from './card-classes';
import { CONTENT_ACCESS_INDICATOR_CLASSES } from './content-access-indicator-classes';
import { getThumbnailCdnUrl } from 'util/thumbnail';

type Props = {
  title?: string | React.ReactNode;
  titleClassName?: string;
  subtitle?: string | React.ReactNode;
  titleActions?: string | React.ReactNode;
  id?: string;
  body?: string | React.ReactNode;
  actions?: string | React.ReactNode;
  icon?: string;
  iconColor?: boolean;
  className?: string;
  isPageTitle?: boolean;
  noTitleWrap?: boolean;
  isBodyList?: boolean;
  defaultExpand?: boolean;
  nag?: React.ReactNode;
  smallTitle?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  secondPane?: React.ReactNode;
  slimHeader?: boolean;
  background?: boolean;
  backgroundImage?: string;
  singlePane?: boolean;
  headerActions?: React.ReactNode;
  gridHeader?: boolean;
  accessStatus?: string;
  style?: React.CSSProperties;
};

function Card(props: Props) {
  const {
    title,
    titleClassName,
    subtitle,
    titleActions,
    id,
    body,
    actions,
    icon,
    className,
    isPageTitle = false,
    isBodyList = false,
    // noTitleWrap = false,
    smallTitle = false,
    defaultExpand,
    nag,
    onClick,
    children,
    secondPane,
    slimHeader,
    background,
    backgroundImage,
    singlePane,
    headerActions,
    accessStatus,
    gridHeader,
  } = props;
  const [expanded, setExpanded] = useState(defaultExpand);
  const expandable = defaultExpand !== undefined;
  return (
    <section
      role={onClick ? 'button' : undefined}
      className={classnames(className, 'card', {
        [CARD_CLASSES.multiPane]: Boolean(secondPane),
        [CARD_CLASSES.background]: background,
      })}
      id={id}
      onClick={(e) => {
        if (onClick) {
          onClick();
          e.stopPropagation();
        }
      }}
    >
      {backgroundImage && (
        <div
          className="background"
          style={{
            backgroundImage: `url(${getThumbnailCdnUrl({
              thumbnail: backgroundImage,
              width: 390,
              height: 0,
              quality: 85,
            })})`,
          }}
        />
      )}
      <FirstPaneWrapper singlePane={singlePane}>
        {(title || subtitle) && (
          <div
            className={classnames('card__header--between', {
              [CARD_CLASSES.headerSlim]: slimHeader,
              [CARD_CLASSES.headerGrid]: gridHeader,
            })}
          >
            <div
              className={classnames('card__title-section', {
                [CARD_CLASSES.titleSectionBodyList]: isBodyList,
              })}
            >
              {icon && <Icon sectionIcon icon={icon} />}

              <div className={CARD_CLASSES.titleText}>
                <TitleWrapper
                  isPageTitle={isPageTitle}
                  smallTitle={smallTitle}
                  accessStatus={accessStatus}
                  className={titleClassName}
                >
                  {title}
                </TitleWrapper>

                {subtitle && (
                  <div className={smallTitle ? CARD_CLASSES.subtitleSmall : CARD_CLASSES.subtitle}>{subtitle}</div>
                )}
              </div>
            </div>

            {(titleActions || expandable) && (
              <div
                className={classnames(CARD_CLASSES.titleActionsContainer, {
                  [CARD_CLASSES.titleActionsContainerGrid]: gridHeader,
                })}
              >
                {titleActions && (
                  <div
                    className={classnames(CARD_CLASSES.titleActions, {
                      [CARD_CLASSES.titleActionsGrid]: gridHeader,
                      [CARD_CLASSES.titleActionsSmall]: smallTitle,
                    })}
                  >
                    {titleActions}
                  </div>
                )}
                {expandable && (
                  <div
                    className={classnames(CARD_CLASSES.titleActions, {
                      [CARD_CLASSES.titleActionsGrid]: gridHeader,
                    })}
                  >
                    <Button
                      button="alt"
                      aria-expanded={expanded}
                      aria-label={expanded ? __('Less') : __('More')}
                      icon={expanded ? ICONS.SUBTRACT : ICONS.ADD}
                      onClick={() => setExpanded(!expanded)}
                    />
                  </div>
                )}
              </div>
            )}

            {headerActions}
          </div>
        )}

        {(!expandable || (expandable && expanded)) && (
          <>
            {body && (
              <div
                className={classnames('card__body', {
                  [CARD_CLASSES.bodyNoTitle]: !title && !subtitle,
                  [CARD_CLASSES.bodyWithTitle]: title || subtitle,
                  [CARD_CLASSES.bodyList]: isBodyList,
                })}
              >
                {body}
              </div>
            )}
            {actions && <div className="card__main-actions">{actions}</div>}
            {children && <div className="card__main-actions">{children}</div>}
          </>
        )}

        {nag}
      </FirstPaneWrapper>

      {secondPane && <div className={CARD_CLASSES.secondPane}>{secondPane}</div>}
    </section>
  );
}

type FirstPaneProps = {
  singlePane?: boolean;
  children: any;
};

const FirstPaneWrapper = (props: FirstPaneProps) => {
  const { singlePane, children } = props;
  return singlePane ? children : <div className={CARD_CLASSES.firstPane}>{children}</div>;
};

type TitleProps = {
  isPageTitle?: boolean;
  smallTitle?: boolean;
  className?: string;
  children?: any;
  emoji?: any;
  accessStatus?: string;
};

function transformer(children) {
  for (let child in children?.props?.children) {
    if (typeof children?.props?.children[child] === 'string') {
      return children?.props?.children[child];
    }
  }

  return children;
}

const TitleWrapper = (props: TitleProps) => {
  const { isPageTitle, smallTitle, className, children, accessStatus } = props;

  /*
  const Twemoji = ({ emoji }) => (
    <span
      dangerouslySetInnerHTML={{
        __html: twemoji.parse(emoji, {
          folder: 'svg',
          ext: '.svg',
        }),
      }}
    />
  );
  */
  const AccessIndicator = (par: any) => {
    return (
      <Tooltip title={__('This is a members-only content')}>
        <div
          className={classnames(CONTENT_ACCESS_INDICATOR_CLASSES.root, {
            [CONTENT_ACCESS_INDICATOR_CLASSES.locked]: par.status === 'locked',
            [CONTENT_ACCESS_INDICATOR_CLASSES.unlocked]: par.status === 'unlocked',
            [CONTENT_ACCESS_INDICATOR_CLASSES.purchased]: par.status === 'purchased',
          })}
        >
          <Icon icon={par.status === 'locked' ? ICONS.LOCK : ICONS.UNLOCK} />
        </div>
      </Tooltip>
    );
  };

  /*
  function transformer(children) {
    for (let child in children?.props?.children) {
      if (typeof children?.props?.children[child] === 'string') {
        return <Twemoji emoji={children?.props?.children[child]} />;
      }
    }
    return children;
  }
  */

  return isPageTitle ? (
    <h1 className={classnames('card__title', className)}>
      {accessStatus && <AccessIndicator status={accessStatus} />}
      <span
        dangerouslySetInnerHTML={{
          __html: transformer(children),
        }}
      />
    </h1>
  ) : (
    <h2
      className={classnames(
        'card__title',
        {
          'tw:text-app-body': smallTitle,
        },
        className
      )}
    >
      {children}
    </h2>
  );
};

export default Card;
