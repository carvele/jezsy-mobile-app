import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Radius, Spacing, Type } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { TimeSlotPicker } from "@/src/components/TimeSlotPicker";
import { useAuth } from "@/src/context/AuthContext";
import { useCart } from "@/src/context/CartContext";
import { supabase } from "@/src/lib/supabase";
import { Database } from "@/src/types/database.types";
import { formatLocalDate } from "@/src/utils/dateTime";
import { scheduleReservationReminder } from "@/src/utils/pushNotifications";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
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

// One reservation can hold several products. Both entry points -- "Reserve
// now" on a product, and "Reserve all" from the bag -- normalise into this
// shape so the screen has a single rendering and submission path.
type ReservationLine = {
  key: string;
  product: Product;
  size?: string;
  color?: string;
  quantity: number;
};

// The bag reserves everything in it under one appointment, addressed as
// /reserve/cart rather than a product id.
const CART_ROUTE_ID = "cart";

export default function ReservationScreen() {
  const { showToast } = useToast();
  const { id, size, color, itemIds } = useLocalSearchParams<{
    id: string;
    size: string;
    color: string;
    itemIds: string;
  }>();
  const isCartMode = id === CART_ROUTE_ID;
  const { items: cartItems, clearCart } = useCart();
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
    // Cart mode already has its products in context; nothing to fetch.
    if (isCartMode) {
      setLoading(false);
      return;
    }

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
  }, [id, isCartMode]);

  const lines: ReservationLine[] = useMemo(() => {
    if (isCartMode) {
      // itemIds scopes this reservation to what the customer checked in the
      // bag; absent (or empty), fall back to the whole bag for compatibility
      // with any other caller of /reserve/cart.
      const selectedIds = itemIds ? new Set(itemIds.split(",")) : null;
      const scopedItems = selectedIds
        ? cartItems.filter((item) => selectedIds.has(item.id))
        : cartItems;
      return scopedItems.map((item) => ({
        key: item.id,
        product: item.product,
        size: item.selectedSize || undefined,
        color: item.selectedColor || undefined,
        quantity: item.quantity,
      }));
    }
    if (!product) return [];
    return [{
      key: product.id,
      product,
      size: size || undefined,
      color: color || undefined,
      quantity: 1,
    }];
  }, [isCartMode, cartItems, product, size, color, itemIds]);

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
    if (!session?.user || lines.length === 0) {
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

      // Every line's price and the resulting deposit are resolved
      // server-side from the products table; only the selection is sent.
      const { data, error } = await supabase.rpc("create_reservation_multi", {
        _items: lines.map((line) => ({
          product_id: line.product.id,
          size: line.size ?? null,
          color: line.color ?? null,
          quantity: line.quantity,
        })),
        _date: reservationDate,
        _appointment_time: appointmentTime,
        // Nothing is paid at this point, so there is never a receipt to
        // attach here.
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

      // The server re-resolves every price at submit time, so a sale ending
      // while this screen was open means the customer agreed to one figure and
      // the reservation records another. Say so rather than letting them find
      // out at the payment step.
      const serverTotal = Number((data as any)?.rental_price);
      const clientTotal = lines.reduce(
        (sum, line) =>
          sum +
          (line.product.on_sale && line.product.sale_price
            ? line.product.sale_price
            : line.product.price || 0) *
            line.quantity,
        0,
      );
      const priceChanged =
        Number.isFinite(serverTotal) && Math.abs(serverTotal - clientTotal) >= 0.01;

      // Only clear the bag once the reservation is actually on the server,
      // so a failed submit does not silently empty it.
      if (isCartMode) {
        await clearCart();
      }

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
        (priceChanged
          ? `Pricing for one or more items changed while you were booking. Your reservation total is ₱${serverTotal.toFixed(2)}.\n\n`
          : "") +
          "We will review your request shortly. Once it is accepted you will be notified to pay, and you will have up to 24 hours to do so (less if your appointment is coming up soon).",
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

  if (lines.length === 0) {
    return (
      <View
        style={[
          styles.loadingContainer,
          { backgroundColor: colors.background },
        ]}
      >
        <Text style={{ color: colors.text }}>
          {isCartMode ? "Your bag is empty." : "Product not found."}
        </Text>
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
  // Mirrors the server-side create_reservation_multi price resolution --
  // both must agree, or the deposit shown here would misrepresent what
  // actually gets charged. Per line: effective price x quantity.
  const linePrice = (line: ReservationLine) =>
    (line.product.on_sale && line.product.sale_price
      ? line.product.sale_price
      : (line.product.price || 0)) * line.quantity;
  const subtotal = lines.reduce((sum, line) => sum + linePrice(line), 0);
  const amountDueNow = payOption === 'full' ? subtotal : subtotal * 0.5;
  const balanceOnCollection = subtotal - amountDueNow;

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
        {lines.length > 1 && (
          <Text style={[styles.linesHeading, { color: colors.secondaryText }]}>
            {lines.length} items in this reservation
          </Text>
        )}

        {lines.map((line) => (
          <View
            key={line.key}
            style={[
              styles.summaryCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Image
              source={
                line.product.image_url
                  ? { uri: line.product.image_url }
                  : require("@/assets/images/partial-react-logo.png")
              }
              style={[styles.productImage, { backgroundColor: colors.imagePlaceholder }]}
              contentFit="cover"
            />
            <View style={styles.productInfo}>
              <Text style={[styles.productName, { color: colors.text }]}>
                {line.product.name}
              </Text>
              <Text
                style={[styles.productDetails, { color: colors.secondaryText }]}
              >
                Size: {line.size || "Standard"} • Color: {line.color || "Default"}
                {line.quantity > 1 ? ` • Qty ${line.quantity}` : ""}
              </Text>
              {line.product.on_sale && line.product.sale_price ? (
                <View style={styles.priceRow}>
                  <Text style={[styles.price, { color: colors.notification }]}>
                    ₱{linePrice(line).toFixed(2)}
                  </Text>
                  <Text style={[styles.originalPrice, { color: colors.secondaryText }]}>
                    ₱{((line.product.price || 0) * line.quantity).toFixed(2)}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.price, { color: colors.tint }]}>
                  ₱{linePrice(line).toFixed(2)}
                </Text>
              )}
            </View>
          </View>
        ))}

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
              {lines.length > 1 ? `Subtotal (${lines.length} items)` : "Item Price"}
            </Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>
              ₱{subtotal.toFixed(2)}
            </Text>
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  backButton: { padding: Spacing.xs },
  headerTitle: { ...Type.subtitle },
  content: { padding: Spacing.xxl, paddingBottom: 60 },
  summaryCard: {
    flexDirection: "row",
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: Spacing.xxxl,
  },
  productImage: { width: 100, height: 120 },
  productInfo: { flex: 1, padding: Spacing.lg, justifyContent: "center" },
  productName: { fontSize: 16, fontWeight: "700", marginBottom: Spacing.xs },
  productDetails: { ...Type.body, marginBottom: Spacing.sm },
  price: { fontSize: 16, fontWeight: "800" },
  priceRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  originalPrice: { fontSize: 13, textDecorationLine: "line-through" },
  linesHeading: { fontSize: 13, fontWeight: "600", marginBottom: 10 },
  section: { marginBottom: Spacing.xxxl },
  sectionTitle: { ...Type.subtitle, marginBottom: Spacing.md },
  dateScroll: { flexDirection: "row" },
  dateBox: {
    width: 64,
    height: 72,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: Spacing.md,
  },
  dayName: { fontSize: 12, marginBottom: Spacing.xs },
  dateNum: { fontSize: 18, fontWeight: "700" },
  breakdownCard: {
    padding: Spacing.xl,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginBottom: Spacing.xl,
  },
  paymentNote: { fontSize: 13, marginBottom: Spacing.xl, lineHeight: 18 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: Spacing.md,
  },
  // Not Type.bodyStrong, even though 15/600 matches it exactly. Only rowValue
  // matches -- rowText is 15/400, which the scale has no slot for -- so
  // converting one would give the label and its amount different line heights
  // in the same row and pull the deposit/total/balance figures out of line.
  rowText: { fontSize: 15, flexShrink: 1 },
  rowValue: { fontSize: 15, fontWeight: "600" },
  payMethodRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  payMethodChip: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: "center",
  },
  payMethodText: { fontSize: 13, fontWeight: "700" },
  receiptStatus: {
    flexDirection: 'row',
    // flex-start, not centre: the text wraps to two lines, and centring it
    // against a 16pt icon floats the icon into the gap between them.
    alignItems: 'flex-start',
    gap: 6,
    marginTop: Spacing.sm,
  },
  receiptStatusText: {
    fontSize: 13,
    fontWeight: '600',
    // Without this the Text takes its intrinsic width inside the row and runs
    // past the card's padding instead of wrapping into the space left beside
    // the icon.
    flex: 1,
  },
  bottomBar: { padding: Spacing.xxl, borderTopWidth: 1 },
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
  primaryActionText: { fontSize: 16, fontWeight: "700" },
});
