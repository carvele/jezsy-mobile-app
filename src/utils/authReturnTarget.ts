import AsyncStorage from '@react-native-async-storage/async-storage';

export const AUTH_RETURN_STORAGE_KEY = '@jezsy_auth_return_target';
export const PENDING_ENTRY_STORAGE_KEY = '@jezsy_pending_entry_target';

export const AUTH_RETURN_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const PENDING_ENTRY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type AuthAction = 'reserve' | 'wishlist' | 'message' | 'review' | 'generic';

/**
 * User-initiated intent gate (e.g. Reserve button tap, Wishlist heart tap).
 * Carries a 15-minute TTL and one-shot atomic consumption.
 */
export interface AuthReturnTarget {
  pathname: string;
  params: Record<string, string>;
  action: AuthAction;
  createdAt: number;
}

/**
 * External deep-link destination (e.g. shared catalog links).
 * Strictly allowlisted to public routes only, with 24-hour TTL and sanitized params.
 */
export interface PendingEntryTarget {
  pathname: string;
  params: Record<string, string>;
  createdAt: number;
}

const ALLOWED_AUTH_ROUTES: Record<string, string[]> = {
  '/product/[id]': ['id'],
  '/reserve/[id]': ['id', 'size', 'color', 'cart'],
  '/product/reviews': ['productId', 'id', 'name'],
  '/messages': ['ctxType', 'ctxRef', 'ctxLabel'],
};

const SAFE_PARAM_REGEX = /^[a-zA-Z0-9_\-\s]{1,64}$/;

/**
 * Validates and sanitizes an internal AuthReturnTarget against the internal route allowlist.
 */
export function sanitizeAuthReturnTarget(target: Partial<AuthReturnTarget>): AuthReturnTarget | null {
  if (!target || typeof target.pathname !== 'string') return null;

  const allowedParams = ALLOWED_AUTH_ROUTES[target.pathname];
  if (!allowedParams) return null;

  const validActions: AuthAction[] = ['reserve', 'wishlist', 'message', 'review', 'generic'];
  const action = validActions.includes(target.action as AuthAction)
    ? (target.action as AuthAction)
    : 'generic';

  const sanitizedParams: Record<string, string> = {};
  if (target.params && typeof target.params === 'object') {
    for (const key of allowedParams) {
      const val = target.params[key];
      if (typeof val === 'string' && SAFE_PARAM_REGEX.test(val.trim())) {
        sanitizedParams[key] = val.trim();
      }
    }
  }

  // Ensure mandatory path params are present if route requires them
  if (target.pathname.includes('[id]') && !sanitizedParams.id) {
    return null;
  }

  return {
    pathname: target.pathname,
    params: sanitizedParams,
    action,
    createdAt: typeof target.createdAt === 'number' ? target.createdAt : Date.now(),
  };
}

/**
 * Parses and validates an external deep link path and search params against the strict public allowlist.
 * Rejects private routes (/reserve, /payment, /messages, /admin, /profile) and malicious path traversal.
 */
export function sanitizePendingEntryTarget(
  rawPath: string,
  rawParams?: Record<string, string | string[] | undefined>,
): PendingEntryTarget | null {
  if (!rawPath || typeof rawPath !== 'string') return null;

  // Reject path traversal and protocol injections
  if (rawPath.includes('..') || rawPath.includes('//') || rawPath.includes(':')) {
    return null;
  }

  // Normalize path
  const normalized = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

  // Explicitly reject private/internal prefixes
  const privatePrefixes = ['/reserve', '/payment', '/messages', '/admin', '/profile', '/account', '/settings'];
  if (privatePrefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    return null;
  }

  // Public Route 1: Product reviews /product/reviews (checked before /product/:id)
  if (normalized === '/product/reviews') {
    const sanitizedParams: Record<string, string> = {};
    if (rawParams) {
      for (const key of ['productId', 'id', 'name']) {
        const val = rawParams[key];
        const strVal = Array.isArray(val) ? val[0] : val;
        if (typeof strVal === 'string' && SAFE_PARAM_REGEX.test(strVal.trim())) {
          sanitizedParams[key] = strVal.trim();
        }
      }
    }
    return {
      pathname: '/product/reviews',
      params: sanitizedParams,
      createdAt: Date.now(),
    };
  }

  // Public Route 2: Product detail /product/:id
  const productMatch = normalized.match(/^\/product\/([a-zA-Z0-9_-]{1,64})$/);
  if (productMatch && productMatch[1] !== 'reviews') {
    const productId = productMatch[1];
    return {
      pathname: '/product/[id]',
      params: { id: productId },
      createdAt: Date.now(),
    };
  }

  // Public Route 3: Explore /explore
  if (normalized === '/explore') {
    return {
      pathname: '/explore',
      params: {},
      createdAt: Date.now(),
    };
  }

  // Public Route 4: Home tabs / or /(tabs)
  if (normalized === '/' || normalized === '/(tabs)') {
    return {
      pathname: '/(tabs)',
      params: {},
      createdAt: Date.now(),
    };
  }

  return null;
}

