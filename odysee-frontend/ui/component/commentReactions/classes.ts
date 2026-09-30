export const COMMENT_REACTIONS_CREATOR_LIKE_CLASS =
  'tw:absolute tw:top-[0.4rem] tw:left-[0.4rem] tw:z-[3] tw:ml-[3px] tw:size-[0.8rem]';

export const COMMENT_REACTION_ACTIVE_CLASS = String.raw`tw:[&_.icon]:!stroke-app-primary tw:[&_.comment\_\_reaction-count]:text-[var(--reaction-button-accent)]`;

export const COMMENT_REACTION_CREATOR_ACTION_CLASS = String.raw`tw:disabled:!opacity-100 tw:[&_.button-surface\_\_content_.icon]:fill-transparent tw:[&_.button-surface\_\_content_.icon]:stroke-[rgba(var(--color-text-base),0.7)] tw:hover:[&_.button-surface\_\_content_.icon]:fill-app-primary tw:hover:[&_.button-surface\_\_content_.icon]:stroke-[rgba(var(--color-text-base),1)]`;
