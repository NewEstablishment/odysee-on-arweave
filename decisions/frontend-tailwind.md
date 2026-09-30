# Tailwind-First Frontend Styling

Status: accepted

Date: 2026-09-11

## Context

The frontend styling system grew as global Sass partials, component and page
entry styles, theme overrides, dynamically constructed BEM modifiers, and
third-party DOM skins. The migration started with 207 SCSS files and 135
independently loaded style entries.

A direct textual conversion is unsafe. Sass nesting, import order, `@extend`,
runtime class composition, lazy style chunks, media queries, theme variables,
RTL processing, portals, generated markup, and player fullscreen states all
affect the resulting cascade.

## Decision

The frontend uses a Tailwind-first styling architecture with verified
component-family contracts.

1. Tailwind utilities are the default for DOM owned by React components.
2. Shared semantic variants may use typed component classes when repeating the
   same utility group is less clear or would weaken a stable component
   contract. Low-specificity control foundations live in the `primitives`
   layer before contextual component rules.
3. Existing CSS custom properties remain the semantic design-token API until a
   separately verified token migration replaces them.
4. A small plain-CSS compatibility layer remains for DOM the application does
   not own, generated Markdown and document content, browser pseudo-elements,
   keyframes, fullscreen behavior, and third-party libraries such as Video.js,
   MUI, CodeMirror, and React Datepicker.
5. Sass nesting, mixins, variables, imports, and `@extend` are not part of the
   source architecture. Tailwind-first does not mean forcing third-party
   selectors into JSX.
6. Tailwind Preflight stays disabled. `ui/styles/base.css` owns the explicit
   application reset.
7. `ui/styles/index.css` owns one ordered global cascade. Route-level CSS is
   limited to generated Tailwind utility chunks with explicit, disjoint source
   ownership. Shared utility candidates remain in the root entry, and lazy
   chunks may not contain semantic rules or cascade patches.
8. Semantic selectors remain only where a utility cannot clearly express a
   shared application contract or where the application does not own the DOM.
9. Vite's CSS lowering target must cover the supported browser matrix. Stale
   legacy targets must not persist by accident and force unnecessary
   compatibility expansion.

## Verification contract

Styling changes must verify the affected behavior across:

- light and dark themes;
- every project breakpoint and supported viewport family;
- RTL behavior;
- hover, focus, active, disabled, loading, error, selected, expanded, portal,
  and fullscreen states relevant to the migrated family;
- element geometry and computed styles without layout movement;
- lazy loading, route transitions, and CSS order;
- production and static-manifest builds.

`pnpm run audit:styles` checks the maintained source invariants. After a
production build, `pnpm run test:style-chunks` verifies that the initial page
loads one stylesheet and that the studio, publishing, and membership utility
chunks remain separate and lazy.

The standing screenshot prohibition means automated parity uses DOM,
accessibility, geometry, and computed-style assertions. Pixel-for-pixel visual
equivalence is not claimed without separately authorized visual baselines.

## Consequences

The final source tree has no application SCSS, Sass imports, or direct Sass
dependency. React-owned leaf styles use prefixed Tailwind utilities. Shared
application contracts live in `semantic-components.css`; browser
pseudo-elements, generated markup, and external-library DOM live in
`compatibility.css`. `tailwind-context.css` shares non-emitting theme and
variant definitions between the root and lazy utility entries. Vite excludes
only explicitly owned route sources from root discovery. Studio, publishing,
and memberships have separate lazy utility chunks contained by
zero-specificity route boundaries. The route scanner removes shared unvariant
base candidates already emitted by the root and retains route state and
responsive variants. This preserves canonical responsive behavior without
duplicating each route's transitive component graph or allowing a loaded chunk
to affect later routes.
