export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

const STRICT_SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

/**
 * Parses a strict SemVer string (MAJOR.MINOR.PATCH where all are integers).
 * Rejects leading/trailing garbage, pre-releases, and build metadata.
 */
export function parseStrictSemVer(version: string | undefined | null): SemVer | null {
  if (!version || typeof version !== 'string') return null;
  const trimmed = version.trim();
  if (!STRICT_SEMVER_REGEX.test(trimmed)) return null;

  const [majorStr, minorStr, patchStr] = trimmed.split('.');
  const major = parseInt(majorStr, 10);
  const minor = parseInt(minorStr, 10);
  const patch = parseInt(patchStr, 10);

  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) return null;
  return { major, minor, patch };
}

/**
 * Compares two strict SemVer strings.
 * Returns:
 *   1 if v1 > v2
 *  -1 if v1 < v2
 *   0 if v1 === v2
 *  null if either version string is invalid SemVer.
 */
export function compareSemVer(v1: string, v2: string): number | null {
  const p1 = parseStrictSemVer(v1);
  const p2 = parseStrictSemVer(v2);
  if (!p1 || !p2) return null;

  if (p1.major !== p2.major) return p1.major > p2.major ? 1 : -1;
  if (p1.minor !== p2.minor) return p1.minor > p2.minor ? 1 : -1;
  if (p1.patch !== p2.patch) return p1.patch > p2.patch ? 1 : -1;
  return 0;
}

export type VersionComplianceStatus =
  | 'UP_TO_DATE'
  | 'SOFT_UPDATE'
  | 'HARD_BLOCK'
  | 'FAIL_OPEN_SAFE';

export interface ClientVersionInfo {
  version: string;
  buildNumber: number;
}

export interface VersionPolicyInfo {
  min_version: string;
  min_build_number: number;
  latest_version: string;
  latest_build_number: number;
  emergency_bypass_enabled: boolean;
}

/**
 * Evaluates client compliance against server version policy.
 * - If emergency_bypass_enabled is true -> UP_TO_DATE.
 * - If either version string is malformed -> FAIL_OPEN_SAFE (never lock out on parser errors).
 * - If client < min_version OR (client == min_version AND clientBuild < min_build) -> HARD_BLOCK.
 * - If client < latest_version OR (client == latest_version AND clientBuild < latest_build) -> SOFT_UPDATE.
 * - Otherwise -> UP_TO_DATE.
 */
export function evaluateVersionCompliance(
  client: ClientVersionInfo,
  policy: VersionPolicyInfo
): VersionComplianceStatus {
  if (policy.emergency_bypass_enabled) {
    return 'UP_TO_DATE';
  }

  const minComp = compareSemVer(client.version, policy.min_version);
  const latestComp = compareSemVer(client.version, policy.latest_version);

  // If SemVer comparison failed due to malformed string, fail open safely
  if (minComp === null || latestComp === null) {
    return 'FAIL_OPEN_SAFE';
  }

  // 1. Check Hard Block boundary
  if (minComp < 0) {
    return 'HARD_BLOCK';
  }
  if (minComp === 0 && client.buildNumber < policy.min_build_number) {
    return 'HARD_BLOCK';
  }

  // 2. Check Soft Update advisory
  if (latestComp < 0) {
    return 'SOFT_UPDATE';
  }
  if (latestComp === 0 && client.buildNumber < policy.latest_build_number) {
    return 'SOFT_UPDATE';
  }

  return 'UP_TO_DATE';
}
