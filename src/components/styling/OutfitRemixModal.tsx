import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Colors, Spacing, Radius, WardrobeTokens } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { DeterministicFlatLayCanvas } from './DeterministicFlatLayCanvas';
import {
  OutfitRemixState,
  OutfitRemixResult,
  OutfitRemixSlotType,
  RemixedSlotItem,
} from '@/src/types/outfitRemix';
import { WardrobeItem } from '@/src/types/styleAdvisor';
import {
  toggleSlotLock,
  getCanonicalSlotReplacements,
  replaceSlotItemWithCandidate,
  switchBaseStructure,
  shuffleUnlockedSlots,
  addOuterwear,
  removeOuterwear,
  createRemixResult,
} from '@/src/services/styling/outfitRemixService';
import { tapLight, tapMedium } from '@/src/utils/haptics';

export interface OutfitRemixModalProps {
  visible: boolean;
  onClose: () => void;
  initialState: OutfitRemixState | null;
  wardrobe: WardrobeItem[];
  onApply: (result: OutfitRemixResult) => void;
  onSave?: (result: OutfitRemixResult) => void;
  onOpenMannequin?: (result: OutfitRemixResult) => void;
  saving?: boolean;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export function OutfitRemixModal({
  visible,
  onClose,
  initialState,
  wardrobe,
  onApply,
  onSave,
  onOpenMannequin,
  saving = false,
}: OutfitRemixModalProps) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const wt = WardrobeTokens.theme[theme];

  const [remixState, setRemixState] = useState<OutfitRemixState | null>(initialState);
  const [swappingSlot, setSwappingSlot] = useState<OutfitRemixSlotType | null>(null);

  useEffect(() => {
    if (visible && initialState) {
      setRemixState(initialState);
      setSwappingSlot(null);
    }
  }, [visible, initialState]);

  if (!remixState) return null;

  const currentIsDress = !!remixState.slots.dress;

  // Active items for canvas
  const previewItems = remixState.activeCandidate?.items || [];

  // Handlers
  const handleToggleLock = (slot: OutfitRemixSlotType) => {
    tapLight();
    const next = toggleSlotLock(remixState, slot);
    setRemixState(next);
  };

  const handleToggleSwapRow = (slot: OutfitRemixSlotType) => {
    tapLight();
    setSwappingSlot((prev) => (prev === slot ? null : slot));
  };

  const handleSelectReplacement = (candidate: any) => {
    tapLight();
    const next = replaceSlotItemWithCandidate(remixState, candidate);
    setRemixState(next);
    setSwappingSlot(null);
  };

  const handleSwitchStructure = (target: 'dress' | 'separates') => {
    tapLight();
    const next = switchBaseStructure(remixState, target, wardrobe);
    setRemixState(next);
    setSwappingSlot(null);
  };

  const handleShuffleUnlocked = () => {
    tapMedium();
    const next = shuffleUnlockedSlots(remixState, wardrobe);
    setRemixState(next);
    setSwappingSlot(null);
  };

  const handleAddOuterwear = () => {
    tapLight();
    const next = addOuterwear(remixState, wardrobe);
    setRemixState(next);
  };

  const handleRemoveOuterwear = () => {
    tapLight();
    const next = removeOuterwear(remixState);
    setRemixState(next);
    if (swappingSlot === 'outerwear') {
      setSwappingSlot(null);
    }
  };

  const handleApply = () => {
    tapMedium();
    const result = createRemixResult(remixState);
    onApply(result);
    onClose();
  };

  const handleSave = () => {
    tapMedium();
    const result = createRemixResult(remixState);
    onSave?.(result);
  };

  const handleMannequin = () => {
    tapLight();
    const result = createRemixResult(remixState);
    onOpenMannequin?.(result);
  };

