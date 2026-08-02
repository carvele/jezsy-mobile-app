import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { TimeSlotPicker } from "@/src/components/TimeSlotPicker";
import { useAuth } from "@/src/context/AuthContext";
import { supabase } from "@/src/lib/supabase";
import { Database } from "@/src/types/database.types";
import { formatLocalDate } from "@/src/utils/dateTime";
import { scheduleReservationReminder } from "@/src/utils/pushNotifications";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useToast } from '@/src/context/ToastContext';

type Product = Database["public"]["Tables"]["products"]["Row"];

export default function ReservationScreen() {
  const { showToast } = useToast();
  const { id, size, color } = useLocalSearchParams<{
    id: string;
    size: string;
    color: string;
  }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Date and Time selection
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [appointmentTime, setAppointmentTime] = useState<string | undefined>();
  // Opening on today is wrong whenever today is unbookable -- past closing, or
  // a day the boutique is shut. That left the picker disabled and Confirm dead
  // with nothing on screen saying to try another date. Skip ahead until a date
  // has slots, and stop the moment the customer picks a date themselves.
  const [autoAdvanceDate, setAutoAdvanceDate] = useState(true);

  const handleAvailabilityResolved = useCallback(
    (hasAvailable: boolean) => {
      if (hasAvailable || !autoAdvanceDate) return;
      setSelectedDate((prev) => {
        const next = new Date(prev);
        next.setDate(next.getDate() + 1);
        // Stay inside the 14-day window the date strip offers.
        const lastOffered = new Date();
        lastOffered.setDate(lastOffered.getDate() + 13);
        lastOffered.setHours(23, 59, 59, 999);
        return next > lastOffered ? prev : next;
      });
    },
    [autoAdvanceDate],
  );

  const selectDate = useCallback((d: Date) => {
    setAutoAdvanceDate(false);
    setSelectedDate(d);
    setAppointmentTime(undefined); // Reset time when date changes
  }, []);

  // Which payment plan the customer is committing to. The figure is never sent
  // to the server -- only the choice -- so the amount stays resolved from the
  // product row. Paying itself happens later, once staff accept.
  const [payOption, setPayOption] = useState<'deposit' | 'full'>('deposit');

  const router = useRouter();
  const theme = useColorScheme() ?? "dark";
  const colors = Colors[theme];
  const { session } = useAuth();

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const { data, error } = await supabase
          .from("products")
          .select("*")
          .eq("id", id)
          .single();

        if (error) throw error;
        setProduct(data);
      } catch (err) {
        console.error("Error fetching product for reservation:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [id]);

  const generateDates = () => {
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dates.push(d);
    }
    return dates;
  };

  const handleReserve = async () => {
    if (!session?.user || !product) {
      showToast("You must be logged in to make a reservation.", 'error');
      return;
    }

    if (!appointmentTime) {
      showToast("Please select a valid appointment time.", 'info');
      return;
    }

    setSubmitting(true);
    try {
      const reservationDate = formatLocalDate(selectedDate);

      // Price and deposit are computed server-side by create_reservation
      // from the current product price, not trusted from the client.
      const { data, error } = await supabase.rpc("create_reservation", {
        _product_id: product.id,
        _size: size,
        _color: color,
        _quantity: 1,
        _date: reservationDate,
        _appointment_time: appointmentTime,
        // Nothing is paid at this point, so there is never a receipt to
        // attach here. Cast: the DB signature is `text`, but the generated
        // type is not nullable -- Postgres has no notion of a non-null arg.
        _receipt_path: null as unknown as string,
        _payment_option: payOption,
      });

      if (error) {
        if (
          error.message.includes("fully booked") ||
          error.message.includes("closed")
        ) {
          throw new Error(error.message);
        }
        throw error;
      }

      const displayId = (data as any)?.display_id;

      await scheduleReservationReminder(
        displayId,
        reservationDate,
        appointmentTime,
      );

      // No payment here by design: staff vet the booking first, and only then
      // does a payment window open. Taking money before acceptance would mean
      // refunding through PayMongo every time staff turn a booking down.
      Alert.alert(
        "Request sent",
        "We will review your request shortly. Once it is accepted you will be notified to pay, and you will have 24 hours to do so.",
        [{ text: "OK", onPress: () => router.replace("/reservations") }],
      );
    } catch (error: any) {
      console.error("Reservation error:", error);
      showToast(error.message || "Failed to submit reservation. Please try again.", 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = !!appointmentTime && !submitting;

  if (loading) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  if (!product) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <Text style={{ color: colors.text }}>Product not found.</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginTop: 20 }}
        >
          <Text style={{ color: colors.tint }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const days = generateDates();
  // Mirrors the server-side create_reservation RPC's price resolution --
  // both must agree, or the deposit shown here would misrepresent what
  // actually gets charged.
  const effectivePrice = product.on_sale && product.sale_price ? product.sale_price : (product.price || 0);
  const amountDueNow = payOption === 'full' ? effectivePrice : effectivePrice * 0.5;
  const balanceOnCollection = effectivePrice - amountDueNow;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Reservation
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.summaryCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Image
            source={
              product.image_url
                ? { uri: product.image_url }
                : require("@/assets/images/partial-react-logo.png")
            }
            style={[styles.productImage, { backgroundColor: colors.imagePlaceholder }]}
            contentFit="cover"
          />
          <View style={styles.productInfo}>
            <Text style={[styles.productName, { color: colors.text }]}>
              {product.name}
            </Text>
            <Text
              style={[styles.productDetails, { color: colors.secondaryText }]}
            >
              Size: {size || "Standard"} • Color: {color || "Default"}
            </Text>
            {product.on_sale && product.sale_price ? (
              <View style={styles.priceRow}>
                <Text style={[styles.price, { color: colors.notification }]}>
                  ₱{effectivePrice.toFixed(2)}
                </Text>
                <Text style={[styles.originalPrice, { color: colors.secondaryText }]}>
                  ₱{(product.price || 0).toFixed(2)}
                </Text>
              </View>
            ) : (
              <Text style={[styles.price, { color: colors.tint }]}>
                ₱{effectivePrice.toFixed(2)}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Select Date
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.dateScroll}
          >
            {days.map((d, index) => {
              const isSelected =
                d.toDateString() === selectedDate.toDateString();
              const dayName = d.toLocaleDateString("en-US", {
                weekday: "short",
              });
              const dateNum = d.getDate();
              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.dateBox,
                    { borderColor: isSelected ? colors.tint : colors.border },
                    isSelected && { backgroundColor: colors.card },
                  ]}
                  onPress={() => selectDate(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`${dayName} ${dateNum}`}
                  accessibilityHint={isSelected ? 'Currently selected date' : 'Select this date for your reservation'}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      styles.dayName,
                      {
                        color: isSelected ? colors.tint : colors.secondaryText,
                      },
                    ]}
                  >
                    {dayName}
                  </Text>
                  <Text
                    style={[
                      styles.dateNum,
                      { color: isSelected ? colors.tint : colors.text },
                    ]}
                  >
                    {dateNum}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Pickup Time
          </Text>
          <TimeSlotPicker
            selectedDate={selectedDate}
            selectedSlot={appointmentTime}
            onSelectSlot={setAppointmentTime}
            onAvailabilityResolved={handleAvailabilityResolved}
          />
        </View>

        <View
          style={[
            styles.breakdownCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Payment Info
          </Text>
          <Text style={[styles.paymentNote, { color: colors.secondaryText }]}>
            {payOption === 'full'
              ? 'You have chosen to pay the full price. Nothing is left to settle at pickup.'
              : 'A reservation fee of 50% secures this booking. You settle the balance when you collect the item.'}
          </Text>

          <View style={styles.payMethodRow}>
            {([
              { key: 'deposit', label: 'Pay 50% now' },
              { key: 'full', label: 'Pay in full' },
            ] as const).map((option) => {
              const isSelected = payOption === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.payMethodChip,
                    { borderColor: isSelected ? colors.tint : colors.border },
                    isSelected && { backgroundColor: colors.card },
                  ]}
                  onPress={() => setPayOption(option.key)}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: isSelected, checked: isSelected }}
                >
                  <Text
                    style={[
                      styles.payMethodText,
                      { color: isSelected ? colors.tint : colors.secondaryText },
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.row}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>
              Item Price
            </Text>
            {product.on_sale && product.sale_price ? (
              <View style={styles.priceRow}>
                <Text style={[styles.rowValue, { color: colors.notification }]}>
                  ₱{effectivePrice.toFixed(2)}
                </Text>
                <Text style={[styles.originalPriceSmall, { color: colors.secondaryText }]}>
                  ₱{(product.price || 0).toFixed(2)}
                </Text>
              </View>
            ) : (
              <Text style={[styles.rowValue, { color: colors.text }]}>
                ₱{effectivePrice.toFixed(2)}
              </Text>
            )}
          </View>

          <View style={styles.row}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>
              {payOption === 'full' ? 'To pay once accepted (full)' : 'To pay once accepted (50%)'}
            </Text>
            <Text style={[styles.rowValue, { color: colors.tint }]}>
              ₱{amountDueNow.toFixed(2)}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>
              Balance on collection
            </Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>
              ₱{balanceOnCollection.toFixed(2)}
            </Text>
          </View>

          <View style={styles.receiptStatus}>
            <IconSymbol name="checkmark.circle.fill" size={16} color={colors.tint} />
            <Text style={[styles.receiptStatusText, { color: colors.secondaryText }]}>
              Nothing is charged now. You pay once we accept your request.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          { backgroundColor: colors.background, borderTopColor: colors.border },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.primaryAction,
            { backgroundColor: canSubmit ? colors.tint : colors.border },
          ]}
          onPress={handleReserve}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityLabel="Send reservation request"
          accessibilityHint={
            !appointmentTime
              ? 'Select a pickup time to enable'
              : 'Sends your reservation request for review. Nothing is charged now.'
          }
          accessibilityState={{ disabled: !canSubmit }}
        >
          {submitting ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.primaryActionText}>Request Reservation</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  content: { padding: 24, paddingBottom: 60 },
  summaryCard: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 32,
  },
  productImage: { width: 100, height: 120 },
  productInfo: { flex: 1, padding: 16, justifyContent: "center" },
  productName: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  productDetails: { fontSize: 14, marginBottom: 8 },
  price: { fontSize: 16, fontWeight: "800" },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  originalPrice: { fontSize: 13, textDecorationLine: "line-through" },
  originalPriceSmall: { fontSize: 12, textDecorationLine: "line-through" },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  dateScroll: { flexDirection: "row" },
  dateBox: {
    width: 64,
    height: 72,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  dayName: { fontSize: 12, marginBottom: 4 },
  dateNum: { fontSize: 18, fontWeight: "700" },
  breakdownCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  paymentNote: { fontSize: 13, marginBottom: 20, lineHeight: 18 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  rowText: { fontSize: 15 },
  rowValue: { fontSize: 15, fontWeight: "600" },
  uploadButton: {
    marginTop: 20,
    width: "100%",
    height: 120,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  payMethodRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  payMethodChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  payMethodText: { fontSize: 13, fontWeight: "700" },
  uploadPlaceholder: { alignItems: "center" },
  uploadText: { marginTop: 8, fontSize: 14, fontWeight: "500" },
  receiptPreview: { width: "100%", height: "100%" },
  receiptStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  receiptStatusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  bottomBar: { padding: 24, borderTopWidth: 1 },
  primaryAction: {
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#C9A96E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  primaryActionText: { color: "#0D0D0D", fontSize: 16, fontWeight: "700" },
});
