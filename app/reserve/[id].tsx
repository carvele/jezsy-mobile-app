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
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
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

type Product = Database["public"]["Tables"]["products"]["Row"];

export default function ReservationScreen() {
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

  // Payment Receipt
  const [receiptUri, setReceiptUri] = useState<string | null>(null);

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

  const pickReceipt = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setReceiptUri(result.assets[0].uri);
    }
  };

  const uploadReceipt = async (uri: string): Promise<string> => {
    const userId = session?.user?.id;
    if (!userId) throw new Error("User not authenticated");

    const ext = uri.includes(".")
      ? uri.substring(uri.lastIndexOf(".") + 1).split("?")[0]
      : "jpg";
    const fileName = `${userId}/${Date.now()}.${ext}`;

    const formData = new FormData();
    formData.append('file', {
      uri: uri,
      name: fileName.split('/').pop() || `photo.${ext}`,
      type: `image/${ext}`,
    } as any);

    const { data, error } = await supabase.storage
      .from("payment_receipts")
      .upload(fileName, formData, { upsert: false, contentType: `image/${ext}` });

    if (error) throw error;

    return data.path;
  };

  const handleReserve = async () => {
    if (!session?.user || !product) {
      Alert.alert("Error", "You must be logged in to make a reservation.");
      return;
    }

    if (!appointmentTime) {
      Alert.alert("Incomplete", "Please select a valid appointment time.");
      return;
    }

    if (!receiptUri) {
      Alert.alert(
        "Incomplete",
        "Please upload proof of downpayment (at least 50% of the rental fee).",
      );
      return;
    }

    setSubmitting(true);
    try {
      // Upload receipt first
      const receiptPath = await uploadReceipt(receiptUri);
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
        _receipt_path: receiptPath,
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

      Alert.alert(
        "Success",
        "Reservation requested successfully! Our team will verify your payment.",
        [{ text: "OK", onPress: () => router.replace("/(tabs)") }],
      );
    } catch (error: any) {
      console.error("Reservation error:", error);
      Alert.alert(
        "Reservation Failed",
        error.message || "Failed to submit reservation. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

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
  const depositRequired = (product.price || 0) * 0.5;

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
            source={{
              uri: product.image_url || "https://via.placeholder.com/150",
            }}
            style={styles.productImage}
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
            <Text style={[styles.price, { color: colors.tint }]}>
              ₱{(product.price || 0).toFixed(2)}
            </Text>
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
                  onPress={() => {
                    setSelectedDate(d);
                    setAppointmentTime(undefined); // Reset time when date changes
                  }}
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
            A minimum deposit of 50% is required to secure this reservation.
          </Text>

          <View style={styles.row}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>
              Rental Fee
            </Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>
              ₱{(product.price || 0).toFixed(2)}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={[styles.rowText, { color: colors.secondaryText }]}>
              Required Deposit (50%)
            </Text>
            <Text style={[styles.rowValue, { color: colors.tint }]}>
              ₱{depositRequired.toFixed(2)}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.uploadButton,
              { borderColor: receiptUri ? colors.tint : colors.border },
            ]}
            onPress={pickReceipt}
            accessibilityRole="button"
            accessibilityLabel={receiptUri ? 'Change payment receipt' : 'Upload payment receipt'}
            accessibilityHint={receiptUri ? 'Tap to replace the uploaded receipt image' : 'Opens your photo library to select a receipt image'}
          >
            {receiptUri ? (
              <Image
                source={{ uri: receiptUri }}
                style={styles.receiptPreview}
                contentFit="cover"
              />
            ) : (
              <View style={styles.uploadPlaceholder}>
                <IconSymbol
                  name="camera"
                  size={32}
                  color={colors.secondaryText}
                />
                <Text
                  style={[styles.uploadText, { color: colors.secondaryText }]}
                >
                  Upload Payment Receipt
                </Text>
              </View>
            )}
          </TouchableOpacity>
          {receiptUri ? (
            <View style={styles.receiptStatus}>
              <IconSymbol name="checkmark.circle.fill" size={16} color="#06D6A0" />
              <Text style={[styles.receiptStatusText, { color: '#06D6A0' }]}>Receipt uploaded</Text>
            </View>
          ) : (
            <View style={styles.receiptStatus}>
              <IconSymbol name="exclamationmark.circle" size={16} color="#FFB703" />
              <Text style={[styles.receiptStatusText, { color: '#FFB703' }]}>Receipt required to confirm reservation</Text>
            </View>
          )}
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
            {
              backgroundColor:
                !appointmentTime || !receiptUri || submitting
                  ? colors.border
                  : colors.tint,
            },
          ]}
          onPress={handleReserve}
          disabled={!appointmentTime || !receiptUri || submitting}
          accessibilityRole="button"
          accessibilityLabel="Confirm Reservation"
          accessibilityHint={
            !appointmentTime && !receiptUri
              ? 'Select a pickup time and upload a receipt to enable'
              : !appointmentTime
                ? 'Select a pickup time to enable'
                : !receiptUri
                  ? 'Upload a payment receipt to enable'
                  : 'Submits your reservation request'
          }
          accessibilityState={{ disabled: !appointmentTime || !receiptUri || submitting }}
        >
          {submitting ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.primaryActionText}>Confirm Reservation</Text>
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
  productImage: { width: 100, height: 120, backgroundColor: "#2A2A2A" },
  productInfo: { flex: 1, padding: 16, justifyContent: "center" },
  productName: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
  productDetails: { fontSize: 14, marginBottom: 8 },
  price: { fontSize: 16, fontWeight: "800" },
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
