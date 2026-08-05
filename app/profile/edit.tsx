import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, Calendar } from 'lucide-react-native';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useToast } from '@/src/context/ToastContext';
import { CountryPickerModal } from '@/src/components/CountryPickerModal';
import { DobPickerModal } from '@/src/components/DobPickerModal';
import {
  type ProfileData,
  type Country,
  GENDER_OPTIONS,
  COUNTRIES,
  formatPhoneForCountry,
  parseDateOfBirth,
  DOB_PATTERN,
  matchCountryFromStoredPhone,
  dbDateToFormDate,
} from '@/src/utils/profileFields';

// Flat single-page editor, separate from the (auth) setup wizard: editing an
// existing profile doesn't need step-by-step onboarding pacing, just a form
// with everything visible and a Save button.
export default function EditProfileScreen() {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { user, profile, refreshProfile } = useAuth();
  const [saving, setSaving] = useState(false);

  const [data, setData] = useState<ProfileData>({
    firstName: '',
    lastName: '',
    phone: '',
    gender: '',
    dateOfBirth: '',
    addressLine: '',
    barangay: '',
    city: '',
    province: '',
    zipCode: '',
  });
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]);
  const [showCountryModal, setShowCountryModal] = useState(false);
  const [showDatePickerModal, setShowDatePickerModal] = useState(false);

  useEffect(() => {
    if (!profile) return;
    const { country: matchedCountry, localPhone } = matchCountryFromStoredPhone(profile.phone);
    const fmtCountry = matchedCountry ?? COUNTRIES[0];
    if (matchedCountry) setSelectedCountry(matchedCountry);

    setData({
      firstName: profile.first_name || '',
      lastName: profile.last_name || '',
      phone: localPhone ? formatPhoneForCountry(localPhone, fmtCountry) : '',
      gender: profile.gender || '',
      dateOfBirth: dbDateToFormDate(profile.date_of_birth),
      addressLine: profile.address_line || '',
      barangay: profile.barangay || '',
      city: profile.city || '',
      province: profile.province || '',
      zipCode: profile.zip_code || '',
    });
  }, [profile]);

  const set = (key: keyof ProfileData, value: string) =>
    setData((prev) => ({ ...prev, [key]: value }));

  const handlePhoneChange = (text: string) => set('phone', formatPhoneForCountry(text, selectedCountry));

  const handleDOBChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '').substring(0, 8);
    let formatted = '';
    for (let i = 0; i < cleaned.length; i++) {
      if (i === 2 || i === 4) formatted += '/';
      formatted += cleaned[i];
    }
    set('dateOfBirth', formatted);
  };

  const validate = (): boolean => {
    if (!data.firstName.trim() || !data.lastName.trim()) {
      showToast('Please enter your first and last name.', 'info');
      return false;
    }
    const cleanedPhone = data.phone.replace(/\D/g, '');
    if (cleanedPhone && !selectedCountry.regex.test(cleanedPhone)) {
      showToast(`Please enter a valid ${selectedCountry.name} phone number (${selectedCountry.format}).`, 'error');
      return false;
    }
    if (data.dateOfBirth.trim()) {
      if (!DOB_PATTERN.test(data.dateOfBirth.trim())) {
        showToast('Please enter a valid date in MM/DD/YYYY format.', 'error');
        return false;
      }
      if (!parseDateOfBirth(data.dateOfBirth)) {
        showToast('Please enter a real calendar date.', 'error');
        return false;
      }
    }
    return true;
  };

  const handleSave = async () => {
    if (!user || !validate()) return;
    setSaving(true);
    try {
      const cleanedPhone = data.phone.replace(/\D/g, '');
      const fullPhone = cleanedPhone ? `${selectedCountry.dialCode}${cleanedPhone}` : null;

      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email ?? null,
          first_name: data.firstName.trim(),
          last_name: data.lastName.trim(),
          phone: fullPhone,
          gender: data.gender || null,
          date_of_birth: parseDateOfBirth(data.dateOfBirth),
          address_line: data.addressLine.trim() || null,
          barangay: data.barangay.trim() || null,
          city: data.city.trim() || null,
          province: data.province.trim() || null,
          zip_code: data.zipCode.trim() || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (error) throw error;

      await refreshProfile();
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/profile');
    } catch (err: any) {
      showToast(err.message ?? 'Could not save profile. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel editing">
          <Text style={[styles.headerAction, { color: colors.secondaryText }]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={saving} hitSlop={8} accessibilityRole="button" accessibilityLabel="Save profile">
          {saving ? (
            <ActivityIndicator size="small" color={colors.tint} />
          ) : (
            <Text style={[styles.headerAction, { color: colors.tint, fontWeight: '700' }]}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={[styles.sectionLabel, { color: colors.secondaryText }]}>NAME</Text>
          <View style={styles.row}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.secondaryText }]}>First name</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
                value={data.firstName}
                onChangeText={(v) => set('firstName', v)}
                placeholder="e.g. Maria"
                placeholderTextColor={colors.secondaryText}
              />
            </View>
            <View style={{ width: 16 }} />
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.secondaryText }]}>Last name</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
                value={data.lastName}
                onChangeText={(v) => set('lastName', v)}
                placeholder="e.g. Santos"
                placeholderTextColor={colors.secondaryText}
              />
            </View>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.secondaryText, marginTop: 24 }]}>PERSONAL INFO</Text>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.secondaryText }]}>Mobile number</Text>
            <View style={styles.phoneRow}>
              <TouchableOpacity
                style={[styles.countryBtn, { borderColor: colors.border }]}
                onPress={() => setShowCountryModal(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.countryFlag}>{selectedCountry.flag}</Text>
                <Text style={[styles.countryDialCode, { color: colors.text }]}>{selectedCountry.dialCode}</Text>
                <ChevronDown size={14} color={colors.secondaryText} />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.phoneInput, { color: colors.text, borderBottomColor: colors.border }]}
                value={data.phone}
                onChangeText={handlePhoneChange}
                placeholder={selectedCountry.placeholder}
                placeholderTextColor={colors.secondaryText}
                keyboardType="phone-pad"
              />
            </View>
          </View>

          <View style={[styles.fieldGroup, { marginTop: 16 }]}>
            <Text style={[styles.label, { color: colors.secondaryText }]}>Date of birth</Text>
            <View style={styles.dobRow}>
              <TextInput
                style={[styles.input, styles.dobInput, { color: colors.text, borderBottomColor: colors.border }]}
                value={data.dateOfBirth}
                onChangeText={handleDOBChange}
                placeholder="MM/DD/YYYY"
                placeholderTextColor={colors.secondaryText}
                keyboardType="numbers-and-punctuation"
              />
              <TouchableOpacity style={styles.calendarBtn} onPress={() => setShowDatePickerModal(true)} activeOpacity={0.7}>
                <Calendar size={20} color={colors.tint} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ marginTop: 16 }}>
            <Text style={[styles.label, { color: colors.secondaryText }]}>Gender</Text>
            <View style={styles.chipGrid}>
              {GENDER_OPTIONS.map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[
                    styles.chip,
                    { borderColor: colors.border, backgroundColor: colors.card },
                    data.gender === g && { backgroundColor: colors.tint, borderColor: colors.tint },
                  ]}
                  onPress={() => set('gender', g)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, { color: colors.secondaryText }, data.gender === g && styles.chipTextActive]}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.secondaryText, marginTop: 24 }]}>ADDRESS</Text>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.secondaryText }]}>Street address</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
              value={data.addressLine}
              onChangeText={(v) => set('addressLine', v)}
              placeholder="House/unit no., building, street name"
              placeholderTextColor={colors.secondaryText}
            />
          </View>
          <View style={[styles.fieldGroup, { marginTop: 16 }]}>
            <Text style={[styles.label, { color: colors.secondaryText }]}>Barangay</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
              value={data.barangay}
              onChangeText={(v) => set('barangay', v)}
              placeholder="e.g. Brgy. San Jose"
              placeholderTextColor={colors.secondaryText}
            />
          </View>
          <View style={[styles.row, { marginTop: 16 }]}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.secondaryText }]}>City / Municipality</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
                value={data.city}
                onChangeText={(v) => set('city', v)}
                placeholder="e.g. Cebu City"
                placeholderTextColor={colors.secondaryText}
              />
            </View>
          </View>
          <View style={[styles.row, { marginTop: 16 }]}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.secondaryText }]}>Province</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
                value={data.province}
                onChangeText={(v) => set('province', v)}
                placeholder="e.g. Cebu"
                placeholderTextColor={colors.secondaryText}
              />
            </View>
            <View style={{ width: 16 }} />
            <View style={[styles.fieldGroup, { width: 110 }]}>
              <Text style={[styles.label, { color: colors.secondaryText }]}>Zip code</Text>
              <TextInput
                style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
                value={data.zipCode}
                onChangeText={(v) => set('zipCode', v)}
                placeholder="0000"
                placeholderTextColor={colors.secondaryText}
                keyboardType="numeric"
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <CountryPickerModal
        visible={showCountryModal}
        selectedCountry={selectedCountry}
        onSelect={(c) => {
          setSelectedCountry(c);
          set('phone', '');
          setShowCountryModal(false);
        }}
        onClose={() => setShowCountryModal(false)}
      />

      <DobPickerModal
        visible={showDatePickerModal}
        value={data.dateOfBirth}
        onConfirm={(dob) => {
          set('dateOfBirth', dob);
          setShowDatePickerModal(false);
        }}
        onClose={() => setShowDatePickerModal(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerAction: { fontSize: 16 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  body: { padding: 20, paddingBottom: 48 },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, marginBottom: 12 },
  row: { flexDirection: 'row' },
  fieldGroup: { gap: 6 },
  label: { fontSize: 12, fontWeight: '600' },
  input: {
    fontSize: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  phoneRow: { flexDirection: 'row', alignItems: 'center' },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginRight: 12,
    gap: 6,
  },
  countryFlag: { fontSize: 16 },
  countryDialCode: { fontSize: 14, fontWeight: '600' },
  phoneInput: { flex: 1 },
  dobRow: { flexDirection: 'row', alignItems: 'center' },
  dobInput: { flex: 1 },
  calendarBtn: { position: 'absolute', right: 0, padding: 10 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 100, borderWidth: 1 },
  chipText: { fontSize: 14, fontWeight: '500' },
  chipTextActive: { color: '#0D0D0D', fontWeight: '700' },
});
