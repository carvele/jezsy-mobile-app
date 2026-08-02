import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { LevelIndicator } from '@/src/components/LevelIndicator';

// Staged preparation before the camera opens. The scan used to drop the
// customer straight into a live camera with a single spoken sentence, so
// everything that actually determines accuracy -- clothing, lighting, phone
// height, phone angle -- was either never said or said once and missed.
//
// Each step is one instruction, because a single combined screen is skipped.

const CHECKLIST = [
  { icon: 'eyeglasses', label: 'No sunglasses or hats' },
  { icon: 'tshirt', label: 'No jackets or outer layers' },
  { icon: 'square.grid.2x2', label: 'No loose or patterned clothing' },
  { icon: 'shoe', label: 'No heels or thick soles' },
  { icon: 'lightbulb', label: 'Stand in a well lit area' },
  { icon: 'bag', label: 'Nothing blocking your body' },
] as const;

interface Props {
  onDone: () => void;
  onCancel: () => void;
}

export function ScanPrep({ onDone, onCancel }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const [step, setStep] = useState(0);
  const [isLevel, setIsLevel] = useState(false);

  const TOTAL = 5;
  const next = () => (step === TOTAL - 1 ? onDone() : setStep((s) => s + 1));
  const back = () => (step === 0 ? onCancel() : setStep((s) => s - 1));

  // The level step gates on the reading rather than a tap: letting someone
  // continue while the phone is tilted just moves the failure into the scan.
  const canContinue = step !== 4 || isLevel;

  const titles = [
    'We measure you from a single standing pose. It takes about a minute.',
    'A few things make the measurement far more accurate.',
    'Spoken guidance runs during the scan. Turn your volume up and unmute.',
    'Stand your phone upright at about waist height, then step back until your whole body fits on screen.',
    'Tilt your phone until the dot sits in the middle and the ring turns green.',
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.stepCount, { color: colors.secondaryText }]}>
          {step + 1}/{TOTAL}
        </Text>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Prepare for the scan</Text>
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

        {step === 1 && (
          <View style={styles.grid}>
            {CHECKLIST.map((item) => (
              <View key={item.label} style={styles.gridItem}>
                <View style={[styles.gridIcon, { borderColor: colors.border }]}>
                  <IconSymbol name={item.icon as any} size={26} color={colors.text} />
                </View>
                <Text style={[styles.gridLabel, { color: colors.secondaryText }]}>{item.label}</Text>
              </View>
            ))}
          </View>
        )}

        {step === 2 && (
          <View style={styles.centerArt}>
            <IconSymbol name="speaker.wave.2.fill" size={90} color={colors.tint} />
          </View>
        )}

        {step === 3 && (
          <View style={styles.centerArt}>
            <IconSymbol name="camera.viewfinder" size={90} color={colors.tint} />
            <Text style={[styles.hint, { color: colors.secondaryText }]}>
              About 2 metres back, phone leaning against something steady.
            </Text>
          </View>
        )}

        {step === 4 && (
          <View style={styles.centerArt}>
            <LevelIndicator onLevelChange={setIsLevel} />
            <Text style={[styles.hint, { color: isLevel ? colors.success : colors.secondaryText }]}>
              {isLevel ? 'Good - hold it there.' : 'Not upright yet.'}
            </Text>
          </View>
        )}

        {step === 0 && (
          <View style={styles.centerArt}>
            <IconSymbol name="figure.stand" size={90} color={colors.tint} />
            <Text style={[styles.hint, { color: colors.secondaryText }]}>
              Nothing leaves your device. Your photos are never uploaded.
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.primary, { backgroundColor: canContinue ? colors.tint : colors.border }]}
          onPress={next}
          disabled={!canContinue}
          accessibilityRole="button"
          accessibilityLabel={step === TOTAL - 1 ? 'Start the scan' : 'Continue'}
          accessibilityHint={!canContinue ? 'Hold the phone upright to continue' : undefined}
          accessibilityState={{ disabled: !canContinue }}
        >
          <Text style={styles.primaryText}>{step === TOTAL - 1 ? 'Start scan' : 'Continue'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.secondary, { borderColor: colors.border }]}
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel={step === 0 ? 'Cancel' : 'Back'}
        >
          <Text style={[styles.secondaryText, { color: colors.text }]}>Back</Text>
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
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepCount: { fontSize: 15, fontWeight: '700', width: 34 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  body: { padding: 24, paddingBottom: 40, alignItems: 'center' },
  lead: { fontSize: 18, lineHeight: 26, textAlign: 'center', fontWeight: '600' },
  centerArt: { alignItems: 'center', marginTop: 48, gap: 18 },
  hint: { fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 12 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 32,
    rowGap: 26,
  },
  gridItem: { width: '48%', alignItems: 'center', gap: 10 },
  gridIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLabel: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: { flex: 1, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#0D0D0D', fontSize: 15, fontWeight: '700' },
  secondary: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 15, fontWeight: '600' },
});
