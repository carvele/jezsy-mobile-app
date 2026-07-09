import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { supabase } from "@/src/lib/supabase";
import {
    formatLocalDate,
    formatTimeLabel,
    formatTimeValue,
} from "@/src/utils/dateTime";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";

const SLOT_CAPACITY = 3;

interface TimeSlotPickerProps {
  selectedDate: Date;
  onSelectSlot: (time: string) => void;
  selectedSlot?: string;
}

export function TimeSlotPicker({
  selectedDate,
  onSelectSlot,
  selectedSlot,
}: TimeSlotPickerProps) {
  const theme = useColorScheme() ?? "dark";
  const colors = Colors[theme];

  const [loading, setLoading] = useState(false);
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
      let openTime = "10:00:00";
      let closeTime = "20:00:00";
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

      if (!isOpen) {
        setSlots([
          {
            value: "closed",
            label: "Closed",
            isAvailable: false,
            reason: closedReason,
          },
        ]);
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
          if (r.appointment_time && isActive) {
            bookedCounts[r.appointment_time] =
              (bookedCounts[r.appointment_time] || 0) + 1;
          }
        });
      }

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
        const isAvailable = !isPast && count < SLOT_CAPACITY;

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
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

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

  return (
    <View style={styles.grid}>
      {slots.map((slot) => {
        const isSelected = selectedSlot === slot.value;
        return (
          <TouchableOpacity
            key={slot.value}
            disabled={!slot.isAvailable}
            style={[
              styles.button,
              {
                borderColor: isSelected ? colors.tint : colors.border,
                backgroundColor: isSelected ? colors.card : "transparent",
                opacity: slot.isAvailable ? 1 : 0.4,
              },
            ]}
            onPress={() => onSelectSlot(slot.value)}
          >
            <Text
              style={[
                styles.text,
                {
                  color: isSelected ? colors.tint : colors.text,
                  textDecorationLine: slot.isAvailable
                    ? "none"
                    : "line-through",
                },
              ]}
            >
              {slot.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  button: {
    width: "48%",
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  text: {
    fontSize: 14,
    fontWeight: "600",
  },
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
