import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { Image } from 'expo-image';
// react-native-view-shot is not available on web — share is handled via showToast guidance
import { useRouter } from 'expo-router';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';
import { MannequinSilhouette } from '@/src/components/MannequinSilhouette';
import {
  MannequinCanvasItem as CanvasItemType,
  WardrobeItem,
  createMannequinItem,
} from '@/src/utils/mannequinConfig';
import { removeBackgroundWeb } from '@/src/utils/webBackgroundRemoval';
import { useSizingProfile } from '@/src/hooks/useSizingProfile';
import { buildSilhouetteParams } from '@/src/utils/bodySilhouette';
import { gradeOutfit, StylistCritique } from '@/src/utils/aiStylistAdvisor';
import { StylistCritiqueModal } from './StylistCritiqueModal';
import { MannequinCanvasItem } from './MannequinCanvasItem';

// Enable layout animation for Android (Old Architecture only)
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental && !(globalThis as any).nativeFabricUIManager) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CANVAS_WIDTH = SCREEN_WIDTH - 32;
const CANVAS_HEIGHT = 450;

// The floating tab bar is ~68px + bottom inset (~10-20px) + 8px offset.
// We need enough bottom padding so nothing hides behind it.
const TAB_BAR_CLEARANCE = 100;

const CATEGORIES = ['All', 'Top', 'Bottom', 'Dress', 'Outerwear', 'Shoes', 'Accessory'] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

export const CANVAS_BACKDROPS = [
  { id: 'white', label: 'Studio White', color: '#FFFFFF', isDark: false },
  { id: 'cream', label: 'Warm Cream', color: '#F7F3E9', isDark: false },
  { id: 'charcoal', label: 'Noir Black', color: '#1A1A1C', isDark: true },
  { id: 'orange', label: 'Sunset Terracotta', color: '#E07A5F', isDark: true },
  { id: 'red', label: 'Crimson Red', color: '#8B1E22', isDark: true },
  { id: 'yellow', label: 'Warm Mustard', color: '#E9B949', isDark: false },
  { id: 'sage', label: 'Sage Olive', color: '#6A7F66', isDark: true },
  { id: 'navy', label: 'Midnight Navy', color: '#1D2A44', isDark: true },
  { id: 'blush', label: 'Rose Blush', color: '#E8C5C8', isDark: false },
];

interface Props {
  wardrobeItems: WardrobeItem[];
  onRefreshWardrobe: () => void;
}

