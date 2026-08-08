import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { sanitizeForStorage } from '@/src/utils/measurementPrivacy';
import { useToast } from '@/src/context/ToastContext';

type LengthUnit = 'cm' | 'in';
const UNIT_STORAGE_KEY = '@jezsy_length_unit';
const CM_PER_IN = 2.54;
const round1 = (n: number) => Math.round(n * 10) / 10;

// Every length field is stored and typed in whatever `unit` currently is --
// conversion only happens at explicit boundaries (toggle, load, save), never
// on keystroke. A value re-derived from itself on every keystroke would
// round mid-type and strip the decimal point the instant it's typed.
function cmToUnit(cmValue: string, unit: LengthUnit): string {
  if (!cmValue) return cmValue;
  const n = parseFloat(cmValue);
  if (isNaN(n)) return cmValue;
  return unit === 'in' ? round1(n / CM_PER_IN).toString() : round1(n).toString();
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
    if (params.scanned === 'true' && params.scanData) {
      try {
        const scanData = JSON.parse(params.scanData as string);

        if (scanData.bust) setBust(cmToUnit(scanData.bust.toString(), unit));
        if (scanData.waist) setWaist(cmToUnit(scanData.waist.toString(), unit));
        if (scanData.hips) setHips(cmToUnit(scanData.hips.toString(), unit));
        if (scanData.inseam) setInseam(cmToUnit(scanData.inseam.toString(), unit));

        if (scanData.shoulderWidth) setShoulderWidth(cmToUnit(scanData.shoulderWidth.toString(), unit));
        if (scanData.armLength) setArmLength(cmToUnit(scanData.armLength.toString(), unit));
        if (scanData.torsoLength) setTorsoLength(cmToUnit(scanData.torsoLength.toString(), unit));
        if (scanData.legLength) setLegLength(cmToUnit(scanData.legLength.toString(), unit));

        if (scanData.overallConfidence) setScanConfidence(scanData.overallConfidence);
        if (scanData.confidence) setFieldConfidence(scanData.confidence);

        // Restore the height/weight entered before scanning (passed back as
        // params); the saved-measurements load is skipped on scan return, so
        // these fields would otherwise be blank on the remounted screen.
        // Both travel as cm/kg regardless of display unit -- the Auto-Scan
        // handoff below converts height to cm before navigating, since
        // body-scan's measurement math assumes cm.
        if (params.height) setHeight(cmToUnit(String(params.height), unit));
        if (params.weight) setWeight(String(params.weight));

        setSource('camera_scan');
        setShowAdvanced(true);
      } catch(e) {
        console.error("Failed to parse scan data", e);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, unitReady]);

  // Same reasoning as the scan-results effect above: `unit` must be read once
  // at load, not re-applied every time the user toggles it afterward.
  useEffect(() => {
    if (!unitReady) return;
    const fromScan = params.scanned === 'true';
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

        // On return from a body scan, the scan results (applied by the other
        // effect) must win. This fetch resolves after that synchronous effect,
        // so applying the saved row here would clobber the fresh scan.
        if (fromScan) return;

        // Fetch measurements
        const { data: metrics } = await supabase
          .from('user_measurements')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (metrics) {
          // DB values are always cm/kg; convert for display against whatever
          // unit the persisted preference resolved to.
          if (metrics.height) setHeight(cmToUnit(metrics.height.toString(), unit));
          if (metrics.weight) setWeight(metrics.weight.toString());
          if (metrics.measurements) {
            const m = metrics.measurements as any;
            if (m.bust) setBust(cmToUnit(m.bust.toString(), unit));
            if (m.waist) setWaist(cmToUnit(m.waist.toString(), unit));
            if (m.hips) setHips(cmToUnit(m.hips.toString(), unit));
            if (m.inseam) setInseam(cmToUnit(m.inseam.toString(), unit));
            if (m.shoulderWidth) setShoulderWidth(cmToUnit(m.shoulderWidth.toString(), unit));
            if (m.armLength) setArmLength(cmToUnit(m.armLength.toString(), unit));
            if (m.torsoLength) setTorsoLength(cmToUnit(m.torsoLength.toString(), unit));
            if (m.legLength) setLegLength(cmToUnit(m.legLength.toString(), unit));
          }
          if (metrics.scan_confidence) setScanConfidence(metrics.scan_confidence);
          if (metrics.per_field_confidence) setFieldConfidence(metrics.per_field_confidence);
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

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // 1. Update Profile Fit Preference
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ fit_preference: fitPreference })
        .eq('id', user.id);
      if (profileError) throw profileError;

      // 2. Upsert Measurements
      // Everything on screen is in `unit`; the DB (and body-scan's math) is
      // cm-only, so this is the one place a display value is converted back.
      const rawMeasurements = {
        bust: unitToCm(bust, unit),
        waist: unitToCm(waist, unit),
        hips: unitToCm(hips, unit),
        inseam: unitToCm(inseam, unit),
        shoulderWidth: unitToCm(shoulderWidth, unit),
        armLength: unitToCm(armLength, unit),
        torsoLength: unitToCm(torsoLength, unit),
        legLength: unitToCm(legLength, unit),
        confidence: fieldConfidence,
        overallConfidence: scanConfidence ?? 0
      };

      // Ensure data is sanitized before saving to DB
      const sanitized = sanitizeForStorage(rawMeasurements as any);

      const payload = {
        user_id: user.id,
        height: unitToCm(height, unit),
        weight: parseFloat(weight) || null,
        measurements: {
          bust: sanitized.bust,
          waist: sanitized.waist,
          hips: sanitized.hips,
          inseam: sanitized.inseam,
          shoulderWidth: sanitized.shoulderWidth,
          armLength: sanitized.armLength,
          torsoLength: sanitized.torsoLength,
          legLength: sanitized.legLength,
        },
        scan_confidence: sanitized.scan_confidence,
        per_field_confidence: sanitized.per_field_confidence,
        measurement_source: source
      };

      const { error: measurementsError } = await supabase
        .from('user_measurements')
        .upsert(payload, { onConflict: 'user_id' });
      if (measurementsError) throw measurementsError;

      Alert.alert('Success', 'Your measurements have been updated. Size recommendations will now be tailored to you.', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to save measurements.', 'error');
    } finally {
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
      if (conf > 0.85) confColor = '#00FF00';
      else if (conf > 0.6) confColor = '#FFCC00';
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
        <TextInput
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
          placeholder={placeholder}
          placeholderTextColor={colors.secondaryText}
          keyboardType="numeric"
          value={value}
          accessibilityLabel={`${label} measurement in ${unit === 'in' ? 'inches' : 'centimeters'}`}
          onChangeText={(v) => {
            setValue(v);
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
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          
          {scanConfidence && (
            <View style={[styles.infoCard, { backgroundColor: 'rgba(0,255,0,0.1)', borderColor: '#00FF00', borderWidth: 1 }]}>
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
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder={cmToUnit('165', unit)}
                  placeholderTextColor={colors.secondaryText}
                  keyboardType="numeric"
                  value={height}
                  onChangeText={setHeight}
                />
              </View>
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.secondaryText }]}>Weight (kg)</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="55"
                  placeholderTextColor={colors.secondaryText}
                  keyboardType="numeric"
                  value={weight}
                  onChangeText={setWeight}
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
    paddingHorizontal: 14,
    paddingVertical: 6,
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
