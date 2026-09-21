import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Animated,
  StatusBar,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, ArrowRight, Check, User, Phone, MapPin, Calendar, ChevronDown } from 'lucide-react-native';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReduceMotion } from '@/src/hooks/useReduceMotion';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { useToast } from '@/src/context/ToastContext';
import { consumeAuthReturnTarget, consumePendingEntryTarget } from '@/src/utils/authReturnTarget';
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
  TOTAL_PROFILE_STEPS,
  resolveStepLabel,
  canNavigateToStep,
  getStepAccessibilityLabel,
} from '@/src/utils/profileFields';

const TOTAL_STEPS = TOTAL_PROFILE_STEPS;

const STEP_META = [
  { icon: User,    label: 'Name',    title: "What's your\nname?",    subtitle: 'Help us personalize your experience.' },
  { icon: Phone,   label: 'Info',    title: 'Personal\ninformation.', subtitle: 'For reservation updates and account security.' },
  // JezSy is reserve-and-collect, not delivery: nothing here is ever shipped,
  // and address_line/city/province/zip_code are read back only by this
  // screen and profile/edit.tsx, never by anything shipping-related. The
  // previous copy ("Your delivery address", "Where should we send your
  // orders?") promised a service the app does not have.
  { icon: MapPin,  label: 'Address', title: 'Your\naddress.', subtitle: 'Add your address to complete your profile.' },
];

