import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from "@/hooks/use-color-scheme";
import { supabase } from "@/src/lib/supabase";
import {
    formatManilaDate,
    formatTimeLabel,
    formatTimeValue,
    manilaDayOfWeek,
    toStoreTimeValue,
} from "@/src/utils/dateTime";
import { IconSymbol } from "@/components/ui/icon-symbol";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

// Only a fallback for a weekday with no store_hours row. The real number is
// store_hours.slot_capacity, which assert_bookable_slot reads too -- this used
// to be a second hardcoded 3, so changing the server's cap would have left the
// picker offering slots the server then refused.
const DEFAULT_SLOT_CAPACITY = 3;

// A slot must be at least this far in the future to be bookable at all --
// not just "not already past". Booking a slot minutes away used to be
// allowed, and by the time checkout completed the resulting payment_due_at
// (computed server-side as appointment - 1h, floored at 2h from now) could
// already be behind "now": a reservation created dead-on-arrival, holding
// stock until the expiry cron eventually cancelled it. This value is tied
// to that server-side floor -- see create_reservation_multi and
// resolve_reschedule, both of which reserve a 2h payment window plus a 30
// min buffer before pickup, hence 150 minutes here.
const MIN_LEAD_TIME_MINUTES = 150;

interface TimeSlotPickerProps {
  selectedDate: Date;
  onSelectSlot: (time: string) => void;
  selectedSlot?: string;
  /** Fires once per resolved date so the caller can skip unbookable days. */
  onAvailabilityResolved?: (hasAvailable: boolean) => void;
}

