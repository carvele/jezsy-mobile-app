import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Animated,
  StatusBar,
  ScrollView,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, ArrowRight, Check, User, Phone, MapPin, Calendar, ChevronDown } from 'lucide-react-native';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { Colors } from '@/constants/theme';



const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];

type ProfileData = {
  firstName: string;
  lastName: string;
  phone: string;
  gender: string;
  dateOfBirth: string;
  addressLine: string;
  barangay: string;
  city: string;
  province: string;
  zipCode: string;
};

type Country = {
  code: string;
  name: string;
  dialCode: string;
  flag: string;
  format: string;
  maxLength: number;
  placeholder: string;
  regex: RegExp;
};

const COUNTRIES: Country[] = [
  {
    code: 'PH',
    name: 'Philippines',
    dialCode: '+63',
    flag: '🇵🇭',
    format: '900 000 0000',
    maxLength: 10,
    placeholder: '912 345 6789',
    regex: /^9\d{9}$/,
  },
  {
    code: 'US',
    name: 'United States',
    dialCode: '+1',
    flag: '🇺🇸',
    format: '000 000 0000',
    maxLength: 10,
    placeholder: '201 555 0123',
    regex: /^\d{10}$/,
  },
  {
    code: 'SG',
    name: 'Singapore',
    dialCode: '+65',
    flag: '🇸🇬',
    format: '0000 0000',
    maxLength: 8,
    placeholder: '8123 4567',
    regex: /^[89]\d{7}$/,
  },
  {
    code: 'GB',
    name: 'United Kingdom',
    dialCode: '+44',
    flag: '🇬🇧',
    format: '0000 000000',
    maxLength: 10,
    placeholder: '7123 456789',
    regex: /^7\d{9}$/,
  },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - 1939 }, (_, i) => currentYear - i); // 2026 down to 1940
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

const TOTAL_STEPS = 3;

