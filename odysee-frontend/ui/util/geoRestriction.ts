export function getGeoRestrictionForClaim(claim: StreamClaim | null | undefined) {
  const nodeRestriction = (claim as any)?.hyperbeam?.content_restriction;
  return nodeRestriction ? (nodeRestriction as GeoConfig) : null;
}