export default function ProfileSetupScreen() {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isNarrow = windowWidth < 400;
  const reduceMotion = useReduceMotion();
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
  const hasInitializedStepRef = useRef(false);

  // Prefill from existing profile, user object, and signup/OAuth metadata.
  // Prevents duplicate entry by auto-advancing past steps the customer already completed.
  useEffect(() => {
    if (!user) return;

    const meta = user.user_metadata ?? {};
    const fullName: string = meta.full_name ?? meta.name ?? '';
    const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
    const existingFirst = profile?.first_name || (typeof meta.first_name === 'string' ? meta.first_name : '') || nameParts[0] || '';
    const existingLast = profile?.last_name || (typeof meta.last_name === 'string' ? meta.last_name : '') || nameParts.slice(1).join(' ') || '';
    const storedPhone = profile?.phone || user.phone || (typeof meta.signup_phone === 'string' ? meta.signup_phone : '');

    const { country: matchedCountry, localPhone } = matchCountryFromStoredPhone(storedPhone);
    if (matchedCountry) setSelectedCountry(matchedCountry);
    const fmtCountry = matchedCountry ?? COUNTRIES[0];

    const dob = dbDateToFormDate(profile?.date_of_birth);

    setData(prev => ({
      firstName:   prev.firstName   || existingFirst,
      lastName:    prev.lastName    || existingLast,
      phone:       prev.phone       || (localPhone ? formatPhoneForCountry(localPhone, fmtCountry) : ''),
      gender:      prev.gender      || profile?.gender || '',
      dateOfBirth: prev.dateOfBirth || dob,
      addressLine: prev.addressLine || profile?.address_line || '',
      barangay:    prev.barangay    || profile?.barangay || '',
      city:        prev.city        || profile?.city || '',
      province:    prev.province    || profile?.province || '',
      zipCode:     prev.zipCode     || profile?.zip_code || '',
    }));

    // Prevent duplicate entry: If Name (First & Last) was already gathered in signup or OAuth,
    // advance directly to Personal Info so the user is never asked for duplicate information.
    if (!hasInitializedStepRef.current) {
      hasInitializedStepRef.current = true;
      if (existingFirst && existingLast) {
        const hasPhone = Boolean(storedPhone);
        const hasDob = Boolean(dob);
        const hasGender = Boolean(profile?.gender);
        if (hasPhone && hasDob && hasGender) {
          setStep(2);
        } else {
          setStep(1);
        }
      }
    }
  }, [user, profile]);


  const set = (key: keyof ProfileData, value: string) =>
    setData(prev => ({ ...prev, [key]: value }));

  const transitionTo = (nextStep: number) => {
    if (reduceMotion) {
      fadeAnim.setValue(1);
      setStep(nextStep);
      return;
    }
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }),
    ]).start();
    setTimeout(() => setStep(nextStep), 120);
  };

  const handleStepPress = (targetStep: number) => {
    if (canNavigateToStep(targetStep, step)) {
      transitionTo(targetStep);
    }
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
        showToast('Enter your first and last name to continue.', 'info');
        return false;
      }
    }
    if (step === 1) {
      const cleanedPhone = data.phone.replace(/\D/g, '');
      if (!cleanedPhone) {
        showToast('Enter your phone number.', 'info');
        return false;
      }
      if (!selectedCountry.regex.test(cleanedPhone)) {
        showToast(`Enter a valid ${selectedCountry.name} phone number (${selectedCountry.format}).`, 'error');
        return false;
      }
      if (!data.gender) {
        showToast('Select your gender preference.', 'info');
        return false;
      }
      if (!data.dateOfBirth.trim()) {
        showToast('Enter your date of birth.', 'info');
        return false;
      }

      // Check standard DOB format MM/DD/YYYY
      if (!DOB_PATTERN.test(data.dateOfBirth.trim())) {
        showToast('Use MM/DD/YYYY format for date of birth.', 'error');
        return false;
      }

      if (!parseDateOfBirth(data.dateOfBirth)) {
        showToast('Enter a valid calendar date.', 'error');
        return false;
      }
    }
    if (step === 2) {
      if (!data.addressLine.trim()) {
        showToast('Enter your street address.', 'info');
        return false;
      }
      if (!data.barangay.trim()) {
        showToast('Enter your barangay.', 'info');
        return false;
      }
      if (!data.city.trim()) {
        showToast('Enter your city or municipality.', 'info');
        return false;
      }
      if (!data.province.trim()) {
        showToast('Enter your province.', 'info');
        return false;
      }
      if (!data.zipCode.trim()) {
        showToast('Enter your ZIP code.', 'info');
        return false;
      }
    }
    return true;
  };

  const next = () => {
    if (loading) return;
    if (!validate()) return;
    if (step < TOTAL_STEPS - 1) transitionTo(step + 1);
    else handleSubmit();
  };

  const back = () => {
    if (step === 0) router.back();
    else transitionTo(step - 1);
  };

  const handleSubmit = async () => {
    if (!user || loading) return;
    setLoading(true);
    try {
      const cleanedPhone = data.phone.replace(/\D/g, '');
      const fullPhone = cleanedPhone ? `${selectedCountry.dialCode}${cleanedPhone}` : null;
      const dateOfBirth = parseDateOfBirth(data.dateOfBirth);

      const updatePayload = {
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
      };

      // Update existing profile row (pre-created during signup/OAuth by handle_new_user trigger)
      const { data: updatedRows, error: updateError } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', user.id)
        .select('id');

      if (updateError) throw updateError;

      // Defensive fallback: If the profile row was not pre-created by the trigger, insert it
      if (!updatedRows || updatedRows.length === 0) {
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            email: user.email ?? null,
            ...updatePayload,
          });

        if (insertError) throw insertError;
      }

      // Refresh profile in context so root layout knows profile is complete
      await refreshProfile();


      const returnTarget = await consumeAuthReturnTarget();
      if (returnTarget) {
        router.replace({
          pathname: returnTarget.pathname,
          params: returnTarget.params,
        } as any);
        return;
      }

      const pendingEntry = await consumePendingEntryTarget();
      if (pendingEntry) {
        router.replace({
          pathname: pendingEntry.pathname,
          params: pendingEntry.params,
        } as any);
        return;
      }

      router.replace('/(tabs)');
    } catch (err: any) {
      console.error('Failed to save profile:', err);
      showToast('Could not save your profile. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const slides = [
    // ── Slide 1: Name ──────────────────────────────────────────
    (
      <View key="name" style={styles.fields}>
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.secondaryText }]}>First name</Text>
          <TextInput keyboardAppearance={theme}
            style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
            placeholder="e.g. Maria"
            placeholderTextColor={colors.secondaryText}
            value={data.firstName}
            onChangeText={v => set('firstName', v)}
            autoFocus
            returnKeyType="next"
            accessibilityLabel="First name"
          />
        </View>
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.secondaryText }]}>Last name</Text>
          <TextInput keyboardAppearance={theme}
            style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
            placeholder="e.g. Santos"
            placeholderTextColor={colors.secondaryText}
            value={data.lastName}
            onChangeText={v => set('lastName', v)}
            returnKeyType="done"
            onSubmitEditing={next}
            accessibilityLabel="Last name"
          />
        </View>
        <Text style={[styles.helperText, { color: colors.secondaryText }]}>
          Make sure it matches your valid ID — this is used for reservations.
        </Text>
      </View>
    ),

    // ── Slide 2: Personal Info ─────────────────────────────────
    (
      <ScrollView key="personal_info" showsVerticalScrollIndicator={false}>
        <View style={styles.fields}>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.secondaryText }]}>Mobile number</Text>
            <View style={styles.phoneInputRow}>
              <TouchableOpacity
                style={[styles.countrySelectorBtn, { backgroundColor: colors.glass, borderColor: colors.hairline }]}
                onPress={() => setShowCountryModal(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.countryFlag}>{selectedCountry.flag}</Text>
                <Text style={[styles.countryDialCode, { color: colors.text }]}>{selectedCountry.dialCode}</Text>
                <ChevronDown size={14} color={colors.secondaryText} />
              </TouchableOpacity>
              <TextInput keyboardAppearance={theme}
                style={[styles.input, styles.phoneInput, { color: colors.text, borderBottomColor: colors.border }]}
                placeholder={selectedCountry.placeholder}
                placeholderTextColor={colors.secondaryText}
                value={data.phone}
                onChangeText={handlePhoneChange}
                keyboardType="phone-pad"
                autoFocus
                accessibilityLabel="Mobile phone number"
              />
            </View>
          </View>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.secondaryText, marginTop: Spacing.sm }]}>Date of birth</Text>
            <View style={styles.dobInputRow}>
              <TextInput keyboardAppearance={theme}
                style={[styles.input, styles.dobInput, { color: colors.text, borderBottomColor: colors.border }]}
                placeholder="MM/DD/YYYY"
                placeholderTextColor={colors.secondaryText}
                value={data.dateOfBirth}
                onChangeText={handleDOBChange}
                keyboardType="numbers-and-punctuation"
                accessibilityLabel="Date of birth"
              />
              <TouchableOpacity
                style={styles.calendarBtn}
                onPress={() => setShowDatePickerModal(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Open calendar to pick date of birth"
              >
                <Calendar size={20} color={colors.tint} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ marginTop: Spacing.sm }}>
            <Text style={[styles.label, { color: colors.secondaryText }]}>Gender</Text>
            <View style={styles.chipGrid}>
              {GENDER_OPTIONS.map(g => (
                <TouchableOpacity
                  key={g}
                  style={[
                    styles.chip,
                    { borderColor: colors.hairline, backgroundColor: colors.glass },
                    data.gender === g && { backgroundColor: colors.tint, borderColor: colors.tint },
                  ]}
                  onPress={() => set('gender', g)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={g}
                  accessibilityState={{ selected: data.gender === g }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: data.gender === g ? colors.onTint : colors.secondaryText },
                      data.gender === g && styles.chipTextActive,
                    ]}
                  >
                    {g}
                  </Text>
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
            <Text style={[styles.label, { color: colors.secondaryText }]}>Street address</Text>
            <TextInput keyboardAppearance={theme}
              style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
              placeholder="House/unit no., building, street name"
              placeholderTextColor={colors.secondaryText}
              value={data.addressLine}
              onChangeText={v => set('addressLine', v)}
              autoFocus
              returnKeyType="next"
              accessibilityLabel="Street address"
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={[styles.label, { color: colors.secondaryText }]}>Barangay</Text>
            <TextInput keyboardAppearance={theme}
              style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
              placeholder="e.g. Brgy. San Jose"
              placeholderTextColor={colors.secondaryText}
              value={data.barangay}
              onChangeText={v => set('barangay', v)}
              returnKeyType="next"
              accessibilityLabel="Barangay"
            />
          </View>
          <View style={styles.row}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.secondaryText }]}>City / Municipality</Text>
              <TextInput keyboardAppearance={theme}
                style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
                placeholder="e.g. Cebu City"
                placeholderTextColor={colors.secondaryText}
                value={data.city}
                onChangeText={v => set('city', v)}
                returnKeyType="next"
                accessibilityLabel="City or Municipality"
              />
            </View>
          </View>
          <View style={styles.row}>
            <View style={[styles.fieldGroup, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.secondaryText }]}>Province</Text>
              <TextInput keyboardAppearance={theme}
                style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
                placeholder="e.g. Cebu"
                placeholderTextColor={colors.secondaryText}
                value={data.province}
                onChangeText={v => set('province', v)}
                returnKeyType="next"
                accessibilityLabel="Province"
              />
            </View>
            <View style={{ width: 16 }} />
            <View style={[styles.fieldGroup, { width: 110 }]}>
              <Text style={[styles.label, { color: colors.secondaryText }]}>Zip code</Text>
              <TextInput keyboardAppearance={theme}
                style={[styles.input, { color: colors.text, borderBottomColor: colors.border }]}
                placeholder="0000"
                placeholderTextColor={colors.secondaryText}
                value={data.zipCode}
                onChangeText={v => set('zipCode', v)}
                keyboardType="numeric"
                returnKeyType="done"
                onSubmitEditing={next}
                accessibilityLabel="Zip code"
              />
            </View>
          </View>
          <Text style={[styles.helperText, { color: colors.secondaryText }]}>
            You can add more addresses later in your profile settings.
          </Text>
        </View>
      </ScrollView>
    ),
  ];

  const meta = STEP_META[step];
  const Icon = meta.icon;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />
      <LinearGradient colors={[colors.background, colors.surface]} style={StyleSheet.absoluteFill} />

      {/* Top step indicator */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topBarRow}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={back}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            accessibilityHint={step === 0 ? 'Exits profile setup' : 'Returns to previous step'}
          >
            <ArrowLeft size={22} color={colors.text} />
          </TouchableOpacity>

          <View style={styles.stepperContainer}>
            <View style={styles.stepColsRow}>
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
                const isCompleted = i < step;
                const isActive = i === step;
                const label = resolveStepLabel(i, isNarrow);
                const a11yLabel = getStepAccessibilityLabel(i, step, TOTAL_STEPS, label);

                const stepContent = (
                  <View style={styles.stepColInner}>
                    <View
                      style={[
                        styles.pill,
                        isCompleted || isActive
                          ? { backgroundColor: colors.tint }
                          : {
                              backgroundColor:
                                theme === 'dark'
                                  ? 'rgba(255, 255, 255, 0.16)'
                                  : 'rgba(0, 0, 0, 0.12)',
                            },
                      ]}
                    />
                    <View style={styles.labelContainer}>
                      {isCompleted && (
                        <Check
                          size={11}
                          color={colors.tint}
                          strokeWidth={2.5}
                          style={styles.checkIcon}
                        />
                      )}
                      <Text
                        style={[
                          styles.stepLabel,
                          isActive && [styles.stepLabelActive, { color: colors.text }],
                          isCompleted && [styles.stepLabelCompleted, { color: colors.tint }],
                          !isCompleted && !isActive && [
                            styles.stepLabelUpcoming,
                            { color: colors.secondaryText },
                          ],
                        ]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {label}
                      </Text>
                    </View>
                  </View>
                );

                if (isCompleted) {
                  return (
                    <TouchableOpacity
                      key={i}
                      style={styles.stepCol}
                      onPress={() => handleStepPress(i)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={a11yLabel}
                      accessibilityHint="Returns to this step"
                    >
                      {stepContent}
                    </TouchableOpacity>
                  );
                }

                if (isActive) {
                  return (
                    <View
                      key={i}
                      style={styles.stepCol}
                      accessible={true}
                      accessibilityRole="text"
                      accessibilityLabel={a11yLabel}
                      accessibilityState={{ selected: true }}
                    >
                      {stepContent}
                    </View>
                  );
                }

                return (
                  <View
                    key={i}
                    style={styles.stepCol}
                    accessible={true}
                    accessibilityRole="text"
                    accessibilityLabel={a11yLabel}
                    accessibilityState={{ disabled: true }}
                  >
                    {stepContent}
                  </View>
                );
              })}
            </View>

            <View style={styles.stepCountWrapper}>
              <Text
                style={[styles.stepCount, { color: colors.secondaryText }]}
                accessibilityElementsHidden={true}
                importantForAccessibility="no"
              >
                STEP {step + 1} OF {TOTAL_STEPS}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.content}>
          {/* Icon + Heading */}
          <Animated.View style={[styles.header, { opacity: fadeAnim }]}>
            <View style={[styles.iconBadge, { backgroundColor: `${colors.tint}18`, borderColor: `${colors.tint}33` }]}>
              <Icon size={20} color={colors.tint} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>{meta.title}</Text>
            <Text style={[styles.subtitle, { color: colors.secondaryText }]}>{meta.subtitle}</Text>
          </Animated.View>

          {/* Slide content */}
          <Animated.View style={[styles.slideContent, { opacity: fadeAnim }]}>
            {slides[step]}
          </Animated.View>

          {/* CTA */}
          <View style={styles.footer}>
            <PrimaryButton
              label={step < TOTAL_STEPS - 1 ? 'Continue' : 'Finish Setup'}
              onPress={next}
              loading={loading}
              icon={step < TOTAL_STEPS - 1
                ? <ArrowRight size={18} color={colors.onTint} />
                : <Check size={18} color={colors.onTint} />}
              style={[
                styles.nextBtnGlow,
                Platform.select({
                  ios: { shadowColor: colors.tint },
                  web: { boxShadow: '0 4px 10px rgba(201,169,110,0.35)' },
                }),
              ]}
            />

            {/* Address slide can be skipped */}
            {step === TOTAL_STEPS - 1 && (
              <TouchableOpacity style={styles.skipBtn} onPress={() => handleSubmit()}>
                <Text style={[styles.skipText, { color: colors.secondaryText }]}>Skip, I&apos;ll add address later</Text>
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },

  topBar: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -2,
    marginLeft: -Spacing.xs,
  },
  stepperContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 18,
  },
  stepColsRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  stepCol: {
    flex: 1,
  },
  stepColInner: {
    width: '100%',
  },
  pill: {
    width: '100%',
    height: 5,
    borderRadius: Radius.pill,
  },
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 3,
  },
  checkIcon: {
    marginRight: 1,
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  stepLabelActive: {
    fontWeight: '700',
  },
  stepLabelCompleted: {
    fontWeight: '600',
  },
  stepLabelUpcoming: {
    fontWeight: '500',
    opacity: 0.6,
  },
  stepCountWrapper: {
    height: 5,
    justifyContent: 'center',
    marginLeft: 10,
  },
  stepCount: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },

  content: {
    flex: 1,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: Spacing.xxl,
    paddingBottom: 36,
  },
  header: { marginBottom: 28, marginTop: Spacing.lg },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    lineHeight: 42,
    letterSpacing: -0.5,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },

  slideContent: { flex: 1 },

  fields: { gap: Spacing.lg },
  row: { flexDirection: 'row' },
  fieldGroup: { gap: Spacing.sm },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.6,
    // Caps live here, not in the string: a screen reader spells out literal
    // all-caps text letter by letter.
    textTransform: 'uppercase',
  },
  input: {
    fontSize: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
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
    paddingHorizontal: Spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    marginRight: Spacing.md,
    gap: 6,
  },
  countryFlag: {
    fontSize: 16,
  },
  countryDialCode: {
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
    gap: Spacing.sm,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: 100,
    borderWidth: 1,
  },
  chipText: { fontSize: 14, fontWeight: '500' },
  chipTextActive: { fontWeight: '700' },

  helperText: {
    fontSize: 12,
    lineHeight: 18,
  },

  footer: { gap: 10, paddingTop: Spacing.lg },
  // Geometry and colour now live in PrimaryButton; only the gold glow is
  // specific to this screen. Not an Elevation token -- those cast black.
  nextBtnGlow: {
    elevation: 6,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
    }),
  },
  skipBtn: { alignSelf: 'center', paddingVertical: 6 },
  skipText: { fontSize: 13 },
});