/**
 * Saves a user-initiated auth return target (e.g. after tapping Reserve/Wishlist in SoftAuthModal).
 */
export async function saveAuthReturnTarget(target: Omit<AuthReturnTarget, 'createdAt'> & { createdAt?: number }): Promise<void> {
  const sanitized = sanitizeAuthReturnTarget(target);
  if (!sanitized) return;

  await AsyncStorage.setItem(AUTH_RETURN_STORAGE_KEY, JSON.stringify(sanitized));
}

/**
 * Retrieves the current AuthReturnTarget if within 15-minute TTL, otherwise clears and returns null.
 */
export async function getAuthReturnTarget(now = Date.now()): Promise<AuthReturnTarget | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_RETURN_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const sanitized = sanitizeAuthReturnTarget(parsed);
    if (!sanitized) {
      await AsyncStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
      return null;
    }

    if (now - sanitized.createdAt > AUTH_RETURN_TTL_MS) {
      await AsyncStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
      return null;
    }

    return sanitized;
  } catch {
    return null;
  }
}

/**
 * Atomically consumes and clears the AuthReturnTarget (one-shot).
 */
export async function consumeAuthReturnTarget(now = Date.now()): Promise<AuthReturnTarget | null> {
  const target = await getAuthReturnTarget(now);
  if (target) {
    await AsyncStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
  }
  return target;
}

/**
 * Clears any pending AuthReturnTarget.
 */
export async function clearAuthReturnTarget(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_RETURN_STORAGE_KEY);
}

/**
 * Saves an external deep-link target after validating against the public route allowlist.
 */
export async function savePendingEntryTarget(
  rawPath: string,
  rawParams?: Record<string, string | string[] | undefined>,
): Promise<boolean> {
  const sanitized = sanitizePendingEntryTarget(rawPath, rawParams);
  if (!sanitized) return false;

  await AsyncStorage.setItem(PENDING_ENTRY_STORAGE_KEY, JSON.stringify(sanitized));
  return true;
}

/**
 * Retrieves the current PendingEntryTarget if within 24-hour TTL, otherwise clears and returns null.
 */
export async function getPendingEntryTarget(now = Date.now()): Promise<PendingEntryTarget | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_ENTRY_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.pathname !== 'string') {
      await AsyncStorage.removeItem(PENDING_ENTRY_STORAGE_KEY);
      return null;
    }

    const createdAt = typeof parsed.createdAt === 'number' ? parsed.createdAt : 0;
    if (now - createdAt > PENDING_ENTRY_TTL_MS) {
      await AsyncStorage.removeItem(PENDING_ENTRY_STORAGE_KEY);
      return null;
    }

    return parsed as PendingEntryTarget;
  } catch {
    return null;
  }
}

/**
 * Atomically consumes and clears the PendingEntryTarget (one-shot).
 */
export async function consumePendingEntryTarget(now = Date.now()): Promise<PendingEntryTarget | null> {
  const target = await getPendingEntryTarget(now);
  if (target) {
    await AsyncStorage.removeItem(PENDING_ENTRY_STORAGE_KEY);
  }
  return target;
}

/**
 * Clears any pending PendingEntryTarget.
 */
export async function clearPendingEntryTarget(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_ENTRY_STORAGE_KEY);
}
