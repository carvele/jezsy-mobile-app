import { Platform, AppState, AppStateStatus } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { supabase } from '@/src/lib/supabase';
import {
  ClientVersionInfo,
  VersionPolicyInfo,
  VersionComplianceStatus,
  evaluateVersionCompliance,
} from '@/src/utils/versionCheck';

const STORAGE_KEYS = {
  POLICY_CACHE: '@jezsy:version_policy_cache',
  COMPLIANCE_STATUS: '@jezsy:version_compliance_status',
  LAST_CHECK_TIMESTAMP: '@jezsy:version_last_check_ts',
};

const SUPPORTED_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour for supported status
const BACKGROUND_CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes foreground re-check

export interface RemoteVersionPolicy extends VersionPolicyInfo {
  platform: string;
  title: string;
  message: string;
  store_url: string;
  store_fallback_url: string;
}

export interface VersionCheckResult {
  status: VersionComplianceStatus;
  policy: RemoteVersionPolicy | null;
  client: ClientVersionInfo;
}

type Listener = (result: VersionCheckResult) => void;

class AppVersionService {
  private currentResult: VersionCheckResult | null = null;
  private listeners: Set<Listener> = new Set();
  private isInitialized = false;
  private appStateSubscription: any = null;
  private netInfoSubscription: any = null;
  private hasPendingReconnectRecheck = false;

  /**
   * Resolves the current client platform identifier.
   */
  getPlatform(): 'ios' | 'android' | 'web' {
    if (Platform.OS === 'ios') return 'ios';
    if (Platform.OS === 'android') return 'android';
    return 'web';
  }

  /**
   * Extracts client version and build number from expo-constants.
   */
  getClientVersionInfo(): ClientVersionInfo {
    const version = Constants.expoConfig?.version || '1.0.0';
    let buildNumber = 0;

    if (Platform.OS === 'android') {
      buildNumber = Constants.expoConfig?.android?.versionCode ?? 1;
    } else if (Platform.OS === 'ios') {
      const iosBuild = Constants.expoConfig?.ios?.buildNumber ?? '1';
      const parsed = parseInt(String(iosBuild), 10);
      buildNumber = Number.isNaN(parsed) ? 1 : parsed;
    } else {
      buildNumber = 1;
    }

    return { version, buildNumber };
  }

