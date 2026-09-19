import React, { useState, useRef, useEffect, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Type, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { LevelIndicator } from '@/src/components/LevelIndicator';
import { ALIGNMENT_CONFIG } from '@/src/utils/bodyAlignmentEvaluator';
import { notifySuccess } from '@/src/utils/haptics';
import * as Speech from 'expo-speech';

interface Props {
  onDone: () => void;
  onCancel: () => void;
}

const READINESS_ITEMS = [
  {
    icon: 'tshirt',
    title: 'Fitted clothing',
    desc: 'No jackets or bulky layers',
  },
  {
    icon: 'lightbulb',
    title: 'Good lighting',
    desc: 'Well-lit area facing light',
  },
  {
    icon: 'square.grid.2x2',
    title: 'Clear space',
    desc: 'Stand ~2m back, whole body visible',
  },
  {
    icon: 'camera.viewfinder',
    title: 'Phone placement',
    desc: 'Waist height, propped upright',
  },
] as const;

export function ScanPrep({ onDone, onCancel }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const [step, setStep] = useState(0);

  // Device calibration state (Step 2)
  const [isLevel, setIsLevel] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(false);
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null);

  const TOTAL = 3;

  const handleLevelChange = useCallback((level: boolean) => {
    setIsLevel(level);

    if (level) {
      if (!holdTimerRef.current && !isCalibrated) {
        holdTimerRef.current = setTimeout(() => {
          setIsCalibrated(true);
          notifySuccess();
          Speech.speak('Phone positioned correctly. Tap Start Scan.');
          holdTimerRef.current = null;
        }, ALIGNMENT_CONFIG.deviceCalibrationHoldMs);
      }
    } else {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }
      setIsCalibrated(false);
    }
  }, [isCalibrated]);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
      }
      Speech.stop();
    };
  }, []);

  const next = () => {
    Speech.stop();
    if (step === TOTAL - 1) {
      onDone();
    } else {
      setStep((s) => s + 1);
    }
  };

  const back = () => {
    Speech.stop();
    if (step === 0) {
      onCancel();
    } else {
      setStep((s) => s - 1);
    }
  };

  // Step 2 gates on calibration lock; earlier steps can continue anytime
  const canContinue = step !== 2 || isCalibrated;

  const titles = [
    'We scan your body by taking one front and one side photo with your phone.',
    'A few quick preparations ensure accurate measurement.',
    'Tilt your phone until the dot sits inside the ring and stays steady.',
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.stepCount, { color: colors.secondaryText }]}>
          {step + 1}/{TOTAL}
        </Text>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {step === 0 ? 'Body Scan Overview' : step === 1 ? 'Scan Readiness' : 'Device Calibration'}
        </Text>
        <TouchableOpacity
          onPress={onCancel}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close the scan"
        >
          <IconSymbol name="xmark" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.lead, { color: colors.text }]}>{titles[step]}</Text>

        {/* Step 0: Overview (Front + Side Preview) */}
        {step === 0 && (
          <View style={styles.overviewWrap}>
            <View style={styles.overviewCardsRow}>
              <View style={[styles.overviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.overviewIconBox, { backgroundColor: colors.background }]}>
                  <IconSymbol name="figure.stand" size={44} color={colors.tint} />
                </View>
                <Text style={[styles.overviewCardLabel, { color: colors.text }]}>FRONT</Text>
                <Text style={[styles.overviewCardSub, { color: colors.secondaryText }]}>1. Face camera</Text>
              </View>

              <View style={[styles.overviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.overviewIconBox, { backgroundColor: colors.background }]}>
                  <IconSymbol name="figure.walk" size={44} color={colors.tint} />
                </View>
                <Text style={[styles.overviewCardLabel, { color: colors.text }]}>SIDE</Text>
                <Text style={[styles.overviewCardSub, { color: colors.secondaryText }]}>2. Turn sideways</Text>
              </View>
            </View>

            <View style={[styles.privacyBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <IconSymbol name="lock.fill" size={18} color={colors.secondaryText} />
              <Text style={[styles.privacyText, { color: colors.secondaryText }]}>
                Takes about 20 seconds. Photos are processed securely on this device and are never uploaded.
              </Text>
            </View>
          </View>
        )}

        {/* Step 1: Readiness Checklist (4 Tiles) */}
        {step === 1 && (
          <View style={styles.grid}>
            {READINESS_ITEMS.map((item) => (
              <View key={item.title} style={[styles.gridCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.gridIconBox, { backgroundColor: colors.background }]}>
                  <IconSymbol name={item.icon as any} size={28} color={colors.tint} />
                </View>
                <Text style={[styles.gridTitle, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.gridDesc, { color: colors.secondaryText }]}>{item.desc}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Step 2: Interactive Device Calibration */}
        {step === 2 && (
          <View style={styles.centerArt}>
            <LevelIndicator
              onLevelChange={handleLevelChange}
              toleranceDeg={ALIGNMENT_CONFIG.deviceCalibrationToleranceDeg}
            />
            <Text
              style={[
                styles.calibrationStatus,
                {
                  color: isCalibrated
                    ? '#22C55E'
                    : isLevel
                    ? '#E5A93C'
                    : colors.secondaryText,
                },
              ]}
            >
              {isCalibrated
                ? ' Phone positioned correctly'
                : isLevel
                ? 'Hold steady...'
                : 'Not upright yet — tilt phone'}
            </Text>
            <Text style={[styles.hint, { color: colors.secondaryText }]}>
              {isCalibrated
                ? 'Great! Tap Start Scan to open the camera.'
                : 'Prop your phone upright at waist height facing your standing area.'}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[
            styles.primary,
            {
              backgroundColor: canContinue ? colors.tint : (theme === 'dark' ? '#2A2A2C' : '#E5E7EB'),
              opacity: canContinue ? 1 : 0.6,
            },
          ]}
          onPress={next}
          disabled={!canContinue}
          accessibilityRole="button"
          accessibilityLabel={step === TOTAL - 1 ? 'Start scan' : 'Continue'}
          accessibilityHint={!canContinue ? 'Hold phone upright to unlock scan' : undefined}
          accessibilityState={{ disabled: !canContinue }}
        >
          <Text
            style={[
              styles.primaryText,
              { color: canContinue ? colors.onTint : colors.secondaryText },
            ]}
          >
            {step === TOTAL - 1 ? 'Start Scan' : 'Continue'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondary, { borderColor: colors.border }]}
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel={step === 0 ? 'Cancel' : 'Back'}
        >
          <Text style={[styles.secondaryText, { color: colors.text }]}>
            {step === 0 ? 'Cancel' : 'Back'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepCount: { fontSize: 15, fontWeight: '700', width: 34 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  body: { padding: Spacing.xl, paddingBottom: 40, alignItems: 'center' },
  lead: { fontSize: 17, lineHeight: 24, textAlign: 'center', fontWeight: '600', marginBottom: Spacing.xl },
  centerArt: { alignItems: 'center', marginTop: 24, gap: 14 },
  hint: { fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: Spacing.md },
  calibrationStatus: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  overviewWrap: { width: '100%', alignItems: 'center', gap: Spacing.xl, marginTop: Spacing.md },
  overviewCardsRow: { flexDirection: 'row', gap: Spacing.md, width: '100%' },
  overviewCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: 8,
  },
  overviewIconBox: {
    width: 64,
    height: 64,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  overviewCardLabel: { fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  overviewCardSub: { fontSize: 13, fontWeight: '500' },
  privacyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.lg,
    width: '100%',
  },
  privacyText: { flex: 1, fontSize: 13, lineHeight: 18 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
    width: '100%',
    rowGap: Spacing.md,
    columnGap: Spacing.md,
    marginTop: Spacing.sm,
  },
  gridCard: {
    width: '48%',
    borderWidth: 1,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    alignItems: 'center',
    gap: 6,
  },
  gridIconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  gridTitle: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  gridDesc: { fontSize: 12, lineHeight: 16, textAlign: 'center' },
  footer: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: { flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 15, fontWeight: '700' },
  secondary: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...Type.bodyStrong },
});
