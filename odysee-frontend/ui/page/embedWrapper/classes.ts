export const EMBED_WRAPPER_CLASSES = {
  root: String.raw`tw:flex tw:h-screen tw:w-screen tw:flex-col tw:bg-[var(--color-black)] tw:text-white tw:supports-[height:100dvh]:h-dvh tw:[&_.yrbl\_\_wrap_:is(.section\_\_title,.section\_\_title--large,.section\_\_title--small)]:text-[var(--color-primary-contrast)] tw:[&_:is([data-file-viewer-document],[data-markdown-post])]:text-app-text tw:[&_.button-surface--play]:!inline-block tw:[&_video]:!rounded-none`,
  lightBackground: 'tw:[&_video]:bg-[var(--color-white)]',
} as const;

export const EMBED_WRAPPER_PAGE_CLASS =
  'tw:!block tw:!h-auto tw:!min-h-dvh tw:!w-full tw:!bg-app-background tw:!text-app-text';
