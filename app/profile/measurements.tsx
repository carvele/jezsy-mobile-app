import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { profileService } from '@/src/services';
import { sanitizeForStorage, validateMeasurementRanges } from '@/src/utils/measurementPrivacy';
import { useToast } from '@/src/context/ToastContext';
import { consumeScanSession } from '@/src/utils/scanSession';
import { MeasurementGuideModal } from '@/src/components/MeasurementGuideModal';
import { ConfirmModal } from '@/src/components/ConfirmModal';
import { isOnline } from '@/src/services/offlineSync';

type LengthUnit = 'cm' | 'in';
const UNIT_STORAGE_KEY = '@jezsy_length_unit';
const CM_PER_IN = 2.54;
const round1 = (n: number) => Math.round(n * 10) / 10;
// keyboardType="numeric" only hints at a numeric keyboard on native; on web
// (React Native Web) it does not restrict what a physical keyboard can type,
// so "-160" was going straight into state unfiltered. Strip to digits and a
// single decimal point -- there's no valid negative body measurement.
const sanitizeNumericInput = (v: string) => {
  const cleaned = v.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
};

// Every length field is stored and typed in whatever `unit` currently is --
// conversion only happens at explicit boundaries (toggle, load, save), never
// on keystroke. A value re-derived from itself on every keystroke would
// round mid-type and strip the decimal point the instant it's typed.
function cmToUnit(cmValue: string, unit: LengthUnit): string {
  if (!cmValue) return cmValue;
  const n = parseFloat(cmValue);
  if (isNaN(n)) return '';
  return unit === 'in' ? round1(n / CM_PER_IN).toString() : round1(n).toString();
}

function toCmString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object' && val !== null && 'valueCm' in val) {
    const v = (val as any).valueCm;
    return v !== null && v !== undefined ? String(v) : '';
  }
  return String(val);
}

function unitToCm(value: string, unit: LengthUnit): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  if (isNaN(n)) return null;
  return unit === 'in' ? n * CM_PER_IN : n;
}

