import {
  compareSemver,
  compareVersions,
  isSupportedNextcloudVersion,
  MIN_NEXTCLOUD_VERSION,
} from '../../../src/util/version';

describe('compareVersions', () => {
  it.each([
    ['33', '33', 0],
    ['33.0.0', '33', 0],
    ['33.0.4', '33', 1],
    ['32.0.5', '33', -1],
    ['34', '33', 1],
  ])('compareVersions(%s, %s) sign = %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a as string, b as string))).toBe(sign);
  });
});

describe('isSupportedNextcloudVersion', () => {
  it('treats the whole 33.x line (and above) as supported', () => {
    expect(isSupportedNextcloudVersion('33')).toBe(true);
    expect(isSupportedNextcloudVersion('33.0.0')).toBe(true);
    expect(isSupportedNextcloudVersion('33.0.4')).toBe(true);
    expect(isSupportedNextcloudVersion('34.1.2')).toBe(true);
  });

  it('flags servers below the recommended minimum', () => {
    expect(isSupportedNextcloudVersion('32.0.5')).toBe(false);
    expect(isSupportedNextcloudVersion('25')).toBe(false);
  });

  it('does not warn when the version is unknown/empty', () => {
    expect(isSupportedNextcloudVersion('')).toBe(true);
  });

  it('keeps the recommended minimum at the 33 major (Hub 26), not a patch pin', () => {
    expect(MIN_NEXTCLOUD_VERSION).toBe('33');
  });
});

describe('[SPEC:CPS-4] compareSemver', () => {
  it.each([
    ['1.2.0-beta.3', '1.2.0', -1],
    ['1.2.0-beta.2', '1.2.0-beta.10', -1],
    ['1.0.0-alpha', '1.0.0-beta', -1],
    ['1.10.0', '1.9.0', 1],
    ['1.2.3', '1.2.3', 0],
    ['abc', '1.0.0', 0],
    ['1.0.0', '', 0],
    ['', '', 0],
  ])('compareSemver(%j, %j) = %s', (a, b, expected) => {
    expect(compareSemver(a as string, b as string)).toBe(expected);
  });
});
