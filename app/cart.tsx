import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors, Radius, Spacing, Type } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useCart, CartItem } from "@/src/context/CartContext";
import { EditVariantModal } from "@/src/components/EditVariantModal";
import { Image } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/src/lib/supabase";
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
  const { items, updateQuantity, removeFromCart, updateVariant } = useCart();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [priceWarnings, setPriceWarnings] = useState<Set<string>>(new Set());

  // H-1: Re-validate prices against live DB on every screen focus
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const refreshPrices = async () => {
        if (items.length === 0) return;
        const productIds = [...new Set(items.map((i) => i.product.id))];
        const { data } = await supabase
          .from("products")
          .select("id, price, sale_price, on_sale")
          .in("id", productIds);
        if (!data || !active) return;

        const warnings = new Set<string>();
        const priceMap = new Map(data.map((p) => [p.id, p]));
        items.forEach((item) => {
          const live = priceMap.get(item.product.id);
          if (!live) return;
          const cachedPrice =
            item.product.on_sale && item.product.sale_price
              ? item.product.sale_price
              : item.product.price;
          const livePrice =
            live.on_sale && live.sale_price ? live.sale_price : live.price;
          if (cachedPrice !== livePrice) warnings.add(item.id);
        });
        setPriceWarnings(warnings);
      };
      refreshPrices();
      return () => {
        active = false;
      };
    }, [items])
  );

  // New items default to selected (keeps "reserve everything" the default
  // experience); items removed from the bag drop out of the selection too.
  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      items.forEach((i) => {
        if (!next.has(i.id)) {
          next.add(i.id);
          changed = true;
        }
      });
      next.forEach((id) => {
        if (!items.some((i) => i.id === id)) {
          next.delete(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [items]);

  const toggleSelected = (itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  };

  const selectedItems = items.filter((i) => selectedIds.has(i.id));
  const selectedCount = selectedItems.reduce((sum, i) => sum + i.quantity, 0);
  const selectedTotal = selectedItems.reduce((sum, i) => {
    const unitPrice =
      i.product.on_sale && i.product.sale_price
        ? i.product.sale_price
        : i.product.price || 0;
    return sum + unitPrice * i.quantity;
  }, 0);

  const renderCartItem = ({ item }: { item: any }) => {
    // Per-size availability captured at add time, not product.stock (which
    // sums every size). Undefined = untracked variant, so uncapped here and
    // left to the server-side hold trigger.
    const maxQty = item.maxQuantity ?? Infinity;
    const atMaxQty = item.quantity >= maxQty;
    const isSelected = selectedIds.has(item.id);

    return (
    <View
      style={[
        styles.cartItem,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <TouchableOpacity
        onPress={() => toggleSelected(item.id)}
        style={styles.checkbox}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityLabel={`Select ${item.product.name}`}
        accessibilityState={{ checked: isSelected }}
      >
        <IconSymbol
          name={isSelected ? "checkmark.circle.fill" : "checkmark.circle"}
          size={22}
          color={isSelected ? colors.tint : colors.secondaryText}
        />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => router.push(`/product/${item.product.id}`)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`View product details for ${item.product.name}`}
      >
        <Image
          source={{ uri: item.product.image_url }}
          style={styles.itemImage}
          contentFit="cover"
        />
      </TouchableOpacity>
      <View style={styles.itemInfo}>
        <TouchableOpacity
          onPress={() => router.push(`/product/${item.product.id}`)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`View product details for ${item.product.name}`}
        >
          <Text
            style={[styles.itemName, { color: colors.text }]}
            numberOfLines={2}
          >
            {item.product.name}
          </Text>
        </TouchableOpacity>
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
          {((item.product.sizes && item.product.sizes.length > 0) || item.product.color) && (
            <TouchableOpacity
              onPress={() => setEditingItem(item)}
              accessibilityRole="button"
              accessibilityLabel={`Change size or color for ${item.product.name}`}
            >
              <Text style={[styles.variantEdit, { color: colors.tint }]}>Change</Text>
            </TouchableOpacity>
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
              style={[styles.qtyBtn, atMaxQty && styles.qtyBtnDisabled]}
              onPress={() => !atMaxQty && updateQuantity(item.id, item.quantity + 1)}
              disabled={atMaxQty}
              accessibilityRole="button"
              accessibilityLabel={`Increase quantity of ${item.product.name}`}
              accessibilityHint={atMaxQty ? `Only ${maxQty} in stock` : "Increases item quantity by one"}
              accessibilityState={{ disabled: atMaxQty }}
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
            <IconSymbol name="trash.fill" size={20} color={colors.notification} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.reserveBtn, { backgroundColor: colors.tint }]}
          onPress={() =>
            router.push({
              pathname: '/reserve/[id]',
              params: {
                id: item.product.id,
                size: item.selectedSize || '',
                color: item.selectedColor || '',
              },
            })
          }
          accessibilityRole="button"
          accessibilityLabel={`Reserve ${item.product.name}`}
          accessibilityHint="Opens the reservation flow to pick a pickup date and time for this item"
        >
          <Text style={styles.reserveBtnText}>Reserve</Text>
        </TouchableOpacity>
      </View>
    </View>
    );
  };

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

      {items.length > 0 && (
        <TouchableOpacity
          onPress={toggleSelectAll}
          style={styles.selectAllRow}
          accessibilityRole="checkbox"
          accessibilityLabel="Select all items"
          accessibilityState={{ checked: allSelected }}
        >
          <IconSymbol
            name={allSelected ? "checkmark.circle.fill" : "checkmark.circle"}
            size={20}
            color={allSelected ? colors.tint : colors.secondaryText}
          />
          <Text style={[styles.selectAllText, { color: colors.text }]}>
            {allSelected ? "Deselect all" : "Select all"}
          </Text>
        </TouchableOpacity>
      )}

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIconBg, { backgroundColor: colors.card }]}>
            <IconSymbol name="bag" size={64} color={colors.icon} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            Your bag is empty
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
            Browse the catalog to add items to your bag.
          </Text>
          <TouchableOpacity
            style={[styles.shopBtn, { backgroundColor: colors.tint }]}
            onPress={() => router.push("/(tabs)/explore")}
            accessibilityRole="button"
            accessibilityLabel="Explore Catalog"
            accessibilityHint="Opens the product catalog"
          >
            <Text style={styles.shopBtnText}>Explore Catalog</Text>
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
                Subtotal ({selectedCount} selected)
              </Text>
              <Text style={[styles.summaryValue, { color: colors.text }]}>
                ₱{selectedTotal.toLocaleString()}
              </Text>
            </View>
            <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.totalLabel, { color: colors.text }]}>
                Deposit if you reserve selected
              </Text>
              <Text style={[styles.totalValue, { color: colors.tint }]}>
                ₱{(selectedTotal * 0.5).toLocaleString()}
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.reserveAllBtn,
                { backgroundColor: colors.tint, opacity: selectedItems.length === 0 ? 0.5 : 1 },
              ]}
              onPress={() =>
                router.push({
                  pathname: '/reserve/[id]',
                  params: { id: 'cart', itemIds: selectedItems.map((i) => i.id).join(',') },
                })
              }
              disabled={selectedItems.length === 0}
              accessibilityRole="button"
              accessibilityLabel={`Reserve selected ${selectedCount} items`}
              accessibilityHint="Books one pickup slot for the selected items in your bag"
              accessibilityState={{ disabled: selectedItems.length === 0 }}
            >
              <Text style={styles.reserveAllBtnText}>
                Reserve selected ({selectedCount})
              </Text>
            </TouchableOpacity>

            <Text style={[styles.footerNote, { color: colors.secondaryText }]}>
              Collect all selected items in a single visit. Pay a 50%
              deposit now and settle the remaining balance at pickup.
              Reserve items individually to schedule separate visits.
            </Text>
          </View>
        </>
      )}

      {editingItem && (
        <EditVariantModal
          visible={!!editingItem}
          product={editingItem.product}
          currentSize={editingItem.selectedSize}
          currentColor={editingItem.selectedColor}
          onClose={() => setEditingItem(null)}
          onSave={(size, color, maxQuantity) => updateVariant(editingItem.id, size, color, maxQuantity)}
        />
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: { padding: Spacing.sm },
  headerTitle: { ...Type.subtitle },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xxxl,
  },
  emptyIconBg: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.xxl,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: Spacing.md,
  },
  emptySubtitle: {
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: Spacing.xxxl,
  },
  shopBtn: {
    paddingHorizontal: Spacing.xxxl,
    paddingVertical: Spacing.lg,
    borderRadius: 30,
    shadowColor: "#C9A96E",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  shopBtnText: {
    fontWeight: "800",
    fontSize: 16,
  },
  selectAllRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  selectAllText: {
    fontSize: 14,
    fontWeight: "600",
  },
  listContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  cartItem: {
    flexDirection: "row",
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    gap: Spacing.lg,
  },
  checkbox: {
    justifyContent: "center",
    alignItems: "center",
  },
  itemImage: {
    width: 80,
    height: 100,
    borderRadius: Radius.sm,
    backgroundColor: "#2A2A2A",
  },
  itemInfo: {
    flex: 1,
    justifyContent: "space-between",
  },
  itemName: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: Spacing.xs,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: "700",
  },
  variants: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  variantText: {
    fontSize: 12,
  },
  variantEdit: {
    fontSize: 12,
    fontWeight: "700",
    textDecorationLine: "underline",
  },
  itemActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: Spacing.md,
  },
  quantityControl: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: Radius.sm,
    overflow: "hidden",
  },
  qtyBtn: {
    padding: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  qtyBtnDisabled: {
    opacity: 0.4,
  },
  qtyText: {
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: Spacing.sm,
  },
  removeBtn: {
    padding: Spacing.sm,
  },
  footer: {
    padding: Spacing.xxl,
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
    marginBottom: Spacing.md,
  },
  // The bag's money rows, left as literals for the same reason as the reserve
  // and reservation screens: the label matches a token but the amount beside it
  // does not, so converting one gives it a lineHeight the other lacks and pulls
  // the pair off a shared baseline.
  summaryLabel: { fontSize: 14 },
  summaryValue: { fontSize: 14, fontWeight: "500" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: Spacing.sm,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    marginBottom: Spacing.xxl,
  },
  totalLabel: { fontSize: 16, fontWeight: "700" },
  totalValue: { fontSize: 20, fontWeight: "800" },
  footerNote: { fontSize: 13, lineHeight: 19 },
  reserveBtn: {
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginTop: Spacing.md,
  },
  reserveBtnText: {
    fontSize: 14,
    fontWeight: "800",
  },
  reserveAllBtn: {
    height: 52,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 14,
  },
  reserveAllBtnText: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
});
