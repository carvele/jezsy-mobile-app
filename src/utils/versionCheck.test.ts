import { parseStrictSemVer, compareSemVer, evaluateVersionCompliance } from './versionCheck';

describe('versionCheck', () => {
  describe('parseStrictSemVer', () => {
    it('parses valid strict semver', () => {
      expect(parseStrictSemVer('1.0.0')).toEqual({ major: 1, minor: 0, patch: 0 });
      expect(parseStrictSemVer('2.14.9')).toEqual({ major: 2, minor: 14, patch: 9 });
      expect(parseStrictSemVer('  1.2.3  ')).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it('rejects invalid or loose semver', () => {
      expect(parseStrictSemVer('1.0')).toBeNull();
      expect(parseStrictSemVer('1.0.0-beta')).toBeNull();
      expect(parseStrictSemVer('1.0.0+build1')).toBeNull();
      expect(parseStrictSemVer('v1.0.0')).toBeNull();
      expect(parseStrictSemVer('1.0.0.4')).toBeNull();
      expect(parseStrictSemVer('abc')).toBeNull();
      expect(parseStrictSemVer('')).toBeNull();
      expect(parseStrictSemVer(null)).toBeNull();
      expect(parseStrictSemVer(undefined)).toBeNull();
    });
  });

  describe('compareSemVer', () => {
    it('correctly compares major versions', () => {
      expect(compareSemVer('2.0.0', '1.9.9')).toBe(1);
      expect(compareSemVer('1.0.0', '2.0.0')).toBe(-1);
      expect(compareSemVer('1.0.0', '1.0.0')).toBe(0);
    });

    it('correctly compares minor versions numerically', () => {
      // Numerical vs lexicographical: 1.10.0 > 1.2.0
      expect(compareSemVer('1.10.0', '1.2.0')).toBe(1);
      expect(compareSemVer('1.2.0', '1.10.0')).toBe(-1);
    });

    it('correctly compares patch versions numerically', () => {
      expect(compareSemVer('1.0.12', '1.0.3')).toBe(1);
      expect(compareSemVer('1.0.3', '1.0.12')).toBe(-1);
    });

    it('returns null on invalid versions', () => {
      expect(compareSemVer('invalid', '1.0.0')).toBeNull();
      expect(compareSemVer('1.0.0', '1.0.0-beta')).toBeNull();
    });
  });

  describe('evaluateVersionCompliance', () => {
    const basePolicy = {
      min_version: '1.1.0',
      min_build_number: 2,
      latest_version: '1.2.0',
      latest_build_number: 5,
      emergency_bypass_enabled: false,
    };

    it('returns HARD_BLOCK when client SemVer is below min_version', () => {
      const res = evaluateVersionCompliance(
        { version: '1.0.0', buildNumber: 1 },
        basePolicy
      );
      expect(res).toBe('HARD_BLOCK');
    });

    it('returns HARD_BLOCK when client SemVer equals min_version but buildNumber is below min_build_number', () => {
      const res = evaluateVersionCompliance(
        { version: '1.1.0', buildNumber: 1 },
        basePolicy
      );
      expect(res).toBe('HARD_BLOCK');
    });

    it('returns SOFT_UPDATE when client satisfies min but is below latest_version', () => {
      const res = evaluateVersionCompliance(
        { version: '1.1.0', buildNumber: 2 },
        basePolicy
      );
      expect(res).toBe('SOFT_UPDATE');
    });

    it('returns SOFT_UPDATE when client matches latest_version but buildNumber is below latest_build_number', () => {
      const res = evaluateVersionCompliance(
        { version: '1.2.0', buildNumber: 4 },
        basePolicy
      );
      expect(res).toBe('SOFT_UPDATE');
    });

    it('returns UP_TO_DATE when client matches or exceeds latest_version and latest_build_number', () => {
      const res1 = evaluateVersionCompliance(
        { version: '1.2.0', buildNumber: 5 },
        basePolicy
      );
      expect(res1).toBe('UP_TO_DATE');

      const res2 = evaluateVersionCompliance(
        { version: '1.3.0', buildNumber: 1 },
        basePolicy
      );
      expect(res2).toBe('UP_TO_DATE');
    });

    it('returns UP_TO_DATE immediately when emergency_bypass_enabled is true', () => {
      const bypassPolicy = { ...basePolicy, emergency_bypass_enabled: true };
      const res = evaluateVersionCompliance(
        { version: '0.0.1', buildNumber: 0 },
        bypassPolicy
      );
      expect(res).toBe('UP_TO_DATE');
    });

    it('returns FAIL_OPEN_SAFE if remote or local version is malformed', () => {
      const malformedRemote = { ...basePolicy, min_version: 'corrupted' };
      const res1 = evaluateVersionCompliance(
        { version: '1.0.0', buildNumber: 1 },
        malformedRemote
      );
      expect(res1).toBe('FAIL_OPEN_SAFE');

      const res2 = evaluateVersionCompliance(
        { version: 'corrupted-local', buildNumber: 1 },
        basePolicy
      );
      expect(res2).toBe('FAIL_OPEN_SAFE');
    });
  });
});
