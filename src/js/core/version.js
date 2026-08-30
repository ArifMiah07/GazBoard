// Version comparison for the update check.
//
// Deliberately small and deliberately strict: it understands the shape this
// project actually publishes - MAJOR.MINOR.PATCH with an optional -prerelease
// suffix - and refuses anything it does not recognise rather than guessing.
// An updater that mistakenly thinks a new version is available is a nuisance;
// one that mistakenly thinks 2.10.0 is older than 2.9.0 is worse, because it
// leaves people stranded on a broken build believing they are current.

/** Split "v2.10.1-beta.2" into { nums:[2,10,1], pre:'beta.2' }, or null. */
export function parseVersion(v) {
  if (typeof v !== 'string') return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) return null;
  return { nums: [+m[1], +m[2], +m[3]], pre: m[4] || null };
}

/**
 * Is `candidate` a later version than `current`?
 *
 * Numeric parts compare as numbers, so 2.10.0 beats 2.9.0. A release beats a
 * prerelease of the same numbers (2.1.0 is newer than 2.1.0-beta.1), and a
 * prerelease never counts as an update over a release - nobody on a stable
 * build should be nudged onto a beta. Anything unparseable answers false.
 */
export function isNewer(candidate, current) {
  const a = parseVersion(candidate), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a.nums[i] > b.nums[i]) return true;
    if (a.nums[i] < b.nums[i]) return false;
  }
  // same numbers: only a release over a prerelease counts
  if (!a.pre && b.pre) return true;
  return false;
}