export default function MeasurementsScreen() {
  const { showToast } = useToast();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Form State
  const [fitPreference, setFitPreference] = useState<string>('regular');
  const [height, setHeight] = useState<string>('');
  const [weight, setWeight] = useState<string>('');
  const [gender, setGender] = useState<string>('non-binary');
  
  // Basic Measurements
  const [bust, setBust] = useState<string>('');
  const [waist, setWaist] = useState<string>('');
  const [hips, setHips] = useState<string>('');
  const [inseam, setInseam] = useState<string>('');
  
  // Advanced Measurements
  const [shoulderWidth, setShoulderWidth] = useState<string>('');
  const [armLength, setArmLength] = useState<string>('');
  const [torsoLength, setTorsoLength] = useState<string>('');
  const [legLength, setLegLength] = useState<string>('');

  const [source, setSource] = useState<string>('manual');
  const [guideVisible, setGuideVisible] = useState(false);

  // ML Confidence Tracking
  const [scanConfidence, setScanConfidence] = useState<number | null>(null);
  const [fieldConfidence, setFieldConfidence] = useState<any>({});

  // Fields are stored and typed in whatever `unit` currently is; only cm ever
  // reaches the DB or body-scan's math. Gated on unitReady so the persisted
  // preference (loaded from AsyncStorage, necessarily async) is known before
  // any cm value from a scan or from the DB gets converted for display --
  // converting against the wrong starting unit would silently corrupt it.
  const [unit, setUnit] = useState<LengthUnit>('cm');
  const [unitReady, setUnitReady] = useState(false);

  const params = useLocalSearchParams();

  useEffect(() => {
    AsyncStorage.getItem(UNIT_STORAGE_KEY).then((stored) => {
      setUnit(stored === 'in' ? 'in' : 'cm');
      setUnitReady(true);
    });
  }, []);

  const toggleUnit = () => {
    const nextUnit: LengthUnit = unit === 'cm' ? 'in' : 'cm';
    const convert = (v: string) => cmToUnit(String(unitToCm(v, unit) ?? ''), nextUnit);
    setHeight(convert);
    setBust(convert);
    setWaist(convert);
    setHips(convert);
    setInseam(convert);
    setShoulderWidth(convert);
    setArmLength(convert);
    setTorsoLength(convert);
    setLegLength(convert);
    setUnit(nextUnit);
    AsyncStorage.setItem(UNIT_STORAGE_KEY, nextUnit).catch(() => {});
  };

  // `unit` is read once this fires (gated by unitReady); it must NOT re-run
  // when the user later toggles units, or it would re-derive from the
  // original scan data and fight the plain field-by-field conversion
  // toggleUnit already does.
  useEffect(() => {
    if (!unitReady) return;
    const scanId = params.scanId as string | undefined;
    if (scanId) {
      try {
        const session = consumeScanSession(scanId);
        if (!session) return;
        const scanData = session.measurements as any;

        if (scanData.bust) setBust(cmToUnit(toCmString(scanData.bust), unit));
        if (scanData.waist) setWaist(cmToUnit(toCmString(scanData.waist), unit));
        if (scanData.hips) setHips(cmToUnit(toCmString(scanData.hips), unit));
        if (scanData.inseam) setInseam(cmToUnit(toCmString(scanData.inseam), unit));

        if (scanData.shoulderWidth) setShoulderWidth(cmToUnit(toCmString(scanData.shoulderWidth), unit));
        if (scanData.armLength) setArmLength(cmToUnit(toCmString(scanData.armLength), unit));
        if (scanData.torsoLength) setTorsoLength(cmToUnit(toCmString(scanData.torsoLength), unit));
        if (scanData.legLength) setLegLength(cmToUnit(toCmString(scanData.legLength), unit));

        if (scanData.overallConfidence) setScanConfidence(scanData.overallConfidence);
        if (scanData.confidence) setFieldConfidence(scanData.confidence);

        if (session.height !== null) setHeight(cmToUnit(String(session.height), unit));
        if (session.weight !== null) setWeight(String(session.weight));

        setSource('camera_scan');
        setShowAdvanced(true);
      } catch(e) {
        console.error("Failed to parse scan data", e);
      }
    }
  }, [params.scanId, unitReady, unit]);

  // Same reasoning as the scan-results effect above: `unit` must be read once
  // at load, not re-applied every time the user toggles it afterward.
  useEffect(() => {
    if (!unitReady) return;
    const fromScan = Boolean(params.scanId);
    const fetchMeasurements = async () => {
      if (!user) { setLoading(false); return; }
      try {
        // Fetch fit_preference and gender from profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('fit_preference, gender')
          .eq('id', user.id)
          .single();

        if (profile?.fit_preference) setFitPreference(profile.fit_preference);
        if (profile?.gender) setGender(profile.gender);

        // Fetch measurements
        const { data: metrics } = await supabase
          .from('user_measurements')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (metrics) {
          // On return from a body scan, the scan results (applied by the other,
          // earlier-running effect) must win for whatever fields the scan actually
          // provided -- but a scan can supply a strict subset (e.g. shoulderWidth
          // only, if bust/waist/hips weren't confidently readable from that angle).
          // Skipping this DB read entirely whenever fromScan was true used to mean
          // any field the scan didn't touch stayed at its blank initial state, and
          // handleSave's unconditional 8-field upsert then wrote null over that
          // field's real, previously-saved DB value -- confirmed live, reproducibly,
          // this session. The functional-update form below only fills a field when
          // it is still unset, so a value the scan effect already applied is never
          // overwritten, while every field the scan omitted still falls back to
          // whatever was already saved instead of being wiped.
          const fillFromDb = (setter: React.Dispatch<React.SetStateAction<string>>, cmValue: unknown) => {
            if (cmValue === null || cmValue === undefined) return;
            const s = toCmString(cmValue);
            if (!s) return;
            setter((prev) => (prev ? prev : cmToUnit(s, unit)));
          };

          // DB values are always cm/kg; convert for display against whatever
          // unit the persisted preference resolved to.
          fillFromDb(setHeight, metrics.height);
          if (metrics.weight !== null && metrics.weight !== undefined) {
            const weightStr = metrics.weight.toString();
            setWeight((prev) => (prev ? prev : weightStr));
          }
          if (metrics.measurements) {
            const m = metrics.measurements as any;
            fillFromDb(setBust, m.bust);
            fillFromDb(setWaist, m.waist);
            fillFromDb(setHips, m.hips);
            fillFromDb(setInseam, m.inseam);
            fillFromDb(setShoulderWidth, m.shoulderWidth);
            fillFromDb(setArmLength, m.armLength);
            fillFromDb(setTorsoLength, m.torsoLength);
            fillFromDb(setLegLength, m.legLength);
          }
          if (!fromScan) {
            if (metrics.scan_confidence) setScanConfidence(metrics.scan_confidence);
            if (metrics.per_field_confidence) setFieldConfidence(metrics.per_field_confidence);
          }
        }
      } catch (err) {
        console.error('Error fetching measurements', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMeasurements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, unitReady]);

  const savingRef = React.useRef(false);
  const [warningModal, setWarningModal] = useState<{ visible: boolean; items: string[]; resolve?: (v: boolean) => void }>({
    visible: false,
    items: [],
  });

  // Wall-clock recovery for a save that started while the tab was
  // foregrounded and then got backgrounded mid-request. Mobile Chrome
  // throttles or fully freezes a hidden tab's JS timers, so the setTimeout
  // inside attemptWrite below can simply never fire -- confirmed live on the
  // wardrobe upload flow (same withTimeout pattern) as "waited a few minutes
  // [away from the tab], came back, still stuck". document.visibilitychange
  // reliably fires when a frozen tab wakes back up even though its own
  // timers didn't, so that's used here to check real elapsed time and force
  // the UI out of a stuck state the setTimeout guard missed.
  const saveStartedAtRef = React.useRef<number | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (saveStartedAtRef.current === null) return;
      // Past the longest legitimate completion window (15s x up to 3
      // attempts), so this only fires once genuinely stuck.
      if (Date.now() - saveStartedAtRef.current > 60000) {
        saveStartedAtRef.current = null;
        savingRef.current = false;
        setSaving(false);
        const message = 'Saving was interrupted while the app was in the background. Your inputs have been kept -- please tap Save again.';
        setSaveError(message);
        showToast(message, 'error');
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!user) {
      setSaveError('Not signed in -- please log in to save measurements.');
      showToast('Please sign in to save your measurements.', 'error');
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    saveStartedAtRef.current = Date.now();
    setSaving(true);
    setSaveError(null);

    // Fail fast and clearly when there's genuinely no connection, rather than
    // burning the full timeout+retry cycle first -- confirmed live on mobile
    // data with a weak signal, waiting it out only to land on the same
    // generic timeout message wasted the user's time for no new information.
    if (!(await isOnline())) {
      const message = 'No internet connection. Your inputs have been kept -- reconnect and tap Save again.';
      setSaveError(message);
      showToast(message, 'error');
      savingRef.current = false;
      saveStartedAtRef.current = null;
      setSaving(false);
      return;
    }

    // Reverted the fresh supabase.auth.getSession() call that was here: it
    // was chasing a misdiagnosed cause. The wardrobe-upload RLS failure it
    // was modeled on turned out to be upsert:true on the storage bucket,
    // unrelated to session freshness, fixed separately at its true root
    // cause. Every getSession() call contends for supabase-js's cross-tab
    // Web Locks auth lock -- confirmed live via a genuine "Lock ... was not
    // released within 5000ms" warning on a freshly loaded tab, a real
    // contributor to "randomly stuck loading" reports. user.id from
    // AuthContext (already populated via its own onAuthStateChange
    // listener, guarded at the top of this function) is sufficient and
    // adds no extra lock contention.
    const userId = user.id;

    // Everything on screen is in `unit`; the DB (and body-scan's math) is
    // cm-only, so this is the one place a display value is converted back.
    const rawMeasurements = {
      height: unitToCm(height, unit),
      weight: parseFloat(weight) || null,
      bust: unitToCm(bust, unit),
      waist: unitToCm(waist, unit),
      hips: unitToCm(hips, unit),
      inseam: unitToCm(inseam, unit),
      shoulderWidth: unitToCm(shoulderWidth, unit),
      armLength: unitToCm(armLength, unit),
      torsoLength: unitToCm(torsoLength, unit),
      legLength: unitToCm(legLength, unit),
      confidence: fieldConfidence,
      overallConfidence: scanConfidence ?? 0.95,
    };

    // Zero/negative is not "unusual", it's not a body measurement at all --
    // reject outright rather than routing it through the dismissible range
    // warning below, which is meant for real-but-atypical values.
    const nonPositiveField = Object.entries(rawMeasurements).find(
      ([key, value]) => typeof value === 'number' && value <= 0 && key !== 'overallConfidence'
    );
    if (nonPositiveField) {
      const message = 'Measurements must be greater than 0. Please check your entries.';
      setSaveError(message);
      showToast(message, 'error');
      savingRef.current = false;
      saveStartedAtRef.current = null;
      setSaving(false);
      return;
    }

    // Range check sanity warning
    const warnings = validateMeasurementRanges({
      height: rawMeasurements.height,
      weight: rawMeasurements.weight,
      bust: rawMeasurements.bust,
      waist: rawMeasurements.waist,
      hips: rawMeasurements.hips,
      inseam: rawMeasurements.inseam,
      shoulderWidth: rawMeasurements.shoulderWidth,
      armLength: rawMeasurements.armLength,
      torsoLength: rawMeasurements.torsoLength,
      legLength: rawMeasurements.legLength,
    });

    if (warnings.length > 0) {
      const proceed = await new Promise<boolean>((resolve) => {
        setWarningModal({ visible: true, items: warnings, resolve });
      });
      if (!proceed) {
        savingRef.current = false;
        saveStartedAtRef.current = null;
        setSaving(false);
        return;
      }
    }

    // Ensure data is sanitized before saving to DB
    const sanitized = sanitizeForStorage(rawMeasurements as any);

    const payload = {
      user_id: userId,
      height: rawMeasurements.height,
      weight: rawMeasurements.weight,
      measurements: {
        bust: sanitized.bust || null,
        waist: sanitized.waist || null,
        hips: sanitized.hips || null,
        inseam: sanitized.inseam || null,
        shoulderWidth: sanitized.shoulderWidth || null,
        armLength: sanitized.armLength || null,
        torsoLength: sanitized.torsoLength || null,
        legLength: sanitized.legLength || null,
      },
      scan_confidence: sanitized.scan_confidence,
      per_field_confidence: sanitized.per_field_confidence,
      measurement_source: source,
    };

    try {
      const result = await profileService.updateProfileAndMeasurements({
        fitPreference,
        height: rawMeasurements.height,
        weight: rawMeasurements.weight,
        measurements: payload.measurements,
        scanConfidence: payload.scan_confidence,
        perFieldConfidence: payload.per_field_confidence,
        measurementSource: payload.measurement_source,
      });

      if (!result.ok) throw result.error;

      showToast('Measurements saved successfully ✨', 'success');
      // canGoBack()/back() is unreliable here: after a page reload, Expo
      // Router's web linking reconstructs a synthetic history stack from
      // the URL alone, so canGoBack() can report true with no real "came
      // from" entry, and back() falls through to the tab navigator's
      // default tab (Home) instead of where the user actually came from
      // (confirmed live on the identical add-item.tsx flow). This screen
      // is reachable from several places, so instead of guessing from
      // history, entry points pass an explicit `from` param and we
      // navigate there directly; Profile is the default when absent.
      router.replace(params.from === 'mannequin' ? '/wardrobe?tab=mannequin' : '/profile');
    } catch (err: any) {
      console.error('Error saving sizing measurements:', err);
      let userMessage = 'Unable to save measurements right now. Please try again.';
      if (err?.isTimeout) {
        userMessage = 'The request took too long. Your inputs have been kept, please tap Save again.';
      } else if (err?.message?.includes('JWT') || err?.message?.includes('auth') || err?.code === '401'
        || err?.code === '42501' || err?.message?.includes('row-level security')) {
        userMessage = 'Your session expired. Please log in again to save.';
      } else if (err?.message?.includes('network') || err?.message?.includes('fetch')) {
        userMessage = 'Network connection interrupted. Your inputs are saved, please try again.';
      } else if (err?.message) {
        userMessage = err.message;
      }
      setSaveError(userMessage);
      showToast(userMessage, 'error');
    } finally {
      savingRef.current = false;
      saveStartedAtRef.current = null;
      setSaving(false);
    }
  };

  const renderFitOption = (val: string, label: string) => {
    const isSelected = fitPreference === val;
    return (
      <TouchableOpacity
        style={[
          styles.fitOption,
          { borderColor: isSelected ? colors.tint : colors.border },
          isSelected && { backgroundColor: colors.card }
        ]}
        onPress={() => setFitPreference(val)}
        accessibilityRole="button"
        accessibilityLabel={`${label} fit`}
        accessibilityHint={`Sets your fit preference to ${label.toLowerCase()}`}
        accessibilityState={{ selected: isSelected }}
      >
        <Text style={[styles.fitOptionText, { color: isSelected ? colors.tint : colors.text }]}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderInput = (label: string, value: string, setValue: (val: string) => void, fieldKey: string, placeholderCm: number = 85) => {
    const placeholder = `e.g. ${cmToUnit(String(placeholderCm), unit)}`;
    const conf = fieldConfidence[fieldKey];
    let confColor = 'transparent';
    if (conf) {
      if (conf > 0.85) confColor = colors.success;
      else if (conf > 0.6) confColor = colors.warning;
      else confColor = '#FF3B30';
    }

    return (
      <View style={styles.inputGroup}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: colors.secondaryText }]}>{label}</Text>
          {conf !== undefined && (
            <View style={[styles.confDot, { backgroundColor: confColor }]} />
          )}
        </View>
        <TextInput keyboardAppearance={theme}
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          placeholder={placeholder}
          placeholderTextColor={colors.secondaryText}
          keyboardType="numeric"
          value={value}
          accessibilityLabel={`${label} measurement in ${unit === 'in' ? 'inches' : 'centimeters'}`}
          onChangeText={(v) => {
            setValue(sanitizeNumericInput(v));
            // Once manually edited, it is no longer AI derived purely
            if (conf !== undefined) {
              setFieldConfidence((prev: any) => ({ ...prev, [fieldKey]: 0 }));
              setSource('manual');
            }
          }}
        />
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
          accessibilityState={{ disabled: saving }}
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>My Sizing Profile</Text>
        <TouchableOpacity
          onPress={() => setGuideVisible(true)}
          style={[styles.guideBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Open measurement guide"
        >
          <IconSymbol name="ruler.fill" size={13} color={colors.tint} />
          <Text style={[styles.guideBtnText, { color: colors.text }]}>Guide</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          
          {scanConfidence && (
            <View style={[styles.infoCard, { backgroundColor: 'rgba(0,255,0,0.1)', borderColor: colors.success, borderWidth: 1 }]}>
              <IconSymbol name="checkmark.circle.fill" size={20} color="#00FF00" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoText, { color: colors.text, fontWeight: 'bold' }]}>Scan Successful</Text>
                <Text style={[styles.infoText, { color: colors.secondaryText, marginTop: Spacing.xs }]}>
                  Quality: {Math.round(scanConfidence * 100)}%. AI derived measurements are indicated with a colored dot. You can adjust them manually.
                </Text>
              </View>
            </View>
          )}

          <View style={[styles.section, { borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Fit Preference</Text>
            <View style={styles.fitOptionsRow}>
              {renderFitOption('tight', 'Tight')}
              {renderFitOption('regular', 'Regular')}
              {renderFitOption('loose', 'Loose')}
            </View>
          </View>

          <View style={[styles.section, { borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg }}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>General Metrics</Text>
              <View style={[styles.unitToggle, { borderColor: colors.border }]}>
                <TouchableOpacity
                  style={[styles.unitToggleOption, unit === 'cm' && { backgroundColor: colors.tint }]}
                  onPress={() => unit !== 'cm' && toggleUnit()}
                  accessibilityRole="button"
                  accessibilityLabel="Use centimeters"
                  accessibilityState={{ selected: unit === 'cm' }}
                >
                  <Text style={[styles.unitToggleText, { color: unit === 'cm' ? colors.onTint : colors.secondaryText }]}>cm</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unitToggleOption, unit === 'in' && { backgroundColor: colors.tint }]}
                  onPress={() => unit !== 'in' && toggleUnit()}
                  accessibilityRole="button"
                  accessibilityLabel="Use inches"
                  accessibilityState={{ selected: unit === 'in' }}
                >
                  <Text style={[styles.unitToggleText, { color: unit === 'in' ? colors.onTint : colors.secondaryText }]}>in</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.secondaryText }]}>Height ({unit})</Text>
                <TextInput keyboardAppearance={theme}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder={cmToUnit('165', unit)}
                  placeholderTextColor={colors.secondaryText}
                  keyboardType="numeric"
                  value={height}
                  onChangeText={(v) => setHeight(sanitizeNumericInput(v))}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.secondaryText }]}>Weight (kg)</Text>
                <TextInput keyboardAppearance={theme}
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="55"
                  placeholderTextColor={colors.secondaryText}
                  keyboardType="numeric"
                  value={weight}
                  onChangeText={(v) => setWeight(sanitizeNumericInput(v))}
                />
              </View>
            </View>
          </View>

          <View style={[styles.section, { borderColor: colors.border, borderBottomWidth: 0 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg }}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Measurements ({unit})</Text>
              
              <TouchableOpacity
                style={[styles.scanBtn, { backgroundColor: colors.tint }]}
                onPress={() => {
                  if (!height || !weight) {
                    showToast('Please enter your height and weight before scanning.', 'info');
                    return;
                  }
                  // body-scan's measurement math assumes cm regardless of
                  // what's currently displayed here.
                  router.push({
                    pathname: '/profile/body-scan',
                    params: { height: String(unitToCm(height, unit) ?? ''), weight, gender }
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel="Auto-scan measurements with camera"
                accessibilityHint="Opens the camera body scanner to estimate your measurements"
              >
                <IconSymbol name="camera.viewfinder" size={16} color={colors.onTint} />
                <Text style={[styles.scanBtnText, { color: colors.onTint }]}>Auto-Scan</Text>
              </TouchableOpacity>
            </View>
            
            <View style={styles.row}>
              {renderInput("Bust", bust, setBust, 'bust')}
              {renderInput("Waist", waist, setWaist, 'waist')}
            </View>

            <View style={styles.row}>
              {renderInput("Hips", hips, setHips, 'hips')}
              {renderInput("Inseam", inseam, setInseam, 'inseam')}
            </View>

            <TouchableOpacity
              style={styles.advancedToggle}
              onPress={() => setShowAdvanced(!showAdvanced)}
              accessibilityRole="button"
              accessibilityLabel={showAdvanced ? 'Hide advanced measurements' : 'Show advanced measurements'}
              accessibilityState={{ expanded: showAdvanced }}
            >
              <Text style={{ color: colors.tint, fontWeight: '600' }}>
                {showAdvanced ? 'Hide Advanced Measurements' : 'Show Advanced Measurements'}
              </Text>
            </TouchableOpacity>

            {showAdvanced && (
              <View style={{ marginTop: Spacing.lg }}>
                <View style={styles.row}>
                  {renderInput("Shoulder", shoulderWidth, setShoulderWidth, 'shoulderWidth')}
                  {renderInput("Arm", armLength, setArmLength, 'armLength')}
                </View>
                <View style={styles.row}>
                  {renderInput("Torso", torsoLength, setTorsoLength, 'torsoLength')}
                  {renderInput("Leg", legLength, setLegLength, 'legLength')}
                </View>
              </View>
            )}

          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={[styles.footer, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        {saveError && (
          <Text style={{ color: colors.error, fontSize: 12, marginBottom: Spacing.sm, textAlign: 'center' }}>
            {saveError}
          </Text>
        )}
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: colors.tint, opacity: saving ? 0.7 : 1 }]}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel="Save sizing profile"
          accessibilityHint="Saves your fit preference and measurements"
          accessibilityState={{ disabled: saving }}
        >
          {saving ? (
            <ActivityIndicator color={colors.onTint} />
          ) : (
            <Text style={[styles.saveBtnText, { color: colors.onTint }]}>Save Profile</Text>
          )}
        </TouchableOpacity>
      </View>

      <MeasurementGuideModal
        visible={guideVisible}
        onClose={() => setGuideVisible(false)}
        unit={unit}
      />

      <ConfirmModal
        visible={warningModal.visible}
        title="Unusual measurements"
        message="Some of the values you entered look outside the typical range. You can go back and adjust them, or save as-is."
        items={warningModal.items}
        confirmLabel="Save anyway"
        cancelLabel="Go back and fix"
        onConfirm={() => {
          warningModal.resolve?.(true);
          setWarningModal({ visible: false, items: [] });
        }}
        onCancel={() => {
          warningModal.resolve?.(false);
          setWarningModal({ visible: false, items: [] });
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: { padding: Spacing.sm },
  headerTitle: { ...Type.subtitle },
  guideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  guideBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  content: { padding: Spacing.xl },
  infoCard: {
    flexDirection: 'row',
    padding: Spacing.lg,
    borderRadius: Radius.md,
    gap: Spacing.md,
    alignItems: 'flex-start',
    marginBottom: Spacing.xl,
  },
  infoText: { fontSize: 13, lineHeight: 18, flex: 1 },
  section: {
    paddingBottom: Spacing.xxl,
    marginBottom: Spacing.xxl,
    borderBottomWidth: 1,
  },
  sectionTitle: { ...Type.bodyLargeStrong, marginBottom: Spacing.lg },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.lg,
  },
  scanBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  unitToggle: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  unitToggleOption: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  unitToggleText: {
    fontSize: 13,
    fontWeight: '700',
  },
  fitOptionsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  fitOption: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fitOptionText: {
    ...Type.bodyStrong,
    textTransform: 'capitalize',
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  inputGroup: {
    flex: 1,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  label: {
    ...Type.caption,
  },
  confDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  input: {
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    // Size only, not Type.bodyLarge: a lineHeight on a fixed-height Android
    // TextInput shifts the baseline off centre.
    fontSize: 16,
  },
  advancedToggle: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  footer: {
    padding: Spacing.xl,
    borderTopWidth: 1,
  },
  saveBtn: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: {
    ...Type.bodyLargeStrong,
  },
});

