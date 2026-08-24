export type GraphqlEnvelopePath = readonly string[];

function pathsEqual(left: GraphqlEnvelopePath, right: GraphqlEnvelopePath): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function isPathPrefix(prefix: GraphqlEnvelopePath, path: GraphqlEnvelopePath): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => segment === path[index]);
}

function stripKnownEnvelopeNodes(
  value: unknown,
  currentPath: GraphqlEnvelopePath,
  envelopePaths: readonly GraphqlEnvelopePath[],
): unknown {
  const stripHere = envelopePaths.some((path) => pathsEqual(path, currentPath));
  const hasKnownDescendant = envelopePaths.some((path) => isPathPrefix(currentPath, path));

  if (!stripHere && !hasKnownDescendant) return value;
  if (Array.isArray(value)) {
    return value.map((entry) =>
      stripKnownEnvelopeNodes(entry, [...currentPath, '*'], envelopePaths),
    );
  }
  if (value === null || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !stripHere || key !== '__typename')
      .map(([key, entry]) => [
        key,
        stripKnownEnvelopeNodes(entry, [...currentPath, key], envelopePaths),
      ]),
  );
}

/**
 * Removes Apollo's `__typename` only at explicitly declared GraphQL envelope nodes.
 * Opaque JSON scalar values are deliberately left byte-for-byte equivalent.
 */
export function stripGraphqlTypenames(
  value: unknown,
  envelopePaths: readonly GraphqlEnvelopePath[],
): unknown {
  return stripKnownEnvelopeNodes(value, [], [[], ...envelopePaths]);
}