  /**
   * Initializes the service, hooks AppState foreground transitions and NetInfo reconnects.
   */
  init() {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 1. AppState listener: re-check version when app comes back to foreground
    this.appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        this.handleForegroundResume();
      }
    });

    // 2. NetInfo listener: if boot was fail-open due to offline, re-check immediately on reconnect
    this.netInfoSubscription = NetInfo.addEventListener((state: NetInfoState) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        if (this.hasPendingReconnectRecheck) {
          this.hasPendingReconnectRecheck = false;
          this.checkVersionCompliance();
        }
      }
    });
  }

  /**
   * Main evaluation entry point.
   * Enforces sticky HARD_BLOCK and refined fail-open logic.
   */
  async checkVersionCompliance(): Promise<VersionCheckResult> {
    const client = this.getClientVersionInfo();
    const platform = this.getPlatform();

    // 1. Inspect persistent cache first
    const cachedState = await this.readCachedState();

    // 2. Attempt remote policy fetch
    try {
      const { data, error } = await supabase.rpc('get_app_version_policy', {
        p_platform: platform,
      });

      const payload = data as any;
      if (error || !payload || payload.success === false) {
        throw error || new Error('Failed to retrieve version policy');
      }

      const policy: RemoteVersionPolicy = {
        platform: payload.platform || platform,
        min_version: payload.min_version || '1.0.0',
        min_build_number: Number(payload.min_build_number) || 0,
        latest_version: payload.latest_version || '1.0.0',
        latest_build_number: Number(payload.latest_build_number) || 0,
        emergency_bypass_enabled: Boolean(payload.emergency_bypass_enabled),
        title: payload.title || 'Update Required',
        message: payload.message || 'A new version of JezSy is required to continue.',
        store_url: payload.store_url || '',
        store_fallback_url: payload.store_fallback_url || 'https://jezsy.com',
      };

      // 3. Evaluate compliance
      const status = evaluateVersionCompliance(client, policy);

      // 4. Update persistent storage
      await this.savePolicyCache(policy, status);

      this.hasPendingReconnectRecheck = false;
      const result: VersionCheckResult = { status, policy, client };
      this.notify(result);
      return result;
    } catch (networkErr) {
      console.warn('[AppVersionService] Remote policy fetch failed:', networkErr);

      // STICKY HARD BLOCK RULE:
      // If client was previously verified as HARD_BLOCK, it remains HARD_BLOCK.
      // Airplane mode or offline disconnect CANNOT clear a verified hard block.
      if (cachedState?.status === 'HARD_BLOCK') {
        const result: VersionCheckResult = {
          status: 'HARD_BLOCK',
          policy: cachedState.policy,
          client,
        };
        this.notify(result);
        return result;
      }

      // If cached state was SUPPORTED and within TTL, allow cached operation
      if (cachedState?.status === 'UP_TO_DATE' || cachedState?.status === 'SOFT_UPDATE') {
        const now = Date.now();
        if (now - cachedState.timestamp < SUPPORTED_CACHE_TTL_MS) {
          const result: VersionCheckResult = {
            status: cachedState.status,
            policy: cachedState.policy,
            client,
          };
          this.notify(result);
          return result;
        }
      }

      // PERMISSIVE FAIL-OPEN (Fresh boot or expired supported cache with no network):
      // Allow app entry temporarily, but schedule immediate re-check upon reconnect.
      this.hasPendingReconnectRecheck = true;
      const result: VersionCheckResult = {
        status: 'FAIL_OPEN_SAFE',
        policy: cachedState?.policy ?? null,
        client,
      };
      this.notify(result);
      return result;
    }
  }

  /**
   * Re-evaluates compliance on foreground resume if interval elapsed.
   */
  private async handleForegroundResume() {
    try {
      const lastCheckStr = await AsyncStorage.getItem(STORAGE_KEYS.LAST_CHECK_TIMESTAMP);
      const lastCheck = lastCheckStr ? parseInt(lastCheckStr, 10) : 0;
      const now = Date.now();

      if (now - lastCheck > BACKGROUND_CHECK_INTERVAL_MS) {
        await this.checkVersionCompliance();
      }
    } catch (err) {
      console.warn('[AppVersionService] Foreground resume check error:', err);
    }
  }

  private async readCachedState(): Promise<{
    status: VersionComplianceStatus;
    policy: RemoteVersionPolicy | null;
    timestamp: number;
  } | null> {
    try {
      const [statusStr, policyStr, tsStr] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.COMPLIANCE_STATUS),
        AsyncStorage.getItem(STORAGE_KEYS.POLICY_CACHE),
        AsyncStorage.getItem(STORAGE_KEYS.LAST_CHECK_TIMESTAMP),
      ]);

      if (!statusStr) return null;

      return {
        status: statusStr as VersionComplianceStatus,
        policy: policyStr ? JSON.parse(policyStr) : null,
        timestamp: tsStr ? parseInt(tsStr, 10) : 0,
      };
    } catch {
      return null;
    }
  }

  private async savePolicyCache(policy: RemoteVersionPolicy, status: VersionComplianceStatus) {
    try {
      const now = Date.now().toString();
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.POLICY_CACHE, JSON.stringify(policy)),
        AsyncStorage.setItem(STORAGE_KEYS.COMPLIANCE_STATUS, status),
        AsyncStorage.setItem(STORAGE_KEYS.LAST_CHECK_TIMESTAMP, now),
      ]);
    } catch (err) {
      console.warn('[AppVersionService] Failed to cache policy:', err);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.currentResult) listener(this.currentResult);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(result: VersionCheckResult) {
    this.currentResult = result;
    this.listeners.forEach((listener) => {
      try {
        listener(result);
      } catch (e) {
        console.error('[AppVersionService] Listener error:', e);
      }
    });
  }

  getCurrentResult(): VersionCheckResult | null {
    return this.currentResult;
  }
}

export const appVersionService = new AppVersionService();