// Formats raw phone digits into the country's spaced display format. Shared by
// live input handling and by prefill when loading an existing stored number.
const formatPhoneForCountry = (digits: string, country: Country): string => {
  let cleaned = digits.replace(/\D/g, '');
  if (country.code === 'PH' && cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  cleaned = cleaned.substring(0, country.maxLength);

  let formatted = '';
  let formatIndex = 0;
  for (let i = 0; i < cleaned.length; i++) {
    while (formatIndex < country.format.length && country.format[formatIndex] === ' ') {
      formatted += ' ';
      formatIndex++;
    }
    formatted += cleaned[i];
    formatIndex++;
  }
  return formatted;
};

const STEP_META = [
  { icon: User,    label: 'Name',    title: "What's your\nname?",    subtitle: 'Help us personalize your experience.' },
  { icon: Phone,   label: 'Info',    title: 'Personal\ninformation.', subtitle: 'For order updates and account security.' },
  { icon: MapPin,  label: 'Address', title: 'Your delivery\naddress.',  subtitle: 'Where should we send your orders?' },
];

export default function ProfileSetupScreen() {
  const router = useRouter();
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
  const [selectedDay, setSelectedDay] = useState(1);
  const [selectedMonth, setSelectedMonth] = useState(0);
  const [selectedYear, setSelectedYear] = useState(2000);

  // Prefill from the existing profile (this screen doubles as "Edit profile",
  // reached from the profile tab), falling back to OAuth metadata for names on
  // first-time setup. Without this, editing starts blank and the skip-address
  // path would upsert null over a previously saved address. The `prev.x ||`
  // guards keep anything the user has already typed from being overwritten.
  useEffect(() => {
    if (!user) return;

    const meta = user.user_metadata ?? {};
    const fullName: string = meta.full_name ?? meta.name ?? '';
    const nameParts = fullName.trim().split(/\s+/).filter(Boolean);

    // Stored phone is "+<dial><local>"; recover the country and local digits.
    let matchedCountry: Country | null = null;
    let localPhone = '';
    if (profile?.phone) {
      const m = COUNTRIES.find(c => profile.phone!.startsWith(c.dialCode));
      if (m) {
        matchedCountry = m;
        localPhone = profile.phone.slice(m.dialCode.length);
      }
    }
    if (matchedCountry) setSelectedCountry(matchedCountry);
    const fmtCountry = matchedCountry ?? COUNTRIES[0];

    // Stored DOB is YYYY-MM-DD; the form field uses MM/DD/YYYY.
    let dob = '';
    if (profile?.date_of_birth) {
      const [y, m, d] = profile.date_of_birth.split('-');
      if (y && m && d) dob = `${m}/${d}/${y}`;
    }

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

  // Helper to check how many days are in a month
  const getDaysInMonth = (month: number, year: number): number => {
    return new Date(year, month + 1, 0).getDate();
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

  const openDatePicker = () => {
    // Attempt to seed from input
    const parts = data.dateOfBirth.split('/');
    if (parts.length === 3) {
      const m = parseInt(parts[0], 10) - 1;
      const d = parseInt(parts[1], 10);
      const y = parseInt(parts[2], 10);
      if (!isNaN(m) && m >= 0 && m < 12) setSelectedMonth(m);
      if (!isNaN(d) && d > 0 && d <= 31) setSelectedDay(d);
      if (!isNaN(y) && y >= 1940 && y <= currentYear) setSelectedYear(y);
    }
    setShowDatePickerModal(true);
  };

  const handleMonthSelect = (mIndex: number) => {
    setSelectedMonth(mIndex);
    const maxDays = getDaysInMonth(mIndex, selectedYear);
    if (selectedDay > maxDays) {
      setSelectedDay(maxDays);
    }
  };

  const handleYearSelect = (year: number) => {
    setSelectedYear(year);
    const maxDays = getDaysInMonth(selectedMonth, year);
    if (selectedDay > maxDays) {
      setSelectedDay(maxDays);
    }
  };

  const confirmDatePicker = () => {
    const mm = String(selectedMonth + 1).padStart(2, '0');
    const dd = String(selectedDay).padStart(2, '0');
    const yyyy = String(selectedYear);
    set('dateOfBirth', `${mm}/${dd}/${yyyy}`);
    setShowDatePickerModal(false);
  };

  const parseDateOfBirth = (): string | null => {
    if (!data.dateOfBirth.trim()) return null;
    const [month, day, year] = data.dateOfBirth.split('/').map(Number);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const validate = (): boolean => {
    if (step === 0) {
      if (!data.firstName.trim() || !data.lastName.trim()) {
        Alert.alert('Missing Info', 'Please enter your first and last name.');
        return false;
      }
    }
    if (step === 1) {
      const cleanedPhone = data.phone.replace(/\D/g, '');
      if (!cleanedPhone) {
        Alert.alert('Missing Info', 'Please enter your phone number.');
        return false;
      }
      if (!selectedCountry.regex.test(cleanedPhone)) {
        Alert.alert(
          'Invalid Phone',
          `Please enter a valid ${selectedCountry.name} phone number (${selectedCountry.format}).`
        );
        return false;
      }
      if (!data.gender) {
        Alert.alert('Missing Info', 'Please select your gender.');
        return false;
      }
      if (!data.dateOfBirth.trim()) {
        Alert.alert('Missing Info', 'Please enter your date of birth.');
        return false;
      }

      // Check standard DOB format MM/DD/YYYY
      const dobPattern = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(19|20)\d{2}$/;
      if (!dobPattern.test(data.dateOfBirth.trim())) {
        Alert.alert('Invalid Date', 'Please enter a valid date in MM/DD/YYYY format.');
        return false;
      }

      if (!parseDateOfBirth()) {
        Alert.alert('Invalid Date', 'Please enter a real calendar date.');
        return false;
      }
    }
    if (step === 2) {
      if (!data.addressLine.trim()) {
        Alert.alert('Missing Info', 'Please enter your street address.');
        return false;
      }
      if (!data.barangay.trim()) {
        Alert.alert('Missing Info', 'Please enter your barangay.');
        return false;
      }
      if (!data.city.trim()) {
        Alert.alert('Missing Info', 'Please enter your city/municipality.');
        return false;
      }
      if (!data.province.trim()) {
        Alert.alert('Missing Info', 'Please enter your province.');
        return false;
      }
      if (!data.zipCode.trim()) {
        Alert.alert('Missing Info', 'Please enter your zip code.');
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
      const dateOfBirth = parseDateOfBirth();

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
      Alert.alert('Error', err.message ?? 'Could not save profile. Please try again.');
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
                onPress={openDatePicker}
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
      <View style={styles.topBar}>
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

      {/* ── Modal 1: Country Selector ────────────────────────────────── */}
      <Modal
        visible={showCountryModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCountryModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowCountryModal(false)}
        >
          <TouchableOpacity
            style={styles.bottomSheet}
            activeOpacity={1}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Country</Text>
              <TouchableOpacity
                onPress={() => setShowCountryModal(false)}
                style={styles.modalCloseBtn}
              >
                <Text style={styles.modalCloseText}>Done</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.countryList}>
              {COUNTRIES.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[
                    styles.countryItem,
                    selectedCountry.code === c.code && styles.countryItemActive
                  ]}
                  onPress={() => {
                    setSelectedCountry(c);
                    set('phone', ''); // clear input for new format
                    setShowCountryModal(false);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.countryItemLeft}>
                    <Text style={styles.countryItemFlag}>{c.flag}</Text>
                    <Text style={styles.countryItemName}>{c.name}</Text>
                  </View>
                  <Text style={styles.countryItemDialCode}>{c.dialCode}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Modal 2: DOB Date Picker ─────────────────────────────────── */}
      <Modal
        visible={showDatePickerModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowDatePickerModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowDatePickerModal(false)}
        >
          <TouchableOpacity
            style={styles.bottomSheet}
            activeOpacity={1}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Date of Birth</Text>
              <TouchableOpacity
                onPress={() => setShowDatePickerModal(false)}
                style={styles.modalCloseBtn}
              >
                <Text style={styles.modalCloseText}>Cancel</Text>
              </TouchableOpacity>
            </View>

            {/* Custom columns layout */}
            <View style={styles.pickerColumnsRow}>
              {/* MONTH Column */}
              <View style={styles.pickerColumn}>
                <Text style={styles.pickerColumnLabel}>MONTH</Text>
                <ScrollView showsVerticalScrollIndicator={false} style={styles.pickerColumnList}>
                  {MONTH_NAMES.map((name, idx) => (
                    <TouchableOpacity
                      key={name}
                      style={[
                        styles.pickerItem,
                        selectedMonth === idx && styles.pickerItemActive
                      ]}
                      onPress={() => handleMonthSelect(idx)}
                    >
                      <Text style={[
                        styles.pickerItemText,
                        selectedMonth === idx && styles.pickerItemTextActive
                      ]}>
                        {name.substring(0, 3)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* DAY Column */}
              <View style={styles.pickerColumn}>
                <Text style={styles.pickerColumnLabel}>DAY</Text>
                <ScrollView showsVerticalScrollIndicator={false} style={styles.pickerColumnList}>
                  {DAYS.slice(0, getDaysInMonth(selectedMonth, selectedYear)).map((day) => (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.pickerItem,
                        selectedDay === day && styles.pickerItemActive
                      ]}
                      onPress={() => setSelectedDay(day)}
                    >
                      <Text style={[
                        styles.pickerItemText,
                        selectedDay === day && styles.pickerItemTextActive
                      ]}>
                        {day}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              {/* YEAR Column */}
              <View style={styles.pickerColumn}>
                <Text style={styles.pickerColumnLabel}>YEAR</Text>
                <ScrollView showsVerticalScrollIndicator={false} style={styles.pickerColumnList}>
                  {YEARS.map((yr) => (
                    <TouchableOpacity
                      key={yr}
                      style={[
                        styles.pickerItem,
                        selectedYear === yr && styles.pickerItemActive
                      ]}
                      onPress={() => handleYearSelect(yr)}
                    >
                      <Text style={[
                        styles.pickerItemText,
                        selectedYear === yr && styles.pickerItemTextActive
                      ]}>
                        {yr}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>

            {/* Confirm button */}
            <TouchableOpacity
              style={styles.pickerConfirmBtn}
              onPress={confirmDatePicker}
              activeOpacity={0.8}
            >
              <Text style={styles.pickerConfirmBtnText}>Confirm Date</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
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
    fontSize: 11,
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

  // Modal / Bottom Sheet styling
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    backgroundColor: '#141414',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 44 : 24,
    maxHeight: '75%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalCloseText: {
    color: Colors.dark.tint,
    fontSize: 15,
    fontWeight: '600',
  },
  countryList: {
    gap: 8,
  },
  countryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  countryItemActive: {
    borderColor: `${Colors.dark.tint}4D`,
    backgroundColor: 'rgba(201, 169, 110, 0.06)',
  },
  countryItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  countryItemFlag: {
    fontSize: 20,
  },
  countryItemName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  countryItemDialCode: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontWeight: '600',
  },

  // Custom DOB Date Picker modal styling
  pickerColumnsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: 220,
    marginBottom: 20,
    gap: 8,
  },
  pickerColumn: {
    flex: 1,
    alignItems: 'center',
  },
  pickerColumnLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  pickerColumnList: {
    flex: 1,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  pickerItem: {
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.01)',
  },
  pickerItemActive: {
    backgroundColor: 'rgba(201, 169, 110, 0.08)',
  },
  pickerItemText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 15,
    fontWeight: '500',
  },
  pickerItemTextActive: {
    color: Colors.dark.tint,
    fontSize: 16,
    fontWeight: '700',
  },
  pickerConfirmBtn: {
    height: 50,
    backgroundColor: Colors.dark.tint,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  pickerConfirmBtnText: {
    color: '#0D0D0D',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
