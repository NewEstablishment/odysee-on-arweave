export const CLAIM_GRID_CLASS = String.raw`tw:flex tw:flex-wrap tw:[list-style:none] tw:items-start tw:[[data-upcoming-grid]_&]:opacity-100 tw:[[data-upcoming-grid]_&]:[transition:opacity_0.2s,display_0.2] tw:[[data-upcoming-list]_&]:opacity-100 tw:[[data-upcoming-list]_&]:[transition:opacity_0.2s,display_0.2] tw:[[data-upcoming-grid][data-upcoming-closed]_&]:h-0 tw:[[data-upcoming-grid][data-upcoming-closed]_&]:overflow-hidden tw:[[data-upcoming-grid][data-upcoming-closed]_&]:opacity-0`;

export const CLAIM_SHORTS_GRID_CLASS = String.raw`claim-shorts-grid tw:upto-small:flex tw:upto-small:items-start! tw:upto-small:gap-[5px]! tw:upto-small:[&_:not(:first-child)]:mt-px!`;

export const CLAIM_TILE_ABOUT_CLASS = String.raw`claim-tile__about tw:overflow-hidden tw:whitespace-nowrap tw:text-app-xsmall tw:text-app-text-subtitle tw:[&>*]:block`;

export const CLAIM_GRID_WRAPPER_CLASS = 'tw:mt-app-s tw:flex tw:flex-col tw:pb-app-l';

export const CLAIM_GRID_HEADER_CLASS = String.raw`tw:my-app-m tw:flex tw:items-center tw:[[data-upcoming-grid]_&]:mt-0 tw:[&_.button]:whitespace-normal tw:[&_.button:hover]:no-underline tw:[&_.icon\_\_wrapper]:mt-[-2px] tw:[&_.icon\_\_wrapper]:mr-app-m tw:[&_.icon\_\_wrapper]:size-[0.5rem] tw:[&_.icon\_\_wrapper]:bg-app-text tw:[&_.icon\_\_wrapper]:p-[1rem] tw:[&_.icon\_\_wrapper_.icon]:stroke-[rgba(var(--color-header-background-base),1)] tw:small:[&_.icon\_\_wrapper]:size-[1rem] tw:[&_.button-surface\_\_content:hover_.icon\_\_wrapper]:bg-app-primary tw:[&_.button-surface\_\_content:hover_.icon\_\_wrapper_.icon]:stroke-white tw:[&_.button-surface\_\_content:hover_.icon\_\_wrapper--Heart_.icon]:fill-white tw:[&_.button-surface\_\_content:hover_[data-claim-grid-title]]:text-app-primary`;

export const CLAIM_GRID_TITLE_CLASS = 'tw:mr-app-m tw:flex tw:text-app-large tw:font-bold tw:text-app-text';

export const CLAIM_GRID_SECONDARY_TITLE_CLASS = 'tw:ml-auto';

export const CLAIM_GRID_VIEW_MORE_CLASS = 'tw:mb-app-xl tw:flex tw:items-end tw:small:mt-[calc(var(--spacing-m)*-1)]';
