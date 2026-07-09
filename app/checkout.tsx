import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useAuth } from "@/src/context/AuthContext";
import { useCart } from "@/src/context/CartContext";
import { supabase } from "@/src/lib/supabase";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function CheckoutScreen() {
  const theme = useColorScheme() ?? "dark";
  const colors = Colors[theme];
  const router = useRouter();
  const { items, totalAmount, clearCart } = useCart();
  const { user } = useAuth();

  const [address, setAddress] = useState({
    street: "",
    city: "",
    province: "",
    zip: "",
  });

  const [processing, setProcessing] = useState(false);
  const [pickupDate, setPickupDate] = useState("");

  const isValidDate = (dateStr: string) => {
    const reg = /^\d{4}-\d{2}-\d{2}$/;
    if (!reg.test(dateStr)) return false;
    const parts = dateStr.split("-");
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const d = new Date(year, month, day);
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
  };

  const isDateValid = isValidDate(pickupDate);
  const isAddressValid = !!(address.street && address.city && address.province && address.zip);
  const canPay = isAddressValid && isDateValid && !processing && items.length > 0;

  const handleCheckout = async () => {
    if (!user) {
      Alert.alert(
        "Login Required",
        "Please log in to complete your purchase.",
        [
          { text: "Login", onPress: () => router.push("/(auth)") },
          { text: "Cancel", style: "cancel" },
        ],
      );
      return;
    }

    if (!address.street || !address.city || !address.province || !address.zip) {
      Alert.alert("Missing Info", "Please fill in all address fields.");
      return;
    }

    if (!isValidDate(pickupDate)) {
      Alert.alert("Invalid Date", "Please enter a valid pickup date in YYYY-MM-DD format.");
      return;
    }

    if (items.length === 0) {
      Alert.alert("Empty Bag", "Your bag is empty.");
      return;
    }

    setProcessing(true);
    try {
      const orderItems = items.map((item) => ({
        product_id: item.product.id,
        quantity: item.quantity,
        selected_size: item.selectedSize || null,
        selected_color: item.selectedColor || null,
      }));

      const { data: order, error: orderError } = await supabase.rpc(
        "create_order",
        {
          _shipping_address: address,
          _items: orderItems,
        },
      );

      if (orderError) throw orderError;
      const orderId = (order as any)?.id;
      if (!orderId) throw new Error("Order could not be created.");

      await clearCart();
      router.replace(`/orders/${orderId}` as any);
    } catch (err: any) {
      console.error("Checkout failed", err);
      Alert.alert("Checkout Failed", err.message || "Something went wrong.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top", "bottom"]}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          disabled={processing}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
          accessibilityState={{ disabled: processing }}
        >
          <IconSymbol name="chevron.left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Checkout
        </Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Shipping Address
          </Text>

          <TextInput
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
            placeholder="Street Address"
            placeholderTextColor={colors.secondaryText}
            value={address.street}
            onChangeText={(text) =>
              setAddress((prev) => ({ ...prev, street: text }))
            }
          />
          <TextInput
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
            placeholder="City"
            placeholderTextColor={colors.secondaryText}
            value={address.city}
            onChangeText={(text) =>
              setAddress((prev) => ({ ...prev, city: text }))
            }
          />
          <View style={styles.row}>
            <TextInput
              style={[
                styles.input,
                styles.halfInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
              placeholder="Province"
              placeholderTextColor={colors.secondaryText}
              value={address.province}
              onChangeText={(text) =>
                setAddress((prev) => ({ ...prev, province: text }))
              }
            />
            <TextInput
              style={[
                styles.input,
                styles.halfInput,
                {
                  color: colors.text,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
              placeholder="ZIP Code"
              placeholderTextColor={colors.secondaryText}
              keyboardType="number-pad"
              value={address.zip}
              onChangeText={(text) =>
                setAddress((prev) => ({ ...prev, zip: text }))
              }
            />
          </View>
        </View>

        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Pickup Date
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.secondaryText}
            value={pickupDate}
            onChangeText={setPickupDate}
            keyboardType="numeric"
            accessibilityRole="text"
            accessibilityLabel="Pickup Date"
            accessibilityHint="Enter pickup date in YYYY-MM-DD format"
          />
          {pickupDate.length > 0 && !isDateValid && (
            <Text style={{ color: colors.notification, fontSize: 13, marginTop: 4 }}>
              Invalid date format. Use YYYY-MM-DD (e.g. 2026-07-15).
            </Text>
          )}
        </View>

        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Payment Method
          </Text>
          <View style={[styles.paymentMethod, { borderColor: colors.tint }]}>
            <IconSymbol name="creditcard.fill" size={24} color={colors.tint} />
            <Text style={[styles.paymentText, { color: colors.text }]}>
              Credit Card (Simulated)
            </Text>
            <IconSymbol
              name="checkmark.circle.fill"
              size={20}
              color={colors.tint}
            />
          </View>
        </View>

        <View
          style={[
            styles.section,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Order Summary
          </Text>
          <View style={styles.summaryRow}>
            <Text
              style={[styles.summaryLabel, { color: colors.secondaryText }]}
            >
              Subtotal
            </Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>
              ₱{totalAmount.toLocaleString()}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text
              style={[styles.summaryLabel, { color: colors.secondaryText }]}
            >
              Shipping
            </Text>
            <Text style={[styles.summaryValue, { color: colors.text }]}>
              Free
            </Text>
          </View>
          <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
            <Text style={[styles.totalLabel, { color: colors.text }]}>
              Total to Pay
            </Text>
            <Text style={[styles.totalValue, { color: colors.tint }]}>
              ₱{totalAmount.toLocaleString()}
            </Text>
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { backgroundColor: colors.card, borderTopColor: colors.border },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.payBtn,
            { backgroundColor: canPay ? colors.tint : colors.border, opacity: canPay ? 1 : 0.7 },
          ]}
          onPress={handleCheckout}
          disabled={!canPay}
          accessibilityRole="button"
          accessibilityLabel={`Pay ${totalAmount.toLocaleString()} pesos`}
          accessibilityHint="Completes your checkout and places the order"
          accessibilityState={{ disabled: !canPay }}
        >
          {processing ? (
            <ActivityIndicator color="#0D0D0D" />
          ) : (
            <Text style={styles.payBtnText}>
              Pay ₱{totalAmount.toLocaleString()}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  content: { padding: 16, gap: 16 },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 15,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  paymentMethod: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    gap: 12,
  },
  paymentText: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  summaryLabel: { fontSize: 14 },
  summaryValue: { fontSize: 14, fontWeight: "500" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  totalLabel: { fontSize: 16, fontWeight: "700" },
  totalValue: { fontSize: 20, fontWeight: "800" },
  footer: {
    padding: 24,
    borderTopWidth: 1,
  },
  payBtn: {
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  payBtnText: {
    color: "#0D0D0D",
    fontSize: 16,
    fontWeight: "800",
  },
});