export function TimeSlotPicker({
  selectedDate,
  onSelectSlot,
  selectedSlot,
  onAvailabilityResolved,
}: TimeSlotPickerProps) {
  const theme = useColorScheme() ?? "dark";
  const colors = Colors[theme];

  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [slots, setSlots] = useState<
    { value: string; label: string; isAvailable: boolean; reason?: string }[]
  >([]);

  const fetchSlots = useCallback(async () => {
    setLoading(true);
    try {
      // Anchored to Asia/Manila, not the device's own calendar day/weekday --
      // store_hours.day_of_week and assert_bookable_slot on the server both
      // mean Manila's day. A device set to a different timezone previously
      // could disagree with the server about which weekday "today" even is.
      const dateStr = formatManilaDate(selectedDate);
      const dayOfWeek = manilaDayOfWeek(selectedDate);

      // Fetch standard hours
      const { data: hoursData, error: hoursError } = await supabase
        .from("store_hours")
        .select("*")
        .eq("day_of_week", dayOfWeek)
        .maybeSingle();

      if (hoursError && hoursError.code !== "PGRST116") {
        throw hoursError;
      }

      // Fetch closures/custom hours
      const { data: closureData, error: closureError } = await supabase
        .from("store_closures")
        .select("*")
        .eq("closure_date", dateStr)
        .maybeSingle();

      if (closureError && closureError.code !== "PGRST116") {
        throw closureError;
      }

      let isOpen = true;
      // Both read from store_hours below. assert_bookable_slot reads the same
      // row, so the picker and the server agree without either restating the
      // number.
      let slotCapacity = DEFAULT_SLOT_CAPACITY;
      let maxDailyBookings: number | null = null;
      let openTime = "10:00:00";
      // Fallback only, for a day with no store_hours row. Kept in step with the
      // table, which closes at 17:00 -- validate_reservation_time is the real
      // gate, so a wider default here would just offer slots the DB rejects.
      let closeTime = "17:00:00";
      let closedReason = "Boutique is closed";

      if (closureData) {
        if (closureData.is_fully_closed) {
          isOpen = false;
          closedReason = closureData.reason || "Closed for Holiday";
        } else {
          openTime = closureData.custom_open_time || openTime;
          closeTime = closureData.custom_close_time || closeTime;
        }
      } else if (hoursData) {
        if (hoursData.is_closed) {
          isOpen = false;
          closedReason = "Usually closed on this day";
        } else {
          openTime = hoursData.open_time;
          closeTime = hoursData.close_time;
        }
      }

      // Capacity comes from the weekday row even on a date with a custom
      // closure: a closure changes the hours, not how many people can be seen
      // in one slot.
      if (hoursData) {
        slotCapacity = hoursData.slot_capacity ?? DEFAULT_SLOT_CAPACITY;
        maxDailyBookings = hoursData.max_daily_bookings ?? null;
      }

      if (!isOpen) {
        setSlots([
          {
            value: "closed",
            label: "Closed",
            isAvailable: false,
            reason: closedReason,
          },
        ]);
        onAvailabilityResolved?.(false);
        setLoading(false);
        return;
      }

      // Fetch slot booking counts from the authoritative server aggregate RPC.
      // A raw reservations table query is constrained by customer RLS to
      // customer_id = auth.uid(), which hides bookings made by other customers
      // and causes fully booked slots to appear vacant. get_slot_booked_counts
      // is a SECURITY DEFINER function returning global booking counts per slot.
      const { data: slotCounts, error: slotCountsError } = await supabase
        .rpc("get_slot_booked_counts", { _date: dateStr });

      if (slotCountsError) throw slotCountsError;

      // Group booking counts by normalised time value
      const bookedCounts: Record<string, number> = {};
      if (slotCounts) {
        slotCounts.forEach((item) => {
          const slotValue = toStoreTimeValue(item.slot_time);
          if (slotValue) {
            bookedCounts[slotValue] = item.booked_count;
          }
        });
      }

      // A day at its ceiling has no bookable slots left, whatever the per-slot
      // count says.
      const bookedToday = Object.values(bookedCounts).reduce((sum, n) => sum + n, 0);
      const dayIsFull = maxDailyBookings !== null && bookedToday >= maxDailyBookings;

      // Generate 30 min slots
      const generatedSlots = [];
      const [openH, openM] = openTime.split(":").map(Number);
      const [closeH, closeM] = closeTime.split(":").map(Number);

      let current = new Date(selectedDate);
      current.setHours(openH, openM, 0, 0);

      const end = new Date(selectedDate);
      end.setHours(closeH, closeM, 0, 0);

      const now = new Date();
      const minBookableAt = new Date(now.getTime() + MIN_LEAD_TIME_MINUTES * 60000);

      while (current < end) {
        const timeValue = formatTimeValue(current);
        const timeLabel = formatTimeLabel(timeValue);

        const isPast = current < now;
        // Distinct from isPast: this slot hasn't happened yet, but it's too
        // close to "now" to leave a workable payment window once checkout
        // finishes.
        const isTooSoon = !isPast && current < minBookableAt;
        const count = bookedCounts[timeValue] || 0;
        const isAvailable = !isPast && !isTooSoon && count < slotCapacity && !dayIsFull;

        generatedSlots.push({
          value: timeValue,
          label: timeLabel,
          isAvailable,
          reason: isPast
            ? "Past time"
            : isTooSoon
              ? "Too soon to book"
              : !isAvailable
                ? "Fully booked"
                : undefined,
        });

        // Add 30 mins
        current.setMinutes(current.getMinutes() + 30);
      }

      setSlots(generatedSlots);
      onAvailabilityResolved?.(generatedSlots.some((s) => s.isAvailable));
    } catch (error) {
      console.error("Error fetching time slots:", error);
      setSlots([
        {
          value: "error",
          label: "Error",
          isAvailable: false,
          reason: "Failed to load schedule",
        },
      ]);
      // A failed load is not an empty day; advancing the date would hide the error.
      onAvailabilityResolved?.(true);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, onAvailabilityResolved]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.tint} />
      </View>
    );
  }

  if (
    slots.length === 1 &&
    !slots[0].isAvailable &&
    slots[0].value === "closed"
  ) {
    return (
      <View
        style={[
          styles.closedContainer,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.closedText, { color: colors.text }]}>
          {slots[0].reason}
        </Text>
      </View>
    );
  }

  const selectedLabel = slots.find((s) => s.value === selectedSlot)?.label;
  const availableCount = slots.filter((s) => s.isAvailable).length;

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, { borderColor: colors.border, backgroundColor: colors.card }]}
        onPress={() => setPickerOpen(true)}
        disabled={availableCount === 0}
        accessibilityRole="button"
        accessibilityLabel={selectedLabel ? `Appointment time, ${selectedLabel}` : 'Select an appointment time'}
        accessibilityHint={
          availableCount === 0
            ? 'No times are available on this date'
            : 'Opens the list of available times'
        }
        accessibilityState={{ disabled: availableCount === 0 }}
      >
        <IconSymbol name="calendar" size={18} color={colors.tint} />
        <Text
          style={[
            styles.triggerText,
            { color: selectedLabel ? colors.text : colors.secondaryText },
          ]}
        >
          {availableCount === 0
            ? 'No times left on this date'
            : selectedLabel ?? 'Select a time'}
        </Text>
        <IconSymbol name="chevron.down" size={18} color={colors.secondaryText} />
      </TouchableOpacity>

      {availableCount > 0 && (
        <Text style={[styles.availabilityHint, { color: colors.secondaryText }]}>
          {availableCount} {availableCount === 1 ? 'time' : 'times'} available
        </Text>
      )}

      {/* A sheet rather than the old always-open grid: at 30-minute intervals
          the grid was a dozen-plus buttons pushing the rest of the form off
          screen. */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setPickerOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close time picker"
        >
          <TouchableOpacity style={[styles.sheet, { backgroundColor: colors.card }]} activeOpacity={1}>
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>Pick a time</Text>
              <TouchableOpacity
                onPress={() => setPickerOpen(false)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Text style={[styles.sheetClose, { color: colors.tint }]}>Done</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {slots.map((slot) => {
                const isSelected = selectedSlot === slot.value;
                return (
                  <TouchableOpacity
                    key={slot.value}
                    disabled={!slot.isAvailable}
                    style={[
                      styles.row,
                      { borderBottomColor: colors.border },
                      isSelected && { backgroundColor: colors.background },
                    ]}
                    onPress={() => {
                      onSelectSlot(slot.value);
                      setPickerOpen(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityLabel={slot.label}
                    accessibilityHint={slot.isAvailable ? 'Select this time slot' : slot.reason}
                    accessibilityState={{ selected: isSelected, disabled: !slot.isAvailable }}
                  >
                    <Text
                      style={[
                        styles.rowLabel,
                        {
                          color: slot.isAvailable ? colors.text : colors.secondaryText,
                          textDecorationLine: slot.isAvailable ? 'none' : 'line-through',
                        },
                      ]}
                    >
                      {slot.label}
                    </Text>
                    {slot.isAvailable ? (
                      isSelected ? (
                        <IconSymbol name="checkmark.circle.fill" size={20} color={colors.tint} />
                      ) : null
                    ) : (
                      <Text style={[styles.rowReason, { color: colors.secondaryText }]}>
                        {slot.reason}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    padding: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    height: 52,
    paddingHorizontal: Spacing.lg,
    borderRadius: 12,
    borderWidth: 1,
  },
  triggerText: { flex: 1, ...Type.bodyStrong },
  availabilityHint: { fontSize: 12, marginTop: Spacing.sm },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Platform.OS === "ios" ? 40 : 20,
    maxHeight: "70%",
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  sheetTitle: { ...Type.subtitle },
  sheetClose: { fontSize: 15, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.sm,
    borderRadius: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { ...Type.bodyStrong },
  rowReason: { fontSize: 12 },
  closedContainer: {
    padding: Spacing.xl,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  closedText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