  // Render slot card
  const renderSlotCard = (slotType: OutfitRemixSlotType, slotData: RemixedSlotItem | null) => {
    const isSlotLocked = !!slotData?.isLocked;
    const canUnlock = slotData?.canUnlockInRemix ?? false;
    const isSwapping = swappingSlot === slotType;
    const replacements = isSwapping && slotData
      ? getCanonicalSlotReplacements(remixState, slotType, wardrobe)
      : [];

    const slotTitle =
      slotType === 'top'
        ? 'Top'
        : slotType === 'bottom'
        ? 'Bottom'
        : slotType === 'dress'
        ? 'Dress'
        : slotType === 'shoes'
        ? 'Shoes'
        : 'Outerwear';

    if (!slotData) {
      if (slotType === 'outerwear') {
        return (
          <View
            key={slotType}
            style={[styles.slotCard, { backgroundColor: wt.cardSurface, borderColor: wt.cardBorder }]}
          >
            <View style={styles.emptyOuterwearRow}>
              <View>
                <Text style={[styles.slotName, { color: colors.secondaryText }]}>Outerwear</Text>
                <Text style={[styles.slotItemDesc, { color: colors.secondaryText }]}>No outer layer</Text>
              </View>
              <TouchableOpacity
                style={[styles.smallActionBtn, { borderColor: wt.cardBorder, backgroundColor: wt.cardSurfaceSubtle }]}
                onPress={handleAddOuterwear}
                accessibilityRole="button"
                accessibilityLabel="Add outerwear layer"
              >
                <IconSymbol name="plus" size={13} color={wt.actionPrimary} />
                <Text style={[styles.smallActionBtnText, { color: wt.actionPrimary }]}>Add Layer</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }
      return null;
    }

    const { item, lockReason } = slotData;
    const itemName = item.sub_category || item.category || 'Garment';
    const itemColor = (item.color_tags && item.color_tags.length > 0) ? item.color_tags.join(', ') : '';

    return (
      <View
        key={slotType}
        style={[styles.slotCard, { backgroundColor: wt.cardSurface, borderColor: wt.cardBorder }]}
      >
        <View style={styles.slotHeaderRow}>
          {/* Thumbnail */}
          <View style={[styles.thumbWrap, { backgroundColor: wt.cardSurfaceSubtle, borderColor: wt.cardBorder }]}>
            {item.image_url ? (
              <Image source={{ uri: item.image_url }} style={styles.thumbImage} contentFit="contain" />
            ) : (
              <IconSymbol name="hanger" size={20} color={colors.secondaryText} />
            )}
          </View>

          {/* Details */}
          <View style={styles.slotDetails}>
            <View style={styles.slotTitleRow}>
              <Text style={[styles.slotName, { color: colors.secondaryText }]}>{slotTitle}</Text>
              {lockReason === 'style-around' && (
                <Text style={[styles.provenancePill, { color: wt.statusConsiderText }]}>Session Anchor</Text>
              )}
              {lockReason === 'parent-must-use' && (
                <Text style={[styles.provenancePill, { color: wt.statusConsiderText }]}>Required</Text>
              )}
            </View>
            <Text style={[styles.slotItemName, { color: colors.text }]} numberOfLines={1}>
              {itemName}
            </Text>
            {itemColor ? (
              <Text style={[styles.slotItemDesc, { color: colors.secondaryText }]} numberOfLines={1}>
                {itemColor}
              </Text>
            ) : null}
          </View>

          {/* Lock Action */}
          <TouchableOpacity
            style={[
              styles.lockBtn,
              {
                borderColor: wt.cardBorder,
                backgroundColor: isSlotLocked ? wt.cardSurfaceSubtle : 'transparent',
                opacity: canUnlock ? 1 : 0.6,
              },
            ]}
            onPress={() => handleToggleLock(slotType)}
            disabled={!canUnlock}
            accessibilityRole="button"
            accessibilityLabel={
              !canUnlock
                ? `${slotTitle} locked by ${lockReason}`
                : isSlotLocked
                ? `Unlock ${slotTitle}`
                : `Lock ${slotTitle}`
            }
          >
            <IconSymbol
              name={isSlotLocked ? 'lock.fill' : 'lock.open'}
              size={14}
              color={isSlotLocked ? wt.statusConsiderText : colors.secondaryText}
            />
            <Text
              style={[
                styles.lockBtnText,
                { color: isSlotLocked ? wt.statusConsiderText : colors.secondaryText },
              ]}
            >
              {isSlotLocked ? 'Locked' : 'Lock'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Slot Controls: Swap & Remove Outerwear */}
        <View style={styles.slotControlsRow}>
          {!isSlotLocked ? (
            <TouchableOpacity
              style={[
                styles.swapToggleBtn,
                {
                  borderColor: wt.cardBorder,
                  backgroundColor: isSwapping ? wt.accentGoldSubtle : wt.cardSurfaceSubtle,
                },
              ]}
              onPress={() => handleToggleSwapRow(slotType)}
              accessibilityRole="button"
              accessibilityLabel={`Swap ${slotTitle}`}
            >
              <IconSymbol
                name="arrow.triangle.2.circlepath"
                size={12}
                color={isSwapping ? wt.actionPrimary : wt.actionSecondaryText}
              />
              <Text
                style={[
                  styles.swapToggleText,
                  { color: isSwapping ? wt.actionPrimary : wt.actionSecondaryText },
                ]}
              >
                {isSwapping ? 'Hide Alternatives' : 'Swap Piece'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.lockedHintWrap}>
              <Text style={[styles.lockedHintText, { color: colors.secondaryText }]}>
                {canUnlock ? 'Unlock piece to swap' : 'Fixed for this session'}
              </Text>
            </View>
          )}

          {slotType === 'outerwear' && (
            <TouchableOpacity
              style={[
                styles.removeOuterwearBtn,
                { borderColor: wt.cardBorder, opacity: canUnlock ? 1 : 0.6 },
              ]}
              onPress={handleRemoveOuterwear}
              disabled={!canUnlock}
              accessibilityRole="button"
              accessibilityLabel="Remove outerwear layer"
            >
              <IconSymbol name="minus" size={12} color={colors.secondaryText} />
              <Text style={[styles.removeOuterwearText, { color: colors.secondaryText }]}>Remove</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Replacement Carousel */}
        {isSwapping && !isSlotLocked && (
          <View style={[styles.replacementsContainer, { borderTopColor: wt.cardBorder }]}>
            {replacements.length === 0 ? (
              <Text style={[styles.emptyReplacementsText, { color: colors.secondaryText }]}>
                No alternative {slotTitle.toLowerCase()} options match your styling constraints.
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.replacementsScroll}
              >
                {replacements.map((r) => {
                  const repItem = r.replacementItem;
                  return (
                    <TouchableOpacity
                      key={repItem.id}
                      style={[
                        styles.replacementPill,
                        { backgroundColor: wt.cardSurfaceSubtle, borderColor: wt.cardBorder },
                      ]}
                      onPress={() => handleSelectReplacement(r.candidate)}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${repItem.sub_category || repItem.category}, score ${r.candidate.baseScore}`}
                    >
                      <View style={styles.repThumbWrap}>
                        {repItem.image_url ? (
                          <Image
                            source={{ uri: repItem.image_url }}
                            style={styles.repThumb}
                            contentFit="contain"
                          />
                        ) : (
                          <IconSymbol name="hanger" size={14} color={colors.secondaryText} />
                        )}
                      </View>
                      <View style={styles.repInfo}>
                        <Text style={[styles.repName, { color: colors.text }]} numberOfLines={1}>
                          {repItem.sub_category || repItem.category}
                        </Text>
                        <Text style={[styles.repScore, { color: wt.actionPrimary }]}>
                          Score {r.candidate.baseScore}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      accessibilityViewIsModal
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, borderColor: wt.cardBorder },
          ]}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: wt.cardBorder }]}>
            <View style={styles.headerTitleWrap}>
              <Text style={[styles.title, { color: colors.text }]}>Remix Outfit</Text>
              <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
                {remixState.activeCandidate?.colorMatchLabel || 'Balanced'} · Score {remixState.activeCandidate?.baseScore ?? 80}/100
                {remixState.isDirty ? ' · Draft' : ''}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.closeBtn, { borderColor: wt.cardBorder }]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close remix editor"
            >
              <IconSymbol name="xmark" size={16} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Scrollable Content */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Inline Error Banner */}
            {remixState.error ? (
              <View style={[styles.errorBanner, { backgroundColor: wt.statusConflictBg }]}>
                <IconSymbol name="exclamationmark.triangle.fill" size={14} color={wt.statusConflictText} />
                <Text style={[styles.errorBannerText, { color: wt.statusConflictText }]}>
                  {remixState.error}
                </Text>
              </View>
            ) : null}

            {/* Flat Lay Visual Canvas */}
            <View style={[styles.canvasWrapper, { borderColor: wt.cardBorder, backgroundColor: wt.cardSurface }]}>
              <DeterministicFlatLayCanvas items={previewItems} height={200} />
            </View>

            {/* Base Structure Switcher Bar */}
            <View style={[styles.structureBar, { backgroundColor: wt.cardSurfaceSubtle, borderColor: wt.cardBorder }]}>
              <TouchableOpacity
                style={[
                  styles.structureTab,
                  !currentIsDress && { backgroundColor: wt.actionPrimary },
                ]}
                onPress={() => handleSwitchStructure('separates')}
                accessibilityRole="button"
                accessibilityLabel="Switch to Separates: Top and Bottom"
              >
                <Text
                  style={[
                    styles.structureTabText,
                    { color: !currentIsDress ? wt.actionPrimaryText : colors.secondaryText },
                  ]}
                >
                  Separates (Top + Bottom)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.structureTab,
                  currentIsDress && { backgroundColor: wt.actionPrimary },
                ]}
                onPress={() => handleSwitchStructure('dress')}
                accessibilityRole="button"
                accessibilityLabel="Switch to Dress"
              >
                <Text
                  style={[
                    styles.structureTabText,
                    { color: currentIsDress ? wt.actionPrimaryText : colors.secondaryText },
                  ]}
                >
                  Dress
                </Text>
              </TouchableOpacity>
            </View>

            {/* Garment Slots List */}
            <View style={styles.slotsContainer}>
              {currentIsDress ? (
                <>
                  {renderSlotCard('dress', remixState.slots.dress)}
                  {renderSlotCard('outerwear', remixState.slots.outerwear)}
                  {renderSlotCard('shoes', remixState.slots.shoes)}
                </>
              ) : (
                <>
                  {renderSlotCard('top', remixState.slots.top)}
                  {renderSlotCard('bottom', remixState.slots.bottom)}
                  {renderSlotCard('outerwear', remixState.slots.outerwear)}
                  {renderSlotCard('shoes', remixState.slots.shoes)}
                </>
              )}
            </View>

            {/* Preserved Passthrough Accessories (Phase F passthrough) */}
            {remixState.passthroughItems.length > 0 && (
              <View style={[styles.passthroughSection, { borderColor: wt.cardBorder, backgroundColor: wt.cardSurfaceSubtle }]}>
                <View style={styles.passthroughHeader}>
                  <IconSymbol name="sparkles" size={13} color={wt.actionPrimary} />
                  <Text style={[styles.passthroughTitle, { color: colors.secondaryText }]}>
                    Preserved Accessories (Phase F)
                  </Text>
                </View>
                <View style={styles.passthroughList}>
                  {remixState.passthroughItems.map((p) => (
                    <View
                      key={p.id}
                      style={[styles.passthroughChip, { backgroundColor: wt.cardSurface, borderColor: wt.cardBorder }]}
                    >
                      <Text style={[styles.passthroughChipText, { color: colors.text }]}>
                        {p.sub_category || p.category || 'Accessory'}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {remixState.missingItems && remixState.missingItems.length > 0 && (
              <View style={[styles.passthroughSection, { borderColor: wt.cardBorder }]}>
                <View style={styles.passthroughHeader}>
                  <IconSymbol name="exclamationmark.triangle.fill" size={14} color={wt.statusConsiderText} />
                  <Text style={[styles.passthroughTitle, { color: colors.secondaryText }]}>
                    Missing Wardrobe Pieces
                  </Text>
                </View>
                <Text style={{ fontSize: 12, color: colors.secondaryText, marginTop: 4 }}>
                  {remixState.missingItems.length === 1
                    ? '1 piece from this saved look is no longer in your wardrobe.'
                    : `${remixState.missingItems.length} pieces from this saved look are no longer in your wardrobe.`}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Sticky Actions Footer */}
          <View style={[styles.footer, { borderTopColor: wt.cardBorder, backgroundColor: colors.background }]}>
            {/* Top row: Shuffle, Mannequin, Save */}
            <View style={styles.secondaryActionsRow}>
              <TouchableOpacity
                style={[styles.secBtn, { borderColor: wt.cardBorder, backgroundColor: wt.cardSurfaceSubtle }]}
                onPress={handleShuffleUnlocked}
                accessibilityRole="button"
                accessibilityLabel="Shuffle all unlocked slots"
              >
                <IconSymbol name="shuffle" size={14} color={wt.actionSecondaryText} />
                <Text style={[styles.secBtnText, { color: wt.actionSecondaryText }]}>Shuffle Unlocked</Text>
              </TouchableOpacity>

              {onOpenMannequin && (
                <TouchableOpacity
                  style={[styles.secBtn, { borderColor: wt.cardBorder, backgroundColor: wt.cardSurfaceSubtle }]}
                  onPress={handleMannequin}
                  accessibilityRole="button"
                  accessibilityLabel="Preview remixed outfit on mannequin"
                >
                  <IconSymbol name="sparkles" size={14} color={wt.actionSecondaryText} />
                  <Text style={[styles.secBtnText, { color: wt.actionSecondaryText }]}>Mannequin</Text>
                </TouchableOpacity>
              )}

              {onSave && (
                <TouchableOpacity
                  style={[styles.secBtn, { borderColor: wt.cardBorder, backgroundColor: wt.cardSurfaceSubtle }]}
                  onPress={handleSave}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="Save remixed look to your wardrobe"
                >
                  {saving ? (
                    <ActivityIndicator size="small" color={wt.actionSecondaryText} />
                  ) : (
                    <>
                      <IconSymbol name="heart" size={14} color={wt.actionSecondaryText} />
                      <Text style={[styles.secBtnText, { color: wt.actionSecondaryText }]}>Save Look</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>

            {/* Bottom primary button: Apply Changes */}
            <TouchableOpacity
              style={[styles.applyBtn, { backgroundColor: wt.actionPrimary }]}
              onPress={handleApply}
              accessibilityRole="button"
              accessibilityLabel="Apply remix changes"
            >
              <Text style={[styles.applyBtnText, { color: wt.actionPrimaryText }]}>Apply Changes</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: SCREEN_HEIGHT * 0.88,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitleWrap: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: Spacing.md,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  canvasWrapper: {
    borderRadius: Radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  structureBar: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 3,
  },
  structureTab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    alignItems: 'center',
  },
  structureTabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  slotsContainer: {
    gap: Spacing.sm,
  },
  slotCard: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  slotHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  thumbWrap: {
    width: 50,
    height: 50,
    borderRadius: Radius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  thumbImage: {
    width: 46,
    height: 46,
  },
  slotDetails: {
    flex: 1,
  },
  slotTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  slotName: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  provenancePill: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  slotItemName: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 1,
  },
  slotItemDesc: {
    fontSize: 12,
    marginTop: 1,
  },
  lockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  lockBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  slotControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 2,
  },
  swapToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  swapToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  lockedHintWrap: {
    paddingVertical: 4,
  },
  lockedHintText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  removeOuterwearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  removeOuterwearText: {
    fontSize: 11,
    fontWeight: '500',
  },
  emptyOuterwearRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  smallActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  smallActionBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  replacementsContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
    marginTop: 2,
  },
  emptyReplacementsText: {
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: Spacing.xs,
  },
  replacementsScroll: {
    gap: Spacing.sm,
  },
  replacementPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    padding: Spacing.xs,
    paddingRight: Spacing.md,
    minWidth: 140,
  },
  repThumbWrap: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  repThumb: {
    width: 32,
    height: 32,
  },
  repInfo: {
    flex: 1,
  },
  repName: {
    fontSize: 12,
    fontWeight: '600',
  },
  repScore: {
    fontSize: 10,
    fontWeight: '700',
  },
  passthroughSection: {
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  passthroughHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  passthroughTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  passthroughList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  passthroughChip: {
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  passthroughChipText: {
    fontSize: 11,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  secBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  secBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  applyBtn: {
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    alignItems: 'center',
  },
  applyBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
