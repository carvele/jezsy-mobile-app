import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { sanitizeForStorage } from '@/src/utils/measurementPrivacy';

export default function MeasurementsScreen() {
  const theme = useColorScheme() ?? 'dark';
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

  const params = useLocalSearchParams();

  useEffect(() => {
    if (params.scanned === 'true' && params.scanData) {
      try {
        const scanData = JSON.parse(params.scanData as string);
        
        if (scanData.bust) setBust(scanData.bust.toString());
        if (scanData.waist) setWaist(scanData.waist.toString());
        if (scanData.hips) setHips(scanData.hips.toString());
        if (scanData.inseam) setInseam(scanData.inseam.toString());
        
        if (scanData.shoulderWidth) setShoulderWidth(scanData.shoulderWidth.toString());
        if (scanData.armLength) setArmLength(scanData.armLength.toString());
        if (scanData.torsoLength) setTorsoLength(scanData.torsoLength.toString());
        if (scanData.legLength) setLegLength(scanData.legLength.toString());
        
        if (scanData.overallConfidence) setScanConfidence(scanData.overallConfidence);
        if (scanData.confidence) setFieldConfidence(scanData.confidence);

        // Restore the height/weight entered before scanning (passed back as
        // params); the saved-measurements load is skipped on scan return, so
        // these fields would otherwise be blank on the remounted screen.
        if (params.height) setHeight(String(params.height));
        if (params.weight) setWeight(String(params.weight));

        setSource('camera_scan');
        setShowAdvanced(true);
      } catch(e) {
        console.error("Failed to parse scan data", e);
      }
    }
  }, [params]);

  useEffect(() => {
    const fromScan = params.scanned === 'true';
    const fetchMeasurements = async () => {
      if (!user) return;
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
          if (metrics.height) setHeight(metrics.height.toString());
          if (metrics.weight) setWeight(metrics.weight.toString());
          if (metrics.measurements) {
            const m = metrics.measurements as any;
            if (m.bust) setBust(m.bust.toString());
            if (m.waist) setWaist(m.waist.toString());
            if (m.hips) setHips(m.hips.toString());
            if (m.inseam) setInseam(m.inseam.toString());
            if (m.shoulderWidth) setShoulderWidth(m.shoulderWidth.toString());
            if (m.armLength) setArmLength(m.armLength.toString());
            if (m.torsoLength) setTorsoLength(m.torsoLength.toString());
            if (m.legLength) setLegLength(m.legLength.toString());
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
  }, [user]);

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
      const rawMeasurements = {
        bust: parseFloat(bust) || null,
        waist: parseFloat(waist) || null,
        hips: parseFloat(hips) || null,
        inseam: parseFloat(inseam) || null,
        shoulderWidth: parseFloat(shoulderWidth) || null,
        armLength: parseFloat(armLength) || null,
        torsoLength: parseFloat(torsoLength) || null,
        legLength: parseFloat(legLength) || null,
        confidence: fieldConfidence,
        overallConfidence: scanConfidence ?? 0
      };

      // Ensure data is sanitized before saving to DB
      const sanitized = sanitizeForStorage(rawMeasurements as any);

      const payload = {
        user_id: user.id,
        height: parseFloat(height) || null,
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
      Alert.alert('Error', err.message || 'Failed to save measurements.');
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

  const renderInput = (label: string, value: string, setValue: (val: string) => void, fieldKey: string, placeholder: string = "e.g. 85") => {
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
          accessibilityLabel={`${label} measurement in centimeters`}
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

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          
          {scanConfidence && (
            <View style={[styles.infoCard, { backgroundColor: 'rgba(0,255,0,0.1)', borderColor: '#00FF00', borderWidth: 1 }]}>
              <IconSymbol name="checkmark.circle.fill" size={20} color="#00FF00" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.infoText, { color: colors.text, fontWeight: 'bold' }]}>Scan Successful</Text>
                <Text style={[styles.infoText, { color: colors.secondaryText, marginTop: 4 }]}>
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
            <Text style={[styles.sectionTitle, { color: colors.text }]}>General Metrics</Text>
            <View style={styles.row}>
              <View style={styles.inputGroup}>
                <Text style={[styles.label, { color: colors.secondaryText }]}>Height (cm)</Text>
                <TextInput
                  style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="165"
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
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>Measurements (cm)</Text>
              
              <TouchableOpacity
                style={[styles.scanBtn, { backgroundColor: colors.tint }]}
                onPress={() => {
                  if (!height || !weight) {
                    Alert.alert('Missing Info', 'Please enter your height and weight above before scanning.');
                    return;
                  }
                  router.push({
                    pathname: '/profile/body-scan',
                    params: { height, weight, gender }
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel="Auto-scan measurements with camera"
                accessibilityHint="Opens the camera body scanner to estimate your measurements"
              >
                <IconSymbol name="camera.viewfinder" size={16} color="#0D0D0D" />
                <Text style={styles.scanBtnText}>Auto-Scan</Text>
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
              <View style={{ marginTop: 16 }}>
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
            <ActivityIndicator color="#0D0D0D" />
          ) : (
            <Text style={styles.saveBtnText}>Save Profile</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { padding: 20 },
  infoCard: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  infoText: { fontSize: 13, lineHeight: 18, flex: 1 },
  section: {
    paddingBottom: 24,
    marginBottom: 24,
    borderBottomWidth: 1,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 16 },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  scanBtnText: {
    color: '#0D0D0D',
    fontSize: 13,
    fontWeight: '700',
  },
  fitOptionsRow: {
    flexDirection: 'row',
    gap: 12,
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
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  row: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  inputGroup: {
    flex: 1,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
  confDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  advancedToggle: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
  },
  saveBtn: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '700',
  },
});