export function MannequinView({ wardrobeItems, onRefreshWardrobe }: Props) {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const isDark = theme === 'dark';
  const router = useRouter();
  const { session } = useAuth();
  const { showToast } = useToast();

  const canvasRef = useRef<View>(null);

  // Sizing Profile & Silhouette Proportions
  const { measurements, heightCm, ready: sizingReady } = useSizingProfile();
  const [silhouetteMode, setSilhouetteMode] = useState<'default' | 'proportions'>('default');

  const bodyParams = useMemo(() => {
    return buildSilhouetteParams(measurements, heightCm);
  }, [measurements, heightCm]);

  // Canvas & Drawer States
  const [canvasItems, setCanvasItems] = useState<CanvasItemType[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isDrawerMinimized, setIsDrawerMinimized] = useState<boolean>(false);
  const [canvasBgColor, setCanvasBgColor] = useState<string>(isDark ? '#1A1A1C' : '#FFFFFF');

  // Filter State
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>('All');

  // Save Modal State
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [lookName, setLookName] = useState('');
  const [saving, setSaving] = useState(false);

  // Load Saved Modal State
  const [loadModalVisible, setLoadModalVisible] = useState(false);
  const [savedLooks, setSavedLooks] = useState<any[]>([]);
  const [loadingLooks, setLoadingLooks] = useState(false);

  // Stylist Critique Modal State
  const [stylistModalVisible, setStylistModalVisible] = useState(false);

  const wardrobeLookup = useMemo(() => {
    return Object.fromEntries(wardrobeItems.map((w) => [w.id, w]));
  }, [wardrobeItems]);

  const activeCritique = useMemo(() => {
    return gradeOutfit(canvasItems, wardrobeLookup);
  }, [canvasItems, wardrobeLookup]);

  // Filtered wardrobe items for the drawer
  const filteredItems = useMemo(() => {
    if (selectedCategory === 'All') return wardrobeItems;
    return wardrobeItems.filter(
      (item) => (item.garment_type || '').toLowerCase() === selectedCategory.toLowerCase()
    );
  }, [wardrobeItems, selectedCategory]);

  const activeOnCanvasIds = useMemo(() => {
    return new Set(canvasItems.map((i) => i.wardrobe_item_id));
  }, [canvasItems]);

  const activeSelectedItem = useMemo(() => {
    return canvasItems.find((i) => i.id === selectedItemId) || null;
  }, [canvasItems, selectedItemId]);

  // Toggle drawer with smooth animation
  const toggleDrawer = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsDrawerMinimized((prev) => !prev);
  }, []);

  // Handle adding an item to the canvas with auto background removal
  const handleAddItemToCanvas = useCallback(
    async (wardrobeItem: WardrobeItem) => {
      const maxZ = canvasItems.reduce((max, i) => Math.max(max, i.zIndex), 0);
      let finalImageUrl = wardrobeItem.image_url || '';

      // On web, attempt client-side background removal
      if (Platform.OS === 'web' && finalImageUrl) {
        try {
          finalImageUrl = await removeBackgroundWeb(finalImageUrl);
        } catch {
          // fallback to original
        }
      }

      const itemWithProcessedImg = { ...wardrobeItem, image_url: finalImageUrl };
      const newItem = createMannequinItem(itemWithProcessedImg, maxZ);
      setCanvasItems((prev) => [...prev, newItem]);
      setSelectedItemId(newItem.id);
      showToast(`Added ${newItem.name} to mannequin`, 'info');
    },
    [canvasItems, showToast]
  );

  // Handle transform updates from gesture interactions
  const handleUpdateTransform = useCallback(
    (id: string, updates: { x: number; y: number; scale: number; rotation: number }) => {
      setCanvasItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
      );
    },
    []
  );

  // Scale (Enlarge / Shrink)
  const handleScaleChange = useCallback((id: string, delta: number) => {
    setCanvasItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const newScale = Math.max(0.25, Math.min(3.5, item.scale + delta));
        return { ...item, scale: Math.round(newScale * 100) / 100 };
      })
    );
  }, []);

  // Rotate item
  const handleRotateChange = useCallback((id: string, deltaDeg: number) => {
    setCanvasItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        return { ...item, rotation: (item.rotation + deltaDeg) % 360 };
      })
    );
  }, []);

  // Remove from canvas
  const handleRemoveFromCanvas = useCallback((id: string) => {
    setCanvasItems((prev) => prev.filter((item) => item.id !== id));
    setSelectedItemId((current) => (current === id ? null : current));
  }, []);

  // Bring forward
  const handleBringForward = useCallback((id: string) => {
    setCanvasItems((prev) => {
      const maxZ = prev.reduce((max, i) => Math.max(max, i.zIndex), 0);
      return prev.map((item) => (item.id === id ? { ...item, zIndex: maxZ + 1 } : item));
    });
  }, []);

  // Send backward
  const handleSendBackward = useCallback((id: string) => {
    setCanvasItems((prev) => {
      const minZ = prev.reduce((min, i) => Math.min(min, i.zIndex), 1);
      return prev.map((item) => (item.id === id ? { ...item, zIndex: Math.max(0, minZ - 1) } : item));
    });
  }, []);

  // Clear all
  const handleClearCanvas = () => {
    if (canvasItems.length === 0) return;
    if (Platform.OS === 'web') {
      const ok = typeof window !== 'undefined' ? window.confirm('Clear all garments from the mannequin?') : true;
      if (ok) { setCanvasItems([]); setSelectedItemId(null); }
    } else {
      Alert.alert('Clear Mannequin', 'Clear all garments from the mannequin?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear All', style: 'destructive', onPress: () => { setCanvasItems([]); setSelectedItemId(null); } },
      ]);
    }
  };

  // Share — screenshot capture is not supported on web; guide users to save instead
  const handleShareLook = async () => {
    if (canvasItems.length === 0) { showToast('Add items first.', 'info'); return; }
    showToast('Save your look first, then share from Saved Outfits!', 'info');
  };

  // Save
  const handleSaveLook = async () => {
    if (!session?.user?.id) return;
    if (canvasItems.length === 0) { showToast('Add at least one item.', 'error'); return; }

    const name = lookName.trim() || 'My Mannequin Look';
    setSaving(true);
    try {
      // Embed both standard boutique fields AND spatial canvas coordinates into items JSONB
      const itemsPayload = canvasItems.map((item) => ({
        slot: (item.garment_type || 'Top').toLowerCase(),
        product_id: item.wardrobe_item_id,
        image_url: item.image_url,
        name: item.name,
        garment_type: item.garment_type,
        owned: true,
        x: item.x,
        y: item.y,
        scale: item.scale,
        rotation: item.rotation,
        z_index: item.zIndex,
        canvas_bg: canvasBgColor,
      }));

      // Try inserting with canvas_layout first; if column not found (PGRST204), fallback to standard items JSON
      let insertError = null;
      try {
        const { error } = await supabase.from('saved_outfits').insert({
          user_id: session.user.id,
          name,
          items: itemsPayload,
          canvas_layout: itemsPayload,
        } as any);
        insertError = error;
      } catch (e) {
        insertError = e;
      }

      if (insertError) {
        // Fallback without canvas_layout column (stores all spatial layout inside items JSONB)
        const { error: fallbackError } = await supabase.from('saved_outfits').insert({
          user_id: session.user.id,
          name,
          items: itemsPayload,
        } as any);

        if (fallbackError) throw fallbackError;
      }

      setSaveModalVisible(false);
      setLookName('');
      showToast(`Saved "${name}" ✨`, 'success');
      onRefreshWardrobe();
    } catch (err: any) {
      console.error('Error saving mannequin look:', err);
      showToast(err.message || 'Could not save look.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Load modal
  const handleOpenLoadModal = async () => {
    if (!session?.user?.id) return;
    setLoadModalVisible(true);
    setLoadingLooks(true);
    try {
      const { data, error } = await supabase
        .from('saved_outfits').select('*')
        .eq('user_id', session.user.id)
        .eq('deleted', false)
        .order('created_at', { ascending: false }).limit(30);
      if (error) throw error;
      setSavedLooks(data || []);
    } catch (err) {
      console.error('Error loading saved outfits:', err);
      showToast('Could not load saved outfits.', 'error');
    } finally {
      setLoadingLooks(false);
    }
  };

  // Load a saved look
  const handleLoadSavedLook = (outfit: any) => {
    try {
      const layoutSource = Array.isArray(outfit.canvas_layout) && outfit.canvas_layout.length > 0
        ? outfit.canvas_layout
        : Array.isArray(outfit.items)
        ? outfit.items
        : [];

      if (layoutSource.length > 0) {
        const savedBg = layoutSource.find((s: any) => s.canvas_bg)?.canvas_bg;
        if (savedBg) setCanvasBgColor(savedBg);

        const reconstructed: CanvasItemType[] = layoutSource.map((s: any, idx: number) => {
          const matchingWardrobe = wardrobeItems.find((w) => w.id === (s.wardrobe_item_id || s.product_id));
          return {
            id: `loaded_${s.wardrobe_item_id || s.product_id || idx}_${Date.now()}_${idx}`,
            wardrobe_item_id: s.wardrobe_item_id || s.product_id || '',
            image_url: s.image_url || matchingWardrobe?.image_url || '',
            name: s.name || matchingWardrobe?.sub_category || matchingWardrobe?.category || 'Item',
            garment_type: s.garment_type || matchingWardrobe?.garment_type || s.slot || 'Top',
            x: typeof s.x === 'number' ? s.x : 0,
            y: typeof s.y === 'number' ? s.y : (0.16 + idx * 0.2),
            scale: typeof s.scale === 'number' ? s.scale : 1.0,
            rotation: typeof s.rotation === 'number' ? s.rotation : 0,
            zIndex: typeof s.z_index === 'number' ? s.z_index : (idx + 1),
          };
        });
        setCanvasItems(reconstructed);
      }
      setLoadModalVisible(false);
      showToast(`Loaded "${outfit.name}"`, 'success');
    } catch (e) {
      console.error('Failed to load look:', e);
      showToast('Failed to load look.', 'error');
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Top Action Toolbar ── */}
      <View style={styles.toolbar}>
        <View style={styles.toolbarRow}>
          <TouchableOpacity
            style={[styles.toolBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleOpenLoadModal}
          >
            <IconSymbol name="folder.fill" size={14} color={colors.tint} />
            <Text style={[styles.toolBtnText, { color: colors.text }]}>Load</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: canvasItems.length === 0 ? 0.4 : 1 }]}
            onPress={handleClearCanvas}
            disabled={canvasItems.length === 0}
          >
            <IconSymbol name="trash" size={14} color={colors.error || '#EF4444'} />
            <Text style={[styles.toolBtnText, { color: colors.text }]}>Clear</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.toolBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: canvasItems.length === 0 ? 0.4 : 1 }]}
            onPress={handleShareLook}
            disabled={canvasItems.length === 0}
          >
            <IconSymbol name="square.and.arrow.up" size={14} color={colors.tint} />
            <Text style={[styles.toolBtnText, { color: colors.text }]}>Share</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.stylistBtn,
              {
                backgroundColor: colors.tint + '18',
                borderColor: colors.tint + '60',
                opacity: canvasItems.length === 0 ? 0.4 : 1,
              },
            ]}
            onPress={() => {
              if (canvasItems.length === 0) {
                showToast('Add garments to the mannequin first!', 'info');
              } else {
                setStylistModalVisible(true);
              }
            }}
            disabled={canvasItems.length === 0}
            accessibilityRole="button"
            accessibilityLabel="AI Stylist critique outfit"
          >
            <IconSymbol name="sparkles" size={13} color={colors.tint} />
            <Text style={[styles.stylistBtnText, { color: colors.tint }]}>Stylist</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: colors.tint, opacity: canvasItems.length === 0 ? 0.4 : 1 }]}
            onPress={() => canvasItems.length > 0 && setSaveModalVisible(true)}
            disabled={canvasItems.length === 0}
          >
            <IconSymbol name="heart.fill" size={13} color={colors.onTint} />
            <Text style={[styles.saveBtnText, { color: colors.onTint }]}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Studio Backdrop Swatches ── */}
      <View style={styles.backdropBar}>
        <View style={styles.backdropTitleWrap}>
          <IconSymbol name="paintpalette.fill" size={12} color={colors.tint} />
          <Text style={[styles.backdropLabel, { color: colors.secondaryText }]}>Backdrop:</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.backdropScroll}
        >
          {CANVAS_BACKDROPS.map((b) => {
            const active = canvasBgColor === b.color;
            return (
              <TouchableOpacity
                key={b.id}
                style={[
                  styles.backdropSwatch,
                  { backgroundColor: b.color, borderColor: active ? colors.tint : colors.border },
                  active && styles.backdropSwatchActive,
                ]}
                onPress={() => setCanvasBgColor(b.color)}
                accessibilityRole="button"
                accessibilityLabel={`Backdrop ${b.label}`}
              >
                {active && (
                  <IconSymbol
                    name="checkmark"
                    size={10}
                    color={b.isDark ? '#FFFFFF' : '#1A1A1A'}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Mannequin Silhouette Proportions Toggle ── */}
      <View style={styles.silhouetteBar}>
        <View style={styles.backdropTitleWrap}>
          <IconSymbol name="figure.stand" size={13} color={colors.tint} />
          <Text style={[styles.backdropLabel, { color: colors.secondaryText }]}>Silhouette:</Text>
        </View>
        <View style={styles.silhouetteToggleGroup}>
          <TouchableOpacity
            style={[
              styles.silhouettePill,
              { backgroundColor: silhouetteMode === 'default' ? colors.tint : colors.card, borderColor: silhouetteMode === 'default' ? colors.tint : colors.border }
            ]}
            onPress={() => setSilhouetteMode('default')}
            activeOpacity={0.7}
          >
            <Text style={[styles.silhouettePillText, { color: silhouetteMode === 'default' ? colors.onTint : colors.text }]}>
              Classic Form
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.silhouettePill,
              { backgroundColor: silhouetteMode === 'proportions' ? colors.tint : colors.card, borderColor: silhouetteMode === 'proportions' ? colors.tint : colors.border }
            ]}
            onPress={() => {
              if (sizingReady && bodyParams.isCustomProportioned) {
                setSilhouetteMode('proportions');
                showToast('Applied your real body measurements ✨', 'info');
              } else {
                Alert.alert(
                  'Custom Body Measurements',
                  'You haven\'t set up your body measurements yet. Would you like to enter them now to enable custom mannequin proportions?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Enter Measurements', onPress: () => router.push('/profile/measurements') }
                  ]
                );
              }
            }}
            activeOpacity={0.7}
          >
            <IconSymbol
              name="sparkles"
              size={11}
              color={silhouetteMode === 'proportions' ? colors.onTint : colors.tint}
              style={{ marginRight: 3 }}
            />
            <Text style={[styles.silhouettePillText, { color: silhouetteMode === 'proportions' ? colors.onTint : colors.text }]}>
              My Body {sizingReady ? '✨' : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Size & Layer Controls (when item selected) ── */}
      {selectedItemId && activeSelectedItem && (
        <View style={[styles.layerToolbar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.controlGroup}>
            <Text style={[styles.controlLabel, { color: colors.secondaryText }]}>Size:</Text>
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: colors.tint }]}
              onPress={() => handleScaleChange(selectedItemId, 0.10)}
              accessibilityLabel="Enlarge"
            >
              <Text style={[styles.controlBtnText, { color: colors.onTint }]}>+</Text>
            </TouchableOpacity>
            <Text style={[styles.scaleValue, { color: colors.text }]}>
              {Math.round(activeSelectedItem.scale * 100)}%
            </Text>
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: colors.tint }]}
              onPress={() => handleScaleChange(selectedItemId, -0.10)}
              accessibilityLabel="Shrink"
            >
              <Text style={[styles.controlBtnText, { color: colors.onTint }]}>−</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.controlGroup}>
            {/* Rotate */}
            <TouchableOpacity
              style={[styles.layerBtn, { backgroundColor: colors.surface }]}
              onPress={() => handleRotateChange(selectedItemId, 15)}
              accessibilityLabel="Rotate"
            >
              <IconSymbol name="arrow.clockwise" size={12} color={colors.text} />
            </TouchableOpacity>

            {/* Layer order */}
            <TouchableOpacity
              style={[styles.layerBtn, { backgroundColor: colors.surface }]}
              onPress={() => handleBringForward(selectedItemId)}
              accessibilityLabel="Bring forward"
            >
              <IconSymbol name="arrow.up" size={11} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.layerBtn, { backgroundColor: colors.surface }]}
              onPress={() => handleSendBackward(selectedItemId)}
              accessibilityLabel="Send back"
            >
              <IconSymbol name="arrow.down" size={11} color={colors.text} />
            </TouchableOpacity>

            {/* Remove */}
            <TouchableOpacity
              style={[styles.layerBtn, { backgroundColor: 'rgba(239,68,68,0.12)' }]}
              onPress={() => handleRemoveFromCanvas(selectedItemId)}
              accessibilityLabel="Remove"
            >
              <IconSymbol name="xmark" size={11} color="#EF4444" />
            </TouchableOpacity>

            {/* Done / Deselect */}
            <TouchableOpacity
              style={[styles.doneBtn, { backgroundColor: colors.tint }]}
              onPress={() => setSelectedItemId(null)}
              accessibilityLabel="Done styling"
            >
              <IconSymbol name="checkmark" size={10} color={colors.onTint} />
              <Text style={[styles.doneBtnText, { color: colors.onTint }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Mannequin Canvas ── */}
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => setSelectedItemId(null)}
        style={[styles.canvasOuter, { borderColor: colors.border, backgroundColor: canvasBgColor }]}
      >
        <View
          ref={canvasRef}
          style={[styles.canvasStage, { width: CANVAS_WIDTH, height: CANVAS_HEIGHT }]}
        >
          {/* Dress-form silhouette (Classic or Custom Proportioned) */}
          <MannequinSilhouette
            color={isDark ? '#C9B99A' : '#D4C5B0'}
            opacity={isDark ? 0.85 : 1}
            mode={silhouetteMode}
            bodyParams={bodyParams}
          />

          {/* Canvas items */}
          {canvasItems.map((item) => (
            <MannequinCanvasItem
              key={item.id}
              item={item}
              canvasWidth={CANVAS_WIDTH}
              canvasHeight={CANVAS_HEIGHT}
              isSelected={selectedItemId === item.id}
              onSelect={setSelectedItemId}
              onUpdateTransform={handleUpdateTransform}
              onRemove={handleRemoveFromCanvas}
              onBringForward={handleBringForward}
              onScaleChange={handleScaleChange}
              onRotateChange={handleRotateChange}
            />
          ))}
        </View>

        {canvasItems.length === 0 && (
          <View style={[styles.canvasEmptyHint, { pointerEvents: 'none' } as any]}>
            <IconSymbol name="hand.tap" size={22} color={colors.secondaryText} />
            <Text style={[styles.emptyHintText, { color: colors.secondaryText }]}>
              Tap garments below to dress the mannequin
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* ── Collapsible Wardrobe Drawer ── */}
      <View style={styles.drawerSection}>
        {/* Toggle Bar (always visible) */}
        <TouchableOpacity
          style={[styles.drawerHandle, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={toggleDrawer}
          activeOpacity={0.7}
        >
          <View style={styles.drawerHandleInner}>
            {/* Grab indicator */}
            <View style={[styles.grabIndicator, { backgroundColor: colors.secondaryText }]} />
          </View>
          <View style={styles.drawerTitleRow}>
            <IconSymbol name="tshirt" size={15} color={colors.tint} />
            <Text style={[styles.drawerTitle, { color: colors.text }]}>
              {isDrawerMinimized ? 'Show Wardrobe' : 'Hide Wardrobe'}
            </Text>
            <IconSymbol
              name={isDrawerMinimized ? 'chevron.up' : 'chevron.down'}
              size={14}
              color={colors.secondaryText}
            />
          </View>
        </TouchableOpacity>

        {/* Expanded Drawer Content */}
        {!isDrawerMinimized && (
          <View style={styles.drawerContent}>
            {/* Category Filter Chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryChips}
            >
              {CATEGORIES.map((cat) => {
                const active = selectedCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.chip,
                      { backgroundColor: active ? colors.tint : colors.card, borderColor: active ? colors.tint : colors.border },
                    ]}
                    onPress={() => setSelectedCategory(cat)}
                  >
                    <Text style={[styles.chipText, { color: active ? colors.onTint : colors.text }]}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Garment Cards */}
            {filteredItems.length === 0 ? (
              <View style={[styles.emptyDrawer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <IconSymbol name="tshirt" size={24} color={colors.secondaryText} />
                <Text style={[styles.emptyDrawerText, { color: colors.secondaryText }]}>
                  {wardrobeItems.length === 0
                    ? 'Your wardrobe is empty'
                    : `No ${selectedCategory.toLowerCase()} items`}
                </Text>
                <TouchableOpacity
                  style={[styles.addBtn, { backgroundColor: colors.tint }]}
                  onPress={() => router.push('/wardrobe/add-item')}
                >
                  <Text style={[styles.addBtnText, { color: colors.onTint }]}>+ Add Garment</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                horizontal
                data={filteredItems}
                keyExtractor={(item) => item.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.garmentScroll}
                renderItem={({ item }) => {
                  const onCanvas = activeOnCanvasIds.has(item.id);
                  return (
                    <TouchableOpacity
                      style={[
                        styles.garmentCard,
                        { backgroundColor: colors.card, borderColor: onCanvas ? colors.tint : colors.border },
                        onCanvas && { borderWidth: 2 },
                      ]}
                      onPress={() => handleAddItemToCanvas(item)}
                      activeOpacity={0.7}
                    >
                      <Image
                        source={{ uri: item.image_url || undefined }}
                        style={styles.garmentImg}
                        contentFit="contain"
                      />
                      <Text style={[styles.garmentLabel, { color: colors.text }]} numberOfLines={1}>
                        {item.garment_type || item.category || 'Item'}
                      </Text>
                      {onCanvas && (
                        <View style={[styles.checkBadge, { backgroundColor: colors.tint }]}>
                          <IconSymbol name="checkmark" size={9} color={colors.onTint} />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        )}
      </View>

      {/* ── Save Modal ── */}
      {saveModalVisible && (
      <Modal visible={saveModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Save Look</Text>
            <Text style={[styles.modalSub, { color: colors.secondaryText }]}>
              Name this styled outfit to save it.
            </Text>
            <TextInput
              keyboardAppearance={theme}
              style={[styles.nameInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface }]}
              placeholder="e.g. Elegant Gala Outfit"
              placeholderTextColor={colors.secondaryText}
              value={lookName}
              onChangeText={setLookName}
              autoFocus
              maxLength={40}
            />
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[styles.modalBtn, { borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => setSaveModalVisible(false)}
                disabled={saving}
              >
                <Text style={[styles.modalBtnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.tint }]}
                onPress={handleSaveLook}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator size="small" color={colors.onTint} />
                  : <Text style={[styles.modalBtnText, { color: colors.onTint, fontWeight: '700' }]}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      )}

      {/* ── Load Modal ── */}
      {loadModalVisible && (
      <Modal visible={loadModalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.loadContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.loadHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.loadTitle, { color: colors.text }]}>Load Styled Look</Text>
            <TouchableOpacity onPress={() => setLoadModalVisible(false)} hitSlop={8}>
              <IconSymbol name="xmark" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>
          {loadingLooks ? (
            <View style={styles.loadCenter}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          ) : savedLooks.length === 0 ? (
            <View style={styles.loadCenter}>
              <IconSymbol name="hanger" size={40} color={colors.secondaryText} />
              <Text style={[styles.loadEmpty, { color: colors.secondaryText }]}>
                No saved outfits found. Style a look and save it!
              </Text>
            </View>
          ) : (
            <FlatList
              data={savedLooks}
              keyExtractor={(i) => i.id}
              contentContainerStyle={{ padding: 20 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.savedCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => handleLoadSavedLook(item)}
                  activeOpacity={0.8}
                >
                  <View style={styles.savedHeader}>
                    <Text style={[styles.savedName, { color: colors.text }]}>{item.name}</Text>
                    {item.canvas_layout?.length > 0 && (
                      <View style={[styles.layoutTag, { backgroundColor: colors.tint + '22' }]}>
                        <Text style={[styles.layoutTagText, { color: colors.tint }]}>Canvas</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.savedThumbs}>
                    {(item.items || []).slice(0, 5).map((g: any, i: number) => (
                      <Image key={i} source={{ uri: g.image_url }} style={styles.savedThumb} contentFit="cover" />
                    ))}
                  </View>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      </Modal>
      )}
      {/* ── Stylist Critique Modal ── */}
      <StylistCritiqueModal
        visible={stylistModalVisible}
        critique={activeCritique}
        onClose={() => setStylistModalVisible(false)}
        onSaveLook={() => setSaveModalVisible(true)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  /* ── Toolbar ── */
  toolbar: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  toolBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  stylistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  stylistBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.md,
    marginLeft: 'auto',
  },
  saveBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },

  /* ── Studio Backdrop Swatches ── */
  backdropBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 6,
    gap: 8,
  },
  backdropTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backdropLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  backdropScroll: {
    gap: 6,
    alignItems: 'center',
    paddingRight: 16,
  },
  backdropSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdropSwatchActive: {
    borderWidth: 2,
    transform: [{ scale: 1.15 }],
  },

  /* ── Silhouette Form Toggle ── */
  silhouetteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  silhouetteToggleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  silhouettePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  silhouettePillText: {
    fontSize: 11,
    fontWeight: '600',
  },

  /* ── Layer / Size Controls ── */
  layerToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  controlGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  controlLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  controlBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBtnText: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 16,
  },
  scaleValue: {
    fontSize: 11,
    fontWeight: '700',
    minWidth: 32,
    textAlign: 'center',
  },
  layerBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  doneBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },

  /* ── Canvas ── */
  canvasOuter: {
    marginHorizontal: 16,
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasStage: {
    position: 'relative',
    overflow: 'hidden',
  },
  canvasEmptyHint: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 4,
  },
  emptyHintText: {
    fontSize: 12,
    fontWeight: '600',
  },

  /* ── Drawer ── */
  drawerSection: {
    marginTop: 8,
  },
  drawerHandle: {
    marginHorizontal: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingBottom: 8,
    overflow: 'hidden',
  },
  drawerHandleInner: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
  },
  grabIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    opacity: 0.35,
  },
  drawerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  drawerTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  drawerContent: {
    marginTop: 6,
  },
  categoryChips: {
    paddingHorizontal: 16,
    gap: 6,
    marginBottom: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  garmentScroll: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 8,
  },
  garmentCard: {
    width: 88,
    height: 112,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: 4,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  garmentImg: {
    width: 74,
    height: 74,
    borderRadius: 6,
  },
  garmentLabel: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  checkBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyDrawer: {
    marginHorizontal: 16,
    padding: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    gap: 6,
  },
  emptyDrawerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  addBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    marginTop: 4,
  },
  addBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },

  /* ── Modals ── */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: 20,
  },
  modalTitle: {
    ...Type.subtitle,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalSub: {
    ...Type.caption,
    marginBottom: 16,
  },
  nameInput: {
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 16,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: Radius.md,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: {
    fontSize: 14,
  },

  /* ── Load Modal ── */
  loadContainer: {
    flex: 1,
  },
  loadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  loadTitle: {
    ...Type.subtitle,
    fontWeight: '700',
  },
  loadCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 10,
  },
  loadEmpty: {
    ...Type.body,
    textAlign: 'center',
    marginTop: 4,
  },
  savedCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  savedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  savedName: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
  layoutTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  layoutTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  savedThumbs: {
    flexDirection: 'row',
    gap: 6,
  },
  savedThumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
  },
});
