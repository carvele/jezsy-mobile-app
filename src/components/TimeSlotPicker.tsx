import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { supabase } from "@/src/lib/supabase";
import {
    formatLocalDate,
    formatTimeLabel,
    formatTimeValue,
    toStoreTimeValue,
} from "@/src/utils/dateTime";
import { IconSymbol } from "@/components/ui/icon-symbol";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Modal,
    Platform,
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
      const dateStr = formatLocalDate(selectedDate);
      const dayOfWeek = selectedDate.getDay();

      // Fetch standard hours
      const { data: hoursData, error: hoursError } = await supabase
        .from("store_hours")
        .select("*")
        .eq("day_of_week", dayOfWeek)
        .single();

      if (hoursError && hoursError.code !== "PGRST116") {
        throw hoursError;
      }

      // Fetch closures/custom hours
      const { data: closureData, error: closureError } = await supabase
        .from("store_closures")
        .select("*")
        .eq("closure_date", dateStr)
        .single();

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

      const { data: reservations, error: resError } = await supabase
        .from("reservations")
        .select("appointment_time, status, deleted")
        .eq("date", dateStr)
        .or("deleted.is.false,status.not.eq.Cancelled")
        .neq("status", "Completed");

      if (resError) throw resError;

      // Group reservations by time
      const bookedCounts: Record<string, number> = {};
      if (reservations) {
        reservations.forEach((r) => {
          const status = (r.status || "Pending").toLowerCase();
          const isActive =
            !r.deleted && status !== "cancelled" && status !== "completed";
          // Stored as timestamptz; key by wall clock so it matches the slots below.
          const slotValue = toStoreTimeValue(r.appointment_time);
          if (slotValue && isActive) {
            bookedCounts[slotValue] = (bookedCounts[slotValue] || 0) + 1;
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

      while (current < end) {
        const timeValue = formatTimeValue(current);
        const timeLabel = formatTimeLabel(timeValue);

        // Ensure it's not in the past
        const isPast = current < now;
        const count = bookedCounts[timeValue] || 0;
        const isAvailable = !isPast && count < slotCapacity && !dayIsFull;

        generatedSlots.push({
          value: timeValue,
          label: timeLabel,
          isAvailable,
          reason: isPast
            ? "Past time"
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
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
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
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  triggerText: { flex: 1, fontSize: 15, fontWeight: "600" },
  availabilityHint: { fontSize: 12, marginTop: 8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: Platform.OS === "ios" ? 40 : 20,
    maxHeight: "70%",
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sheetTitle: { fontSize: 18, fontWeight: "700" },
  sheetClose: { fontSize: 15, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 15, fontWeight: "600" },
  rowReason: { fontSize: 12 },
  closedContainer: {
    padding: 20,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  closedText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
