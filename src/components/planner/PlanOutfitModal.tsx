import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  PlanLaterPayload,
  PlannerSlot,
  PlannedOutfit,
} from '@/src/types/planner';
import {
  getTodayCalendarDate,
  addCalendarDays,
  formatDayDisplay,
  formatSlotLabel,
  resolveDeviceTimezone,
} from '@/src/utils/plannerDateTime';
import { validateSavedOutfitAvailability } from '@/src/utils/plannerSnapshotAdapter';
import { createPlannedOutfit } from '@/src/services/plannerService';
import { PlannerCalendarModal } from './PlannerCalendarModal';

export interface PlanOutfitModalProps {
  visible: boolean;
  payload: PlanLaterPayload | null;
  authoritativeInventory?: { id: string }[] | Set<string> | Map<string, any>;
  onClose: () => void;
  onSuccess: (newPlan: PlannedOutfit) => void;
  onCollisionRefreshDate?: (dateStr: string) => void;
}

const SLOTS: PlannerSlot[] = ['all_day', 'day', 'evening', 'workout'];

export const PlanOutfitModal: React.FC<PlanOutfitModalProps> = ({
  visible,
  payload,
  authoritativeInventory,
  onClose,
  onSuccess,
  onCollisionRefreshDate,
}) => {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  const resolvedTz = resolveDeviceTimezone();
  const todayDateStr = React.useMemo(() => {
    try {
      return getTodayCalendarDate(resolvedTz || 'Asia/Manila');
    } catch {
      return '2026-09-24';
    }
  }, [resolvedTz]);

  const [selectedDate, setSelectedDate] = useState<string>(todayDateStr);
  const [selectedSlot, setSelectedSlot] = useState<PlannerSlot>('all_day');
  const [occasion, setOccasion] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState<boolean>(false);

  // Sync state on open
  useEffect(() => {
    if (visible && payload) {
      setSelectedDate(todayDateStr);
      setSelectedSlot('all_day');
      setOccasion(payload.occasion || '');
      setNotes('');
      setErrorMessage(null);
      setIsSubmitting(false);
    }
  }, [visible, payload, todayDateStr]);

  // Preflight availability check for Saved Outfits
  const preflightCheck = React.useMemo(() => {
    if (!payload || payload.sourceType !== 'saved_outfit' || !authoritativeInventory) {
      return { isValid: true, missingNames: [] as string[] };
    }

    const itemIds = payload.items.map((i) => i.id);
    const { isValid, missingIds } = validateSavedOutfitAvailability(
      itemIds,
      authoritativeInventory
    );

    if (isValid) return { isValid: true, missingNames: [] };

    const missingNames = payload.items
      .filter((i) => missingIds.includes(i.id))
      .map((i) => i.name);

    return { isValid: false, missingNames };
  }, [payload, authoritativeInventory]);

  if (!payload) return null;

  const tomorrowDateStr = addCalendarDays(todayDateStr, 1);
  const isTodaySelected = selectedDate === todayDateStr;
  const isTomorrowSelected = selectedDate === tomorrowDateStr;
  const dayDisplay = formatDayDisplay(selectedDate, todayDateStr);

  const handleSubmit = async () => {
    if (!preflightCheck.isValid) return;

    // Check timezone validity: do not silently persist UTC
    const planTimezone = resolvedTz || 'Asia/Manila';
    if (!resolvedTz) {
      // Prompt user or handle timezone requirement
      setErrorMessage('Please confirm your device timezone before planning an outfit.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await createPlannedOutfit({
      plannedDate: selectedDate,
      slot: selectedSlot,
      planTimezone,
      items: payload.items,
      occasion: occasion.trim() || undefined,
      notes: notes.trim() || undefined,
      savedOutfitId: payload.sourceType === 'saved_outfit' ? (payload.sourceRefId || undefined) : undefined,
      sourceType: payload.sourceType,
      sourceRefId: payload.sourceRefId || undefined,
    });

    setIsSubmitting(false);

    if (result.ok) {
      onSuccess(result.data);
      onClose();
    } else {
      const err = result.error;
      const rawMessage = (err?.message || '') + ((err?.cause as any)?.message || '');
      const errCode = err?.code;
      const causeCode = (err?.cause as any)?.code;

      if (
        errCode === 'P0004' ||
        errCode === '23505' ||
        causeCode === 'P0004' ||
        causeCode === '23505' ||
        rawMessage.includes('Slot collision') ||
        rawMessage.includes('already planned') ||
        rawMessage.includes('uq_planned_outfits_active')
      ) {
        if (onCollisionRefreshDate) {
          onCollisionRefreshDate(selectedDate);
        }
        setErrorMessage(
          'You already have an outfit planned for this time. Choose another time or day.'
        );
      } else {
        // Keep inputs intact, enable retry
        setErrorMessage('Unable to save your plan. Please check your connection and retry.');
      }
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.sheetCard, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View>
              <Text style={[styles.headerTitle, { color: theme.text }]}>Plan Outfit</Text>
              <Text style={[styles.headerSubtitle, { color: theme.secondaryText }]}>
                {payload.name || 'Schedule this look for an upcoming occasion'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close plan modal"
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={8}
            >
              <IconSymbol name="xmark" size={24} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView style={styles.contentScroll} showsVerticalScrollIndicator={false}>
            {/* Preflight Warning if pieces are unavailable */}
            {!preflightCheck.isValid && (
              <View testID="preflight-error-banner" style={[styles.warningBox, { backgroundColor: theme.glass, borderColor: theme.error }]}>
                <IconSymbol name="exclamationmark.circle" size={20} color={theme.error} style={{ marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.warningTitle, { color: theme.error }]}>
                    Missing Garments
                  </Text>
                  <Text style={[styles.warningBody, { color: theme.text }]}>
                    One or more pieces in this saved look are no longer in your wardrobe ({preflightCheck.missingNames.join(', ')}). Please edit the look before scheduling.
                  </Text>
                </View>
              </View>
            )}

            {/* Garments Preview Thumbnails */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.secondaryText }]}>LOOK PIECES</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.itemsRow}>
                {payload.items.map((item, idx) => (
                  <View key={`${item.id}-${idx}`} style={styles.itemThumb}>
                    <View style={[styles.itemImageWrapper, { backgroundColor: theme.card, borderColor: theme.border }]}>
                      {item.image_url ? (
                        <Image source={{ uri: item.image_url }} style={styles.itemImage} resizeMode="cover" />
                      ) : (
                        <IconSymbol name="tshirt" size={20} color={theme.icon} />
                      )}
                    </View>
                    <Text style={[styles.itemThumbName, { color: theme.text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>

            {/* Target Date Selector */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.secondaryText }]}>WHEN</Text>
              <View style={styles.datePillsRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Plan for Today"
                  accessibilityState={{ selected: isTodaySelected }}
                  onPress={() => setSelectedDate(todayDateStr)}
                  style={[
                    styles.pillButton,
                    isTodaySelected && [styles.pillActive, { backgroundColor: theme.tint }],
                    !isTodaySelected && { borderColor: theme.border },
                  ]}
                >
                  <Text style={[styles.pillText, { color: isTodaySelected ? theme.onTint : theme.text }]}>
                    Today
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Plan for Tomorrow"
                  accessibilityState={{ selected: isTomorrowSelected }}
                  onPress={() => setSelectedDate(tomorrowDateStr)}
                  style={[
                    styles.pillButton,
                    isTomorrowSelected && [styles.pillActive, { backgroundColor: theme.tint }],
                    !isTomorrowSelected && { borderColor: theme.border },
                  ]}
                >
                  <Text style={[styles.pillText, { color: isTomorrowSelected ? theme.onTint : theme.text }]}>
                    Tomorrow
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Pick specific date, currently ${dayDisplay.fullDate}`}
                  onPress={() => setIsDatePickerOpen(true)}
                  style={[
                    styles.pillButton,
                    !isTodaySelected && !isTomorrowSelected && [styles.pillActive, { backgroundColor: theme.tint }],
                    isTodaySelected || isTomorrowSelected ? { borderColor: theme.border } : null,
                  ]}
                >
                  <IconSymbol
                    name="calendar"
                    size={14}
                    color={!isTodaySelected && !isTomorrowSelected ? theme.onTint : theme.text}
                    style={{ marginRight: 4 }}
                  />
                  <Text
                    style={[
                      styles.pillText,
                      { color: !isTodaySelected && !isTomorrowSelected ? theme.onTint : theme.text },
                    ]}
                  >
                    {!isTodaySelected && !isTomorrowSelected ? `${dayDisplay.monthName} ${dayDisplay.dayNumber}` : 'Pick Date'}
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Slot Selector */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.secondaryText }]}>DAY PART</Text>
              <View style={styles.slotsGrid}>
                {SLOTS.map((slot) => {
                  const isSelected = selectedSlot === slot;
                  return (
                    <Pressable
                      key={slot}
                      accessibilityRole="button"
                      accessibilityLabel={`Slot: ${formatSlotLabel(slot)}`}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => setSelectedSlot(slot)}
                      style={[
                        styles.slotPill,
                        isSelected && [styles.slotPillActive, { backgroundColor: theme.tint }],
                        !isSelected && { borderColor: theme.border },
                      ]}
                    >
                      <Text style={[styles.slotPillText, { color: isSelected ? theme.onTint : theme.text }]}>
                        {formatSlotLabel(slot)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Occasion Input */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.secondaryText }]}>OCCASION (OPTIONAL)</Text>
              <TextInput
                style={[styles.textInput, { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border }]}
                placeholder="e.g. Gallery Opening, Board Meeting, Dinner"
                placeholderTextColor={theme.secondaryText}
                value={occasion}
                onChangeText={setOccasion}
                maxLength={60}
                accessibilityLabel="Occasion input"
              />
            </View>

            {/* Notes Input */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.secondaryText }]}>STYLING NOTES (OPTIONAL)</Text>
              <TextInput
                style={[
                  styles.textArea,
                  { backgroundColor: theme.surface, color: theme.text, borderColor: theme.border },
                ]}
                placeholder="e.g. Tuck in front, roll sleeves once, wear with amber jewelry"
                placeholderTextColor={theme.secondaryText}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                maxLength={250}
                accessibilityLabel="Styling notes input"
              />
            </View>

            {/* Error Message with Retry */}
            {errorMessage ? (
              <View testID="plan-error-banner" style={[styles.errorBox, { backgroundColor: theme.glass, borderColor: theme.error }]}>
                <IconSymbol name="info.circle.fill" size={18} color={theme.error} style={{ marginRight: 6 }} />
                <Text style={[styles.errorText, { color: theme.error }]}>{errorMessage}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Footer Submit Button */}
          <View style={[styles.footer, { borderTopColor: theme.hairline }]}>
            <Pressable
              testID="btn-confirm-plan"
              accessibilityRole="button"
              accessibilityLabel="Confirm and plan look"
              disabled={isSubmitting || !preflightCheck.isValid}
              onPress={handleSubmit}
              style={[
                styles.submitButton,
                { backgroundColor: theme.tint },
                (isSubmitting || !preflightCheck.isValid) && styles.disabledButton,
              ]}
            >
              {isSubmitting ? (
                <ActivityIndicator color={theme.onTint} />
              ) : (
                <Text style={[styles.submitButtonText, { color: theme.onTint }]}>
                  Schedule Look
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>

      <PlannerCalendarModal
        visible={isDatePickerOpen}
        selectedDate={selectedDate}
        todayDate={todayDateStr}
        onClose={() => setIsDatePickerOpen(false)}
        onSelectDate={(newDate) => {
          setSelectedDate(newDate);
          setIsDatePickerOpen(false);
        }}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    maxHeight: '90%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: 1,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  headerTitle: {
    ...Type.subtitle,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    ...Type.caption,
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentScroll: {
    paddingHorizontal: Spacing.lg,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  warningTitle: {
    ...Type.bodyStrong,
    fontSize: 13,
  },
  warningBody: {
    ...Type.caption,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionLabel: {
    ...Type.caption,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  itemsRow: {
    flexDirection: 'row',
  },
  itemThumb: {
    width: 64,
    marginRight: Spacing.sm,
    alignItems: 'center',
  },
  itemImageWrapper: {
    width: 64,
    height: 76,
    borderRadius: Radius.sm,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 4,
  },
  itemImage: {
    width: '100%',
    height: '100%',
  },
  itemThumbName: {
    ...Type.caption,
    fontSize: 10,
    textAlign: 'center',
    width: '100%',
  },
  datePillsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  pillButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: {
    borderWidth: 0,
  },
  pillText: {
    ...Type.caption,
    fontSize: 13,
    fontWeight: '600',
  },
  slotsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  slotPill: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotPillActive: {
    borderWidth: 0,
  },
  slotPillText: {
    ...Type.caption,
    fontSize: 13,
    fontWeight: '600',
  },
  textInput: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    ...Type.body,
    fontSize: 14,
  },
  textArea: {
    minHeight: 80,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    textAlignVertical: 'top',
    ...Type.body,
    fontSize: 14,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  errorText: {
    ...Type.caption,
    fontSize: 12,
    flex: 1,
  },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  submitButton: {
    minHeight: 48,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.5,
  },
  submitButtonText: {
    ...Type.bodyStrong,
    fontSize: 15,
  },
});
