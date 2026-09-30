import React from 'react';

const CONTENTS_STYLE = { display: 'contents' } as const;
const ROUTE_STYLE_SCOPE_CLASSES = {
  memberships: 'odysee-route-styles--memberships',
  publish: 'odysee-route-styles--publish',
  studio: 'odysee-route-styles--studio',
} as const;

export type RouteStyleScope = keyof typeof ROUTE_STYLE_SCOPE_CLASSES;

export default function withRouteStyleBoundary(Component: React.ComponentType<any>, scope: RouteStyleScope) {
  const scopeClass = ROUTE_STYLE_SCOPE_CLASSES[scope];
  const RouteStyleBoundary = (props: any) => (
    <div className={scopeClass} style={CONTENTS_STYLE}>
      <Component {...props} />
    </div>
  );

  RouteStyleBoundary.displayName = `withRouteStyleBoundary(${Component.displayName || Component.name || 'Component'})`;
  return RouteStyleBoundary;
}
