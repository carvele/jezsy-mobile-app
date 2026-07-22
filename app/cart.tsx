import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useCart } from "@/src/context/CartContext";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React from "react";
import {
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function CartScreen() {
  const theme = useColorScheme() ?? "dark";
  const colors = Colors[theme];
  const router = useRouter();
  const { items, updateQuantity, removeFromCart, totalAmount, itemCount } =
    useCart();

  const renderCartItem = ({ item }: { item: any }) => (
    <View
      style={[
        styles.cartItem,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Image
        source={{ uri: item.product.image_url }}
        style={styles.itemImage}
        contentFit="cover"
      />
      <View style={styles.itemInfo}>
        <Text
          style={[styles.itemName, { color: colors.text }]}
          numberOfLines={2}
        >
          {item.product.name}
        </Text>
        <Text style={[styles.itemPrice, { color: colors.text }]}>
          ₱
          {(
            item.product.on_sale && item.product.sale_price
              ? item.product.sale_price
              : item.product.price || 0
          ).toLocaleString()}
        </Text>

        <View style={styles.variants}>
          {item.selectedSize && (
            <Text style={[styles.variantText, { color: colors.secondaryText }]}>
              Size: {item.selectedSize}
            </Text>
          )}
          {item.selectedColor && (
            <Text style={[styles.variantText, { color: colors.secondaryText }]}>
              Color: {item.selectedColor}
            </Text>
          )}
        </View>

        <View style={styles.itemActions}>
          <View
            style={[styles.quantityControl, { borderColor: colors.border }]}
          >
            <TouchableOpacity
              style={styles.qtyBtn}
              onPress={() => updateQuantity(item.id, item.quantity - 1)}
              accessibilityRole="button"
              accessibilityLabel={`Decrease quantity of ${item.product.name}`}
              accessibilityHint="Reduces item quantity by one"
            >
              <IconSymbol name="minus" size={16} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.qtyText, { color: colors.text }]}>
              {item.quantity}
            </Text>
            <TouchableOpacity
              style={styles.qtyBtn}
              onPress={() => updateQuantity(item.id, item.quantity + 1)}
              accessibilityRole="button"
              accessibilityLabel={`Increase quantity of ${item.product.name}`}
              accessibilityHint="Increases item quantity by one"
            >
              <IconSymbol name="plus" size={16} color={colors.text} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => removeFromCart(item.id)}
            style={styles.removeBtn}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.product.name} from bag`}
            accessibilityHint="Removes this item from your shopping bag"
          >
            <IconSymbol name="trash" size={20} color={colors.notification} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={["top"]}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <IconSymbol name="chevron.left" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          Shopping Bag
        </Text>
        <View style={{ width: 38 }} />
      </View>

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIconBg, { backgroundColor: colors.card }]}>
            <IconSymbol name="bag" size={64} color={colors.icon} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Your bag is empty
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
            Looks like you haven&apos;t added anything to your bag yet.
          </Text>
          <TouchableOpacity
            style={[styles.shopBtn, { backgroundColor: colors.tint }]}
            onPress={() => router.push("/(tabs)/explore")}
            accessibilityRole="button"
            accessibilityLabel="Start Shopping"
            accessibilityHint="Opens the product catalog"
          >
            <Text style={styles.shopBtnText}>Start Shopping</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            renderItem={renderCartItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />

          <View
            style={[
              styles.footer,
              { backgroundColor: colors.card, borderTopColor: colors.border },
            ]}
          >
            <View style={styles.summaryRow}>
              <Text
                style={[styles.summaryLabel, { color: colors.secondaryText }]}
              >
                Subtotal ({itemCount} items)
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
                Calculated at checkout
              </Text>
            </View>
            <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.totalLabel, { color: colors.text }]}>
                Total
              </Text>
              <Text style={[styles.totalValue, { color: colors.text }]}>
                ₱{totalAmount.toLocaleString()}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.checkoutBtn, { backgroundColor: colors.tint }]}
              onPress={() => router.push("/checkout")}
              accessibilityRole="button"
              accessibilityLabel={`Proceed to Checkout, total ${totalAmount.toLocaleString()} pesos`}
              accessibilityHint="Opens the checkout screen to complete your purchase"
            >
              <Text style={styles.checkoutBtnText}>Proceed to Checkout</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
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
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
  },
  emptyIconBg: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 12,
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  shopBtn: {
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 30,
    shadowColor: "#C9A96E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  shopBtnText: {
    color: "#0D0D0D",
    fontWeight: "800",
    fontSize: 16,
  },
  listContent: {
    padding: 16,
    paddingBottom: 24,
  },
  cartItem: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 16,
    padding: 12,
    gap: 16,
  },
  itemImage: {
    width: 80,
    height: 100,
    borderRadius: 8,
    backgroundColor: "#2A2A2A",
  },
  itemInfo: {
    flex: 1,
    justifyContent: "space-between",
  },
  itemName: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: "700",
  },
  variants: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  variantText: {
    fontSize: 12,
  },
  itemActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
  },
  quantityControl: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    overflow: "hidden",
  },
  qtyBtn: {
    padding: 8,
    paddingHorizontal: 12,
  },
  qtyText: {
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: 8,
  },
  removeBtn: {
    padding: 8,
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  summaryLabel: { fontSize: 14 },
  summaryValue: { fontSize: 14, fontWeight: "500" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: 1,
    marginBottom: 24,
  },
  totalLabel: { fontSize: 18, fontWeight: "700" },
  totalValue: { fontSize: 20, fontWeight: "800" },
  checkoutBtn: {
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  checkoutBtnText: {
    color: "#0D0D0D",
    fontSize: 16,
    fontWeight: "800",
  },
});
