import valid from 'semver/functions/valid';
import compare from 'semver/functions/compare';

// A recommended minimum, not a hard gate: older servers still connect and sync (features degrade via
// capability detection) and the settings screen shows a recommendation banner.
export const MIN_NEXTCLOUD_VERSION = '33';

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// An empty/unknown version counts as supported: no warning on missing data.
export function isSupportedNextcloudVersion(version: string): boolean {
  if (!version) return true;
  return compareVersions(version, MIN_NEXTCLOUD_VERSION) >= 0;
}

// Semver comparison for plugin versions. Returns 0 when either side is not valid semver (no ordering).
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  if (valid(a) === null || valid(b) === null) return 0;
  return compare(a, b);
}
