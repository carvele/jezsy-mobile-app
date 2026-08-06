import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  StatusBar,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, ArrowRight, Check, User, Phone, MapPin, Calendar, ChevronDown } from 'lucide-react-native';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { Colors } from '@/constants/theme';
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

const TOTAL_STEPS = 3;

const STEP_META = [
  { icon: User,    label: 'Name',    title: "What's your\nname?",    subtitle: 'Help us personalize your experience.' },
  { icon: Phone,   label: 'Info',    title: 'Personal\ninformation.', subtitle: 'For order updates and account security.' },
  { icon: MapPin,  label: 'Address', title: 'Your delivery\naddress.',  subtitle: 'Where should we send your orders?' },
];

export default function ProfileSetupScreen() {
  const { showToast } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, profile, refreshProfile } = useAuth();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

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

  // Country Selector state
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]);
  const [showCountryModal, setShowCountryModal] = useState(false);

  // Custom DOB Selector state
  const [showDatePickerModal, setShowDatePickerModal] = useState(false);

  // Prefill from the existing profile, falling back to OAuth metadata for
  // names on first-time setup. Without this, a returning user hitting this
  // screen mid-setup would start blank and the skip-address path would
  // upsert null over a previously saved address. The `prev.x ||` guards
  // keep anything the user has already typed from being overwritten.
  useEffect(() => {
    if (!user) return;

    const meta = user.user_metadata ?? {};
    const fullName: string = meta.full_name ?? meta.name ?? '';
    const nameParts = fullName.trim().split(/\s+/).filter(Boolean);

    const { country: matchedCountry, localPhone } = matchCountryFromStoredPhone(profile?.phone);
    if (matchedCountry) setSelectedCountry(matchedCountry);
    const fmtCountry = matchedCountry ?? COUNTRIES[0];

    const dob = dbDateToFormDate(profile?.date_of_birth);

    setData(prev => ({
      firstName:   prev.firstName   || profile?.first_name || nameParts[0] || '',
      lastName:    prev.lastName    || profile?.last_name  || nameParts.slice(1).join(' ') || '',
      phone:       prev.phone       || (localPhone ? formatPhoneForCountry(localPhone, fmtCountry) : ''),
      gender:      prev.gender      || profile?.gender || '',
      dateOfBirth: prev.dateOfBirth || dob,
      addressLine: prev.addressLine || profile?.address_line || '',
      barangay:    prev.barangay    || profile?.barangay || '',
      city:        prev.city        || profile?.city || '',
      province:    prev.province    || profile?.province || '',
      zipCode:     prev.zipCode     || profile?.zip_code || '',
    }));
  }, [user, profile]);

  const set = (key: keyof ProfileData, value: string) =>
    setData(prev => ({ ...prev, [key]: value }));

  const transitionTo = (next: number) => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setStep(next), 140);
  };

  const handlePhoneChange = (text: string) => {
    set('phone', formatPhoneForCountry(text, selectedCountry));
  };

  const handleDOBChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '').substring(0, 8);
    let formatted = '';
    for (let i = 0; i < cleaned.length; i++) {
      if (i === 2 || i === 4) {
        formatted += '/';
      }
      formatted += cleaned[i];
    }
    set('dateOfBirth', formatted);
  };

  const validate = (): boolean => {
    if (step === 0) {
      if (!data.firstName.trim() || !data.lastName.trim()) {
        showToast('Please enter your first and last name.', 'info');
        return false;
      }
    }
    if (step === 1) {
      const cleanedPhone = data.phone.replace(/\D/g, '');
      if (!cleanedPhone) {
        showToast('Please enter your phone number.', 'info');
        return false;
      }
      if (!selectedCountry.regex.test(cleanedPhone)) {
        showToast(`Please enter a valid ${selectedCountry.name} phone number (${selectedCountry.format}).`, 'error');
        return false;
      }
      if (!data.gender) {
        showToast('Please select your gender.', 'info');
        return false;
      }
      if (!data.dateOfBirth.trim()) {
        showToast('Please enter your date of birth.', 'info');
        return false;
      }

      // Check standard DOB format MM/DD/YYYY
      if (!DOB_PATTERN.test(data.dateOfBirth.trim())) {
        showToast('Please enter a valid date in MM/DD/YYYY format.', 'error');
        return false;
      }

      if (!parseDateOfBirth(data.dateOfBirth)) {
        showToast('Please enter a real calendar date.', 'error');
        return false;
      }
    }
    if (step === 2) {
      if (!data.addressLine.trim()) {
        showToast('Please enter your street address.', 'info');
        return false;
      }
      if (!data.barangay.trim()) {
        showToast('Please enter your barangay.', 'info');
        return false;
      }
      if (!data.city.trim()) {
        showToast('Please enter your city/municipality.', 'info');
        return false;
      }
      if (!data.province.trim()) {
        showToast('Please enter your province.', 'info');
        return false;
      }
      if (!data.zipCode.trim()) {
        showToast('Please enter your zip code.', 'info');
        return false;
      }
    }
    return true;
  };

  const next = () => {
    if (!validate()) return;
    if (step < TOTAL_STEPS - 1) transitionTo(step + 1);
    else handleSubmit();
  };

  const back = () => {
    if (step === 0) router.back();
    else transitionTo(step - 1);
  };

  const handleSubmit = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const cleanedPhone = data.phone.replace(/\D/g, '');
      const fullPhone = cleanedPhone ? `${selectedCountry.dialCode}${cleanedPhone}` : null;
      const dateOfBirth = parseDateOfBirth(data.dateOfBirth);

      const { error } = await supabase
        .from('profiles')
        .upsert({
          id:            user.id,
          email:         user.email ?? null,
          first_name:    data.firstName.trim(),
          last_name:     data.lastName.trim(),
          phone:         fullPhone,
          gender:        data.gender || null,
          date_of_birth: dateOfBirth,
          address_line:  data.addressLine.trim() || null,
          barangay:      data.barangay.trim() || null,
          city:          data.city.trim() || null,
          province:      data.province.trim() || null,
          zip_code:      data.zipCode.trim() || null,
          updated_at:    new Date().toISOString(),
        }, { onConflict: 'id' });

      if (error) throw error;

      // Refresh profile in context so root layout re-routes to (tabs)
      await refreshProfile();
      router.replace('/(tabs)');
    } catch (err: any) {
      showToast(err.message ?? 'Could not save profile. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const slides = [
    // ── Slide 1: Name ──────────────────────────────────────────
    (
      <View key="name" style={styles.fields}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>FIRST NAME</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Maria"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={data.firstName}
            onChangeText={v => set('firstName', v)}
            autoFocus
            returnKeyType="next"
          />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>LAST NAME</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Santos"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={data.lastName}
            onChangeText={v => set('lastName', v)}
            returnKeyType="done"
            onSubmitEditing={next}
          />
        </View>
        <Text style={styles.helperText}>
          Make sure it matches your valid ID — this is used for reservations.
        </Text>
      </View>
    ),

    // ── Slide 2: Personal Info ─────────────────────────────────
    (
      <ScrollView key="personal_info" showsVerticalScrollIndicator={false}>
        <View style={styles.fields}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>MOBILE NUMBER</Text>
            <View style={styles.phoneInputRow}>
              <TouchableOpacity
                style={styles.countrySelectorBtn}
                onPress={() => setShowCountryModal(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.countryFlag}>{selectedCountry.flag}</Text>
                <Text style={styles.countryDialCode}>{selectedCountry.dialCode}</Text>
                <ChevronDown size={14} color="rgba(255,255,255,0.4)" />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.phoneInput]}
                placeholder={selectedCountry.placeholder}
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={data.phone}
                onChangeText={handlePhoneChange}
                keyboardType="phone-pad"
                autoFocus
              />
            </View>
          </View>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { marginTop: 8 }]}>DATE OF BIRTH</Text>
            <View style={styles.dobInputRow}>
              <TextInput
                style={[styles.input, styles.dobInput]}
                placeholder="MM/DD/YYYY"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={data.dateOfBirth}
                onChangeText={handleDOBChange}
                keyboardType="numbers-and-punctuation"
              />
              <TouchableOpacity
                style={styles.calendarBtn}
                onPress={() => setShowDatePickerModal(true)}
                activeOpacity={0.7}
              >
                <Calendar size={20} color={Colors.dark.tint} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ marginTop: 8 }}>
            <Text style={styles.label}>GENDER</Text>
            <View style={styles.chipGrid}>
              {GENDER_OPTIONS.map(g => (
                <TouchableOpacity
                  key={g}
                  style={[styles.chip, data.gender === g && styles.chipActive]}
                  onPress={() => set('gender', g)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, data.gender === g && styles.chipTextActive]}>{g}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    ),

    // ── Slide 3: Address ───────────────────────────────────────
    (
      <ScrollView key="address" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.fields}>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>STREET ADDRESS</Text>
            <TextInput
              style={styles.input}
              placeholder="House/unit no., building, street name"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={data.addressLine}
              onChangeText={v => set('addressLine', v)}
              autoFocus
              returnKeyType="next"
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>BARANGAY</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Brgy. San Jose"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={data.barangay}
              onChangeText={v => set('barangay', v)}
              returnKeyType="next"
            />
          </View>
          <View style={styles.row}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.label}>CITY / MUNICIPALITY</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Cebu City"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={data.city}
                onChangeText={v => set('city', v)}
                returnKeyType="next"
              />
            </View>
          </View>
          <View style={styles.row}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={styles.label}>PROVINCE</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Cebu"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={data.province}
                onChangeText={v => set('province', v)}
                returnKeyType="next"
              />
            </View>
            <View style={{ width: 16 }} />
            <View style={[styles.fieldGroup, { width: 110 }]}>
              <Text style={styles.label}>ZIP CODE</Text>
              <TextInput
                style={styles.input}
                placeholder="0000"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={data.zipCode}
                onChangeText={v => set('zipCode', v)}
                keyboardType="numeric"
                returnKeyType="done"
                onSubmitEditing={next}
              />
            </View>
          </View>
          <Text style={styles.helperText}>
            You can add more addresses later in your profile settings.
          </Text>
        </View>
      </ScrollView>
    ),
  ];

  const meta = STEP_META[step];
  const Icon = meta.icon;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <LinearGradient colors={['#0A0A0A', '#0f0f0f']} style={StyleSheet.absoluteFillObject} />

      {/* Top step indicator */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={back} activeOpacity={0.7}>
          <ArrowLeft size={22} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
        <View style={styles.progressPills}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <Animated.View
              key={i}
              style={[
                styles.pill,
                i === step
                  ? styles.pillActive
                  : i < step
                  ? styles.pillDone
                  : styles.pillInactive,
              ]}
            />
          ))}
        </View>
        <Text style={styles.stepCount}>{step + 1}/{TOTAL_STEPS}</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          {/* Icon + Heading */}
          <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
            <View style={styles.iconBadge}>
              <Icon size={20} color={Colors.dark.tint} />
            </View>
            <Text style={styles.title}>{meta.title}</Text>
            <Text style={styles.subtitle}>{meta.subtitle}</Text>
          </Animated.View>

          {/* Slide content */}
          <Animated.View style={[styles.slideContent, { opacity: fadeAnim }]}>
            {slides[step]}
          </Animated.View>

          {/* CTA */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[styles.nextBtn, loading && { opacity: 0.7 }]}
              onPress={next}
              activeOpacity={0.85}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#0D0D0D" />
              ) : step < TOTAL_STEPS - 1 ? (
                <>
                  <Text style={styles.nextBtnText}>Continue</Text>
                  <ArrowRight size={18} color="#0D0D0D" />
                </>
              ) : (
                <>
                  <Text style={styles.nextBtnText}>Finish Setup</Text>
                  <Check size={18} color="#0D0D0D" />
                </>
              )}
            </TouchableOpacity>

            {/* Address slide can be skipped */}
            {step === TOTAL_STEPS - 1 && (
              <TouchableOpacity style={styles.skipBtn} onPress={() => handleSubmit()}>
                <Text style={styles.skipText}>Skip, I&apos;ll add address later</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      <CountryPickerModal
        visible={showCountryModal}
        selectedCountry={selectedCountry}
        onSelect={(c) => {
          setSelectedCountry(c);
          set('phone', ''); // clear input for new format
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

const GLASS = 'rgba(255,255,255,0.06)';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0A' },
  flex: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: { padding: 6 },
  progressPills: { flex: 1, flexDirection: 'row', gap: 6 },
  pill: { flex: 1, height: 3, borderRadius: 2 },
  pillActive:   { backgroundColor: Colors.dark.tint },
  pillDone:     { backgroundColor: `${Colors.dark.tint}66` },
  pillInactive: { backgroundColor: 'rgba(255,255,255,0.12)' },
  stepCount: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.5,
  },

  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 36,
  },
  header: { marginBottom: 28, marginTop: 16 },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: `${Colors.dark.tint}18`,
    borderWidth: 1,
    borderColor: `${Colors.dark.tint}33`,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 42,
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    lineHeight: 20,
  },

  slideContent: { flex: 1 },

  fields: { gap: 16 },
  row: { flexDirection: 'row' },
  fieldGroup: { gap: 8 },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.38)',
    letterSpacing: 1.6,
  },
  input: {
    fontSize: 16,
    color: '#fff',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.14)',
  },
  // Mobile Input Dial Code styles
  phoneInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  countrySelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    marginRight: 12,
    gap: 6,
  },
  countryFlag: {
    fontSize: 16,
  },
  countryDialCode: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  phoneInput: {
    flex: 1,
  },
  // Date of Birth Input row
  dobInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dobInput: {
    flex: 1,
  },
  calendarBtn: {
    position: 'absolute',
    right: 0,
    padding: 10,
  },

  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: GLASS,
  },
  chipActive: {
    backgroundColor: Colors.dark.tint,
    borderColor: Colors.dark.tint,
  },
  chipText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '500' },
  chipTextActive: { color: '#0D0D0D', fontWeight: '700' },

  helperText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    lineHeight: 18,
  },

  footer: { gap: 10, paddingTop: 16 },
  nextBtn: {
    height: 56,
    backgroundColor: Colors.dark.tint,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: Colors.dark.tint,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  nextBtnText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  skipBtn: { alignSelf: 'center', paddingVertical: 6 },
  skipText: { color: 'rgba(255,255,255,0.3)', fontSize: 13 },
});
