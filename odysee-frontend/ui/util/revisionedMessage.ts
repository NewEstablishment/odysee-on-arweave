// The revisioned-message kernel: one implementation of the append-only
// revision-chain model every native feature shares. A feature supplies a
// small spec (identity, refs, next-revision predicate, equivocation policy)
// and gets chain walking, semantic dedup, and collapse. The envelope
// contract lives in docs/native-messages.md.
export type RevisionedItem = Record<string, any>;

export type EquivocationPolicy = 'drop-version' | 'poison-ref' | 'none';

export type CollapseSpec<T extends RevisionedItem> = {
  // The reference a chain hangs off (root's own ref; revisions point at it).
  rootRef: (item: T) => string;
  // The revision pointer on a non-root item, undefined on roots.
  revisionOf: (item: T) => string | undefined;
  // True when `candidate` is the unique legal successor of `current`.
  isNext: (root: T, current: T, candidate: T) => boolean;
  // Version identity and semantics for equivocation detection. An owner
  // signing two different semantics under one version identity is an
  // equivocation; the policy decides the blast radius (that version, the
  // whole ref, or ignored). Policies differ per feature today; unifying
  // them is a deliberate, separate decision.
  versionIdentity?: (item: T) => string;
  versionSemantics?: (item: T) => string;
  equivocation: EquivocationPolicy;
  // Tie-break/order among equal versions (first after sort is kept).
  compare?: (left: T, right: T) => number;
};

// Walk a chain from its root: at each step exactly one legal successor may
// exist. Zero successors ends the chain; more than one is a fork (an owner
// equivocation) and the chain stops at the last unforked item, so a forged
// branch can never take over a chain.
export function walkChain<T extends RevisionedItem>(
  root: T,
  revisions: Array<T>,
  isNext: (root: T, current: T, candidate: T) => boolean
): T {
  let current = root;
  while (true) {
    const candidates = revisions.filter((candidate) => isNext(root, current, candidate));
    if (candidates.length !== 1) return current;
    current = candidates[0];
  }
}

// Collapse a mixed bag of roots and revisions into chain tips.
export function collapseChains<T extends RevisionedItem>(items: Array<T>, spec: CollapseSpec<T>): Array<T> {
  const unique = dedupeVersions(items, spec);
  const poisoned = spec.equivocation === 'poison-ref' ? equivocatedRefs(items, spec) : new Set<string>();
  const revisionsByRoot = new Map<string, Array<T>>();
  unique.forEach((item) => {
    const ref = spec.revisionOf(item);
    if (!ref) return;
    const revisions = revisionsByRoot.get(ref) || [];
    revisions.push(item);
    revisionsByRoot.set(ref, revisions);
  });

  const tips: Array<T> = [];
  unique.forEach((item) => {
    if (spec.revisionOf(item)) return;
    const ref = spec.rootRef(item);
    if (poisoned.has(ref)) return;
    if (spec.equivocation === 'poison-ref' && countRoots(unique, spec, ref) !== 1) return;
    tips.push(walkChain(item, revisionsByRoot.get(ref) || [], spec.isNext));
  });
  return tips;
}

// Keep one item per version identity. Under 'drop-version', a version whose
// copies disagree semantically is dropped entirely; otherwise the first item
// under `compare` (or arrival order) represents the version.
export function dedupeVersions<T extends RevisionedItem>(items: Array<T>, spec: CollapseSpec<T>): Array<T> {
  if (!spec.versionIdentity) return items;
  const byVersion = new Map<string, Array<T>>();
  items.forEach((item) => {
    const identity = spec.versionIdentity!(item);
    const versions = byVersion.get(identity) || [];
    versions.push(item);
    byVersion.set(identity, versions);
  });

  const unique: Array<T> = [];
  byVersion.forEach((versions) => {
    if (spec.versionSemantics && spec.equivocation === 'drop-version') {
      const semantics = new Set(versions.map(spec.versionSemantics));
      if (semantics.size !== 1) return;
    }
    unique.push(spec.compare ? versions.sort(spec.compare)[0] : versions[0]);
  });
  return unique;
}

// Refs whose version identities carry conflicting semantics ('poison-ref').
function equivocatedRefs<T extends RevisionedItem>(items: Array<T>, spec: CollapseSpec<T>): Set<string> {
  const conflicts = new Set<string>();
  if (!spec.versionIdentity || !spec.versionSemantics) return conflicts;
  const semanticsByVersion = new Map<string, string>();
  items.forEach((item) => {
    const identity = spec.versionIdentity!(item);
    const semantics = spec.versionSemantics!(item);
    const existing = semanticsByVersion.get(identity);
    if (existing !== undefined && existing !== semantics) {
      conflicts.add(spec.revisionOf(item) || spec.rootRef(item));
    }
    semanticsByVersion.set(identity, semantics);
  });
  return conflicts;
}

function countRoots<T extends RevisionedItem>(items: Array<T>, spec: CollapseSpec<T>, ref: string): number {
  return items.filter((item) => !spec.revisionOf(item) && spec.rootRef(item) === ref).length;
}

// Keep the winning tip per logical identity (e.g. one active reaction per
// owner and target), where the winner is the greatest under `compare`.
export function latestByKey<T extends RevisionedItem>(
  items: Array<T>,
  keyOf: (item: T) => string,
  compare: (left: T, right: T) => number
): Array<T> {
  const byKey = new Map<string, T>();
  items.forEach((item) => {
    const key = keyOf(item);
    const existing = byKey.get(key);
    if (!existing || compare(existing, item) < 0) byKey.set(key, item);
  });
  return Array.from(byKey.values());
}

// The shared event ordering: event time, then revision, then message id.
export function compareByEvent<T extends RevisionedItem>(
  timestampOf: (item: T) => number,
  revisionOf: (item: T) => number,
  messageIdOf: (item: T) => string
): (left: T, right: T) => number {
  return (left, right) => {
    const timestampDifference = timestampOf(left) - timestampOf(right);
    if (timestampDifference) return timestampDifference;
    const revisionDifference = revisionOf(left) - revisionOf(right);
    if (revisionDifference) return revisionDifference;
    return messageIdOf(left).localeCompare(messageIdOf(right));
  };
}
