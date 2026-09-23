import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Image,
  Alert,
} from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PlannedOutfit, PlannedOutfitItemSnapshot } from '@/src/types/planner';
import { formatSlotLabel } from '@/src/utils/plannerDateTime';

export interface PlannedOutfitCardProps {
  plan: PlannedOutfit;
  inventoryStatus?: 'loading' | 'ready' | 'error';
  authoritativeInventory?: { id: string }[] | Set<string> | Map<string, any>;
  onReschedule: (plan: PlannedOutfit) => void;
  onEditMetadata: (plan: PlannedOutfit) => void;
  onCancel: (plan: PlannedOutfit) => void;
}

export const PlannedOutfitCard: React.FC<PlannedOutfitCardProps> = ({
  plan,
  inventoryStatus = 'ready',
  authoritativeInventory,
  onReschedule,
  onEditMetadata,
  onCancel,
}) => {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];

  // Authoritative inventory set
  const inventorySet: Set<string> | null = React.useMemo(() => {
    if (!authoritativeInventory) return null;
    if (authoritativeInventory instanceof Set) return authoritativeInventory;
    if (authoritativeInventory instanceof Map) return new Set(authoritativeInventory.keys());
    return new Set(authoritativeInventory.map((i) => i.id));
  }, [authoritativeInventory]);

  const isItemAvailable = (itemId: string): boolean | 'unknown' => {
    if (inventoryStatus !== 'ready' || !inventorySet) {
      return 'unknown';
    }
    return inventorySet.has(itemId);
  };

  const handleCancelPress = () => {
    Alert.alert(
      'Cancel Planned Outfit',
      'Are you sure you want to remove this look from your planner? The items will remain in your wardrobe.',
      [
        { text: 'Keep Plan', style: 'cancel' },
        {
          text: 'Cancel Plan',
          style: 'destructive',
          onPress: () => onCancel(plan),
        },
      ]
    );
  };

  const renderStatusBadge = () => {
    if (plan.status === 'unconfirmed') {
      return (
        <View style={[styles.statusBadge, { backgroundColor: theme.surface, borderColor: theme.hairline }]}>
          <Text style={[styles.statusText, { color: theme.secondaryText }]}>Not confirmed</Text>
        </View>
      );
    }
    if (plan.status === 'worn') {
      return (
        <View style={[styles.statusBadge, { backgroundColor: theme.surface, borderColor: theme.success }]}>
          <Text style={[styles.statusText, { color: theme.success }]}>Worn</Text>
        </View>
      );
    }
    if (plan.status === 'skipped') {
      return (
        <View style={[styles.statusBadge, { backgroundColor: theme.surface, borderColor: theme.secondaryText }]}>
          <Text style={[styles.statusText, { color: theme.secondaryText }]}>Skipped</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
      ]}
      accessibilityRole="none"
      accessibilityLabel={`Planned outfit for ${formatSlotLabel(plan.slot)}. Status: ${plan.status}.`}
    >
      {/* Top Header: Slot and Status */}
      <View style={styles.cardHeader}>
        <View style={styles.slotRow}>
          <View style={[styles.slotBadge, { backgroundColor: theme.glass, borderColor: theme.hairline }]}>
            <Text style={[styles.slotText, { color: theme.tint }]}>
              {formatSlotLabel(plan.slot)}
            </Text>
          </View>
          {plan.occasion ? (
            <Text style={[styles.occasionText, { color: theme.secondaryText }]} numberOfLines={1}>
              • {plan.occasion}
            </Text>
          ) : null}
        </View>

        {renderStatusBadge()}
      </View>

      {/* Garments Row */}
      <View style={styles.itemsScroll}>
        {plan.items.map((item: PlannedOutfitItemSnapshot, idx: number) => {
          const avail = isItemAvailable(item.id);
          const isUnavailable = avail === false;

          return (
            <View key={`${item.id}-${idx}`} testID={`snapshot-item-${item.id}`} style={styles.itemContainer}>
              <View
                style={[
                  styles.imageWrapper,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
              >
                {item.image_url ? (
                  <Image
                    source={{ uri: item.image_url }}
                    style={styles.itemImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <IconSymbol name="tshirt" size={24} color={theme.icon} />
                  </View>
                )}
                {isUnavailable && (
                  <View style={[styles.unavailableBadge, { backgroundColor: 'rgba(0, 0, 0, 0.75)' }]}>
                    <Text style={styles.unavailableText}>Unavailable</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.itemName, { color: theme.text }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.itemCategory, { color: theme.secondaryText }]} numberOfLines={1}>
                {item.category}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Notes if provided */}
      {plan.notes ? (
        <View style={[styles.notesContainer, { backgroundColor: theme.glass }]}>
          <IconSymbol name="doc.text" size={14} color={theme.secondaryText} style={styles.notesIcon} />
          <Text style={[styles.notesText, { color: theme.secondaryText }]} numberOfLines={2}>
            {plan.notes}
          </Text>
        </View>
      ) : null}

      {/* Actions Bar */}
      <View style={[styles.actionsRow, { borderTopColor: theme.hairline }]}>
        <Pressable
          testID="btn-reschedule"
          accessibilityRole="button"
          accessibilityLabel="Reschedule outfit date or slot"
          onPress={() => onReschedule(plan)}
          style={styles.actionButton}
          hitSlop={8}
        >
          <IconSymbol name="calendar" size={16} color={theme.tint} />
          <Text style={[styles.actionButtonText, { color: theme.tint }]}>Reschedule</Text>
        </Pressable>

        <Pressable
          testID="btn-edit-metadata"
          accessibilityRole="button"
          accessibilityLabel="Edit notes"
          onPress={() => onEditMetadata(plan)}
          style={styles.actionButton}
          hitSlop={8}
        >
          <IconSymbol name="pencil" size={16} color={theme.text} />
          <Text style={[styles.actionButtonText, { color: theme.text }]}>Notes</Text>
        </Pressable>

        <Pressable
          testID="btn-cancel-plan"
          accessibilityRole="button"
          accessibilityLabel="Cancel plan"
          onPress={handleCancelPress}
          style={styles.actionButton}
          hitSlop={8}
        >
          <IconSymbol name="xmark.circle" size={16} color={theme.error} />
          <Text style={[styles.actionButtonText, { color: theme.error }]}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  slotBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
    marginRight: Spacing.sm,
  },
  slotText: {
    ...Type.caption,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  occasionText: {
    ...Type.caption,
    fontSize: 13,
    flexShrink: 1,
  },
  statusBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  statusText: {
    ...Type.caption,
    fontSize: 11,
    fontWeight: '600',
  },
  itemsScroll: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  itemContainer: {
    width: 76,
    alignItems: 'center',
  },
  imageWrapper: {
    width: 76,
    height: 92,
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 4,
  },
  itemImage: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableBadge: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  itemName: {
    ...Type.caption,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    width: '100%',
  },
  itemCategory: {
    ...Type.caption,
    fontSize: 10,
    textAlign: 'center',
    width: '100%',
  },
  notesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    borderRadius: Radius.sm,
    marginBottom: Spacing.md,
  },
  notesIcon: {
    marginRight: 6,
  },
  notesText: {
    ...Type.caption,
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  actionButton: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    gap: 4,
  },
  actionButtonText: {
    ...Type.caption,
    fontSize: 12,
    fontWeight: '600',
  },
});
