import { notifySuccess } from '@/src/utils/haptics';
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  Switch,
  TextInput,
  Dimensions,
  Platform,
  KeyboardAvoidingView,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { removeBackground } from '@six33/react-native-bg-removal';
import { removeBackgroundWeb } from '@/src/utils/webBackgroundRemoval';
import { ColorOption, DEFAULT_COLOR_OPTIONS, fetchColorOptions } from '@/src/utils/colorOptions';
import { useToast } from '@/src/context/ToastContext';
import { ImageCropModal } from '@/src/components/ImageCropModal';
import { resolveImageFileInfo } from '@/src/utils/imageUpload';
import { isOnline } from '@/src/services/offlineSync';

const { width } = Dimensions.get('window');

// Fixed boutique-category vocabulary for tagging a user's own wardrobe items;
// intentionally distinct from the products `categories` taxonomy.
const CATEGORIES = [
  'A-Line Gowns', 'Accessories', 'Ball Gowns', 'Bridal & Wedding', 'Bridesmaid Dresses',
  'Classic Ball Gowns', 'Classic Suits', 'Clutches & Bags', 'Cocktail & Party', 'Evening Wear',
  'Fine Jewelry', 'Formal Blazers', 'Formal Slip Dresses', 'Mermaid Gowns', 'Midi Dresses',
  'Mini Dresses', 'Mother of the Bride', 'Off-Shoulder Dresses', 'Princess Gowns',
  'Sequin & Sparkle', 'Suits & Tuxedos', 'Tuxedos', 'Veils & Tiaras', 'Wedding Gowns'
];

// Basic garment bucket, distinct from the boutique Category above -- powers
// gap analysis and outfit-slot filtering, which need a small fixed vocabulary
// rather than the long boutique category list.
const GARMENT_TYPES = ['Top', 'Bottom', 'Dress', 'Outerwear', 'Shoes', 'Accessory'] as const;
type GarmentType = (typeof GARMENT_TYPES)[number];

export default function AddWardrobeItemScreen() {
  const { showToast } = useToast();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();
  const { session } = useAuth();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [rawPickedUri, setRawPickedUri] = useState<string | null>(null);
  const [rawPickedSize, setRawPickedSize] = useState<{ width: number; height: number } | null>(null);
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [processedImageUri, setProcessedImageUri] = useState<string | null>(null);
  const [isProcessingBg, setIsProcessingBg] = useState<boolean>(false);
  
  const [category, setCategory] = useState<string>('Evening Wear');
  const [garmentType, setGarmentType] = useState<GarmentType | null>(null);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [colorOptions, setColorOptions] = useState<ColorOption[]>(DEFAULT_COLOR_OPTIONS);
  const [subCategory, setSubCategory] = useState<string>('');
  const [removeBg, setRemoveBg] = useState<boolean>(true);
  const [categoryModalVisible, setCategoryModalVisible] = useState<boolean>(false);
  const [categorySearch, setCategorySearch] = useState<string>('');
  
  const [saving, setSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  useEffect(() => {
    fetchColorOptions().then(setColorOptions);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const processImage = async () => {
      if (!imageUri) {
        setProcessedImageUri(null);
        return;
      }
      
      if (!removeBg) {
        setProcessedImageUri(null);
        return;
      }

      setIsProcessingBg(true);
      try {
        if (Platform.OS === 'web') {
          const webCutoutUri = await removeBackgroundWeb(imageUri);
          if (isMounted && webCutoutUri) {
            setProcessedImageUri(webCutoutUri);
          }
        } else {
          // Native background removal on iOS/Android
          const bgRemovedUri = await removeBackground(imageUri);
          if (isMounted && bgRemovedUri) {
            setProcessedImageUri(bgRemovedUri);
          }
        }
      } catch (e) {
        console.warn('Background removal failed, falling back to original image:', e);
        if (isMounted) {
          setProcessedImageUri(null);
        }
      } finally {
        if (isMounted) setIsProcessingBg(false);
      }
    };

    processImage();

    return () => {
      isMounted = false;
    };
  }, [imageUri, removeBg]);

  const pickImage = async (useCamera: boolean) => {
    try {
      let result;
      if (useCamera) {
        const cameraPerm = await ImagePicker.requestCameraPermissionsAsync();
        if (!cameraPerm.granted) {
          showToast('Camera access required to snap photos.', 'error');
          return;
        }
        // allowsEditing intentionally off: the native OS crop screen it
        // triggers doesn't reliably render its confirm/cancel toolbar on
        // some Android OEM skins when the crop box is this close to
        // full-screen height, leaving users with no visible way to proceed.
        // ImageCropModal below replaces it with our own View hierarchy.
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.9,
        });
      } else {
        const libraryPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!libraryPerm.granted) {
          showToast('Photo library access required to select photos.', 'error');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.9,
        });
      }

      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        setRawPickedUri(asset.uri);
        if (asset.width && asset.height) {
          setRawPickedSize({ width: asset.width, height: asset.height });
        } else {
          setRawPickedSize(null);
        }
        setCropModalVisible(true);
      }
    } catch (e) {
      console.error('Error picking image:', e);
      showToast('Could not open your photos. Please try again.', 'error');
    }
  };

  const handleCropCancel = () => {
    setCropModalVisible(false);
    setRawPickedUri(null);
    setRawPickedSize(null);
  };

  const handleCropConfirm = (croppedUri: string) => {
    setImageUri(croppedUri);
    setCropModalVisible(false);
    setRawPickedUri(null);
    setRawPickedSize(null);
  };

  const toggleColor = (colorName: string) => {
    setSelectedColors((prev) =>
      prev.includes(colorName)
        ? prev.filter((c) => c !== colorName)
        : [...prev, colorName]
    );
  };

  // Bounds an upload/DB call so a dropped connection surfaces a clear,
  // recoverable error instead of leaving the screen stuck on "Uploading to
  // storage..." forever -- confirmed live, with no timeout here the button
  // never came back even after the request had no hope of completing.
  const withTimeout = <T,>(promise: PromiseLike<T>, ms: number): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const err: any = new Error('Request timed out.');
        err.isTimeout = true;
        reject(err);
      }, ms);
    });
    return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => clearTimeout(timer));
  };

  const handleSave = async () => {
    if (!session?.user?.id) {
      showToast('Sign in required to add items.', 'error');
      return;
    }
    if (!imageUri) {
      showToast('Select or capture a photo first.', 'info');
      return;
    }
    if (!garmentType) {
      showToast('Select a garment type (Top, Bottom, etc.) for wardrobe insights.', 'info');
      return;
    }

    setSaving(true);
    try {
      if (!(await isOnline())) {
        const offlineErr: any = new Error('No internet connection. Check your connection and try again.');
        offlineErr.isOffline = true;
        throw offlineErr;
      }

      // Re-fetch the session fresh rather than trusting the `session` from
      // AuthContext, which is React state and can be a render or two behind
      // supabase-js's actual current token (e.g. right after a background
      // refresh). Using a stale user id here doesn't fail loudly -- it just
      // silently mismatches auth.uid() server-side and the insert is
      // rejected with a bare "new row violates row-level security policy",
      // which is what "it just fails, no clear reason" looks like from the
      // user's side. Confirmed live: the exact same insert succeeds with a
      // freshly-fetched session, so RLS itself is not the problem -- staleness
      // at the call site is.
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      if (!freshSession?.user?.id) {
        const authErr: any = new Error('Your session expired. Please log in again to add items.');
        authErr.isAuthStale = true;
        throw authErr;
      }
      const userId = freshSession.user.id;

      // Use processed image if background removal was enabled and successful
      let finalUri = (removeBg && processedImageUri) ? processedImageUri : imageUri;

      setStatusMessage('Uploading to storage...');

      // Read the bytes ourselves rather than handing Supabase a FormData wrapper
      // around a file:// uri -- that silently produced a zero-byte body and
      // failed with "Network request failed" on Android, the same bug that broke
      // reservation receipts.
      //
      // fetch + arrayBuffer rather than the decode(base64) used for receipts and
      // chat images: those have base64 in hand from the image picker, but this
      // uri may come from removeBackground(), which returns only a path.
      const response = await fetch(finalUri);
      if (!response.ok && response.status !== 0) {
        throw new Error('Unable to read selected image.');
      }
      const headerContentType = response.headers?.get('content-type');
      const bytes = await response.arrayBuffer();
      if (!bytes || bytes.byteLength === 0) {
        throw new Error('Selected image file is empty.');
      }

      const { contentType, ext } = resolveImageFileInfo(finalUri, headerContentType);

      // upsert:true was tried here and reverted -- confirmed live that it
      // makes Supabase Storage's own RLS check on storage.objects fail
      // UNCONDITIONALLY (statusCode 403, "new row violates row-level
      // security policy"), even for a freshly-authenticated owner uploading
      // to their own folder. The bucket's policies only grant INSERT/UPDATE/
      // DELETE, not the SELECT upsert needs internally to check whether the
      // object already exists, so upsert:true fails RLS before it can ever
      // write. upsert:false (plain insert) is unaffected and is what every
      // successful upload in this bucket has always used.
      //
      // A fresh filename per attempt (not one shared filename retried) means
      // a retry can never hit a "conflict" from the previous attempt having
      // silently succeeded server-side -- the only cost is a harmless,
      // never-referenced orphaned object in that rare case, not a failure.
      const attemptUpload = () => {
        const fileName = `${userId}/${Date.now()}.${ext}`;
        return withTimeout(
          supabase.storage.from('wardrobe-images').upload(fileName, bytes, { upsert: false, contentType }),
          40000,
        );
      };
      let uploadResult;
      try {
        uploadResult = await attemptUpload();
      } catch (err: any) {
        if (!err?.isTimeout) throw err;
        uploadResult = await attemptUpload();
      }
      const { data: uploadData, error: uploadError } = uploadResult;

      if (uploadError || !uploadData) throw uploadError || new Error('Upload failed.');

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('wardrobe-images')
        .getPublicUrl(uploadData.path);

      setStatusMessage('Saving details...');
      // Insert wardrobe item row
      const { error: dbError } = await withTimeout(
        supabase.from('wardrobe_items').insert({
          user_id: userId,
          category,
          garment_type: garmentType,
          sub_category: subCategory.trim() || null,
          image_url: publicUrl,
          color_tags: selectedColors,
        }),
        12000,
      );

      if (dbError) throw dbError;

      setImageUri(null);
      setProcessedImageUri(null);
      setRawPickedUri(null);
      setRawPickedSize(null);
      setGarmentType(null);
      setSelectedColors([]);
      setSubCategory('');

      if (Platform.OS === 'web') {
        showToast('Item added to your wardrobe.', 'success');
        router.back();
      } else {
        notifySuccess();
        Alert.alert('Item Added', 'Item added to your wardrobe.', [
          { text: 'Done', onPress: () => router.back() }
        ]);
      }
    } catch (err: any) {
      console.error('Error saving wardrobe item:', err);
      let userMessage = err?.message || 'Failed to save item. Try again.';
      if (err?.isTimeout) {
        userMessage = 'The upload took too long. Check your connection and tap Save again.';
      } else if (err?.isOffline || err?.isAuthStale) {
        userMessage = err.message;
      } else if (err?.code === '42501' || err?.message?.includes('row-level security')) {
        // Not necessarily an expired session -- upsert:true on storage
        // uploads was a confirmed cause of this exact error regardless of
        // auth state (reverted). Keep this generic rather than pointing at
        // a specific cause we can't actually confirm client-side.
        userMessage = 'Unable to save this item right now. Please try again.';
      }
      showToast(userMessage, 'error');
    } finally {
      setSaving(false);
      setStatusMessage('');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Add New Item</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Image Picker Area */}
        <View style={[styles.imageContainer, { borderColor: colors.border, backgroundColor: colors.card }]}>
          {imageUri ? (
            <View style={styles.previewContainer}>
              <Image 
                source={{ uri: (removeBg && processedImageUri) ? processedImageUri : imageUri }} 
                style={[styles.previewImage, isProcessingBg && { opacity: 0.5 }]} 
                contentFit="contain" 
              />
              {isProcessingBg && (
                <View style={styles.processingOverlay}>
                  <ActivityIndicator size="large" color={colors.tint} />
                  <Text style={[styles.processingText, { color: colors.tint }]}>Extracting Item...</Text>
                </View>
              )}
              <TouchableOpacity style={styles.removeImageBtn} onPress={() => setImageUri(null)}>
                <IconSymbol name="trash.fill" size={20} color="#FF453A" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.pickerButtons}>
              <TouchableOpacity style={[styles.pickerBtn, { backgroundColor: colors.surface }]} onPress={() => pickImage(true)}>
                <IconSymbol name="camera.fill" size={32} color={colors.tint} />
                <Text style={[styles.pickerBtnText, { color: colors.text }]}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pickerBtn, { backgroundColor: colors.surface }]} onPress={() => pickImage(false)}>
                <IconSymbol name="photo.fill" size={32} color={colors.tint} />
                <Text style={[styles.pickerBtnText, { color: colors.text }]}>Gallery</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Form Controls */}
        <View style={styles.form}>
          {/* Background Removal toggle */}
          <View style={[styles.formRow, styles.switchRow]}>
            <View style={{ flex: 1, paddingRight: Spacing.lg }}>
              <Text style={[styles.label, { color: colors.text }]}>Remove Background</Text>
              <Text style={[styles.subLabel, { color: colors.secondaryText }]}>
                Automatically isolate clothing item using on-device ML
              </Text>
            </View>
            <Switch
              value={removeBg}
              onValueChange={setRemoveBg}
              trackColor={{ false: '#767577', true: colors.tint }}
              thumbColor={Platform.OS === 'android' ? (removeBg ? 'white' : '#f4f3f4') : undefined}
            />
          </View>

          {/* Garment Type -- basic bucket used for wardrobe insights/gap analysis */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Type</Text>
            <View style={styles.chipWrapRow}>
              {GARMENT_TYPES.map((type) => {
                const isSelected = garmentType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.chip,
                      { borderColor: colors.border, backgroundColor: isSelected ? colors.tint : colors.card }
                    ]}
                    onPress={() => setGarmentType(type)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text style={[styles.chipText, { color: isSelected ? colors.onTint : colors.text }]}>
                      {type}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Category Selector -- opens a searchable list instead of a
              horizontal chip scroller. That scroller only ever showed the
              first 2-3 of 23 categories with no scroll affordance, which
              read as if those were the only options rather than a
              partially-hidden list. */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Category</Text>
            <TouchableOpacity
              style={[styles.selectorField, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={() => { setCategorySearch(''); setCategoryModalVisible(true); }}
              accessibilityRole="button"
              accessibilityLabel="Select category"
            >
              <Text
                style={[styles.selectorFieldText, { color: category ? colors.text : colors.secondaryText }]}
                numberOfLines={1}
              >
                {category || 'Select a category'}
              </Text>
              <IconSymbol name="chevron.down" size={18} color={colors.secondaryText} />
            </TouchableOpacity>
            {!CATEGORIES.includes(category) && (
              <TextInput keyboardAppearance={theme}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card, marginTop: Spacing.sm }]}
                placeholder="Custom category name..."
                placeholderTextColor={colors.secondaryText}
                value={category}
                onChangeText={setCategory}
                autoFocus
              />
            )}
          </View>

          {/* Subcategory description */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Detail / Style Code (Optional)</Text>
            <TextInput keyboardAppearance={theme}
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="e.g. Slim-fit, Double-breasted"
              placeholderTextColor={colors.secondaryText}
              value={subCategory}
              onChangeText={setSubCategory}
            />
          </View>

          {/* Color Tags Multi-Select */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Colors</Text>
            <View style={styles.colorPalette}>
              {colorOptions.map((col) => {
                const isSelected = selectedColors.includes(col.name);
                const isWhite = col.name === 'White';
                return (
                  <TouchableOpacity
                    key={col.name}
                    style={[
                      styles.colorCircle,
                      {
                        backgroundColor: col.hex,
                        borderColor: isSelected ? colors.tint : isWhite ? '#CCCCCC' : '#444444',
                        borderWidth: isSelected ? 3 : 1,
                      }
                    ]}
                    onPress={() => toggleColor(col.name)}
                    activeOpacity={0.8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isSelected }}
                    accessibilityLabel={col.name}
                  >
                    {isSelected && (
                      <IconSymbol
                        name="checkmark"
                        size={16}
                        color={col.name === 'White' || col.name === 'Gold' || col.name === 'Silver' ? 'black' : '#FFFFFF'}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* Action Button */}
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.tint, opacity: imageUri && garmentType && !saving ? 1 : 0.6 }]}
          onPress={handleSave}
          disabled={!imageUri || !garmentType || saving}
        >
          {saving ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.onTint} size="small" />
              <Text style={[styles.saveButtonText, { color: colors.onTint }]}>{statusMessage || 'Saving...'}</Text>
            </View>
          ) : (
            <Text style={[styles.saveButtonText, { color: colors.onTint }]}>Add to Wardrobe</Text>
          )}
        </TouchableOpacity>
        
        <View style={{ height: 60 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      <ImageCropModal
        visible={cropModalVisible}
        uri={rawPickedUri}
        initialSize={rawPickedSize}
        onCancel={handleCropCancel}
        onConfirm={handleCropConfirm}
      />

      <Modal
        visible={categoryModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCategoryModalVisible(false)}
      >
        <View style={styles.categoryModalOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setCategoryModalVisible(false)} />
          <SafeAreaView edges={['bottom']} style={[styles.categorySheet, { backgroundColor: colors.background }]}>
            <View style={styles.categorySheetHeader}>
              <Text style={[styles.categorySheetTitle, { color: colors.text }]}>Select Category</Text>
              <TouchableOpacity onPress={() => setCategoryModalVisible(false)} style={styles.categorySheetClose}>
                <IconSymbol name="xmark" size={20} color={colors.secondaryText} />
              </TouchableOpacity>
            </View>

            <View style={[styles.searchField, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <IconSymbol name="magnifyingglass" size={16} color={colors.secondaryText} />
              <TextInput keyboardAppearance={theme}
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search categories..."
                placeholderTextColor={colors.secondaryText}
                value={categorySearch}
                onChangeText={setCategorySearch}
                autoFocus
              />
            </View>

            <ScrollView style={styles.categoryList} keyboardShouldPersistTaps="handled">
              <TouchableOpacity
                style={[styles.categoryRow, { borderColor: colors.border }]}
                onPress={() => { setCategory(''); setCategoryModalVisible(false); }}
              >
                <Text style={[styles.categoryRowText, { color: colors.tint, fontWeight: '700' }]}>+ Custom category...</Text>
              </TouchableOpacity>
              {CATEGORIES.filter((cat) => cat.toLowerCase().includes(categorySearch.trim().toLowerCase())).map((cat) => {
                const isSelected = category === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.categoryRow, { borderColor: colors.border }]}
                    onPress={() => { setCategory(cat); setCategoryModalVisible(false); }}
                  >
                    <Text style={[styles.categoryRowText, { color: colors.text }]}>{cat}</Text>
                    {isSelected && <IconSymbol name="checkmark" size={18} color={colors.tint} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  backButton: {
    padding: Spacing.sm,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  headerTitle: {
    ...Type.subtitle,
    fontWeight: '700',
  },
  content: {
    padding: Spacing.xl,
  },
  imageContainer: {
    height: width * 0.9,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xxl,
  },
  previewContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  removeImageBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: Spacing.sm,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: Radius.lg,
  },
  processingText: {
    marginTop: Spacing.md,
    ...Type.bodyStrong,
    fontWeight: '600',
  },
  pickerButtons: {
    flexDirection: 'row',
    gap: Spacing.xl,
  },
  pickerBtn: {
    width: 120,
    height: 120,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    ...Platform.select({
      ios: {
        shadowColor: 'black',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      web: { boxShadow: '0 2px 4px rgba(0,0,0,0.1)' },
    }),
  },
  pickerBtnText: {
    marginTop: Spacing.md,
    ...Type.body,
    fontWeight: '600',
  },
  form: {
    gap: Spacing.xl,
    marginBottom: Spacing.xxxl,
  },
  formRow: {
    gap: Spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    ...Type.bodyStrong,
    fontWeight: '700',
  },
  subLabel: {
    ...Type.caption,
    marginTop: 2,
  },
  input: {
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    ...Type.bodyStrong,
  },
  chipRow: {
    paddingVertical: Spacing.xs,
    gap: Spacing.sm,
  },
  chipWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    ...Type.body,
    fontWeight: '600',
  },
  selectorField: {
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  selectorFieldText: {
    ...Type.bodyStrong,
    flex: 1,
  },
  categoryModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  categorySheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  categorySheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  categorySheetTitle: {
    ...Type.subtitle,
    fontWeight: '700',
  },
  categorySheetClose: {
    padding: Spacing.xs,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  searchInput: {
    flex: 1,
    ...Type.body,
    height: '100%',
  },
  categoryList: {
    marginBottom: Spacing.xl,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  categoryRowText: {
    ...Type.body,
  },
  colorPalette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.lg,
    marginTop: Spacing.xs,
  },
  colorCircle: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButton: {
    height: 56,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    ...Platform.select({
      ios: {
        shadowColor: '#C9A96E',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      web: { boxShadow: '0 4px 8px rgba(201,169,110,0.3)' },
    }),
  },
  saveButtonText: {
    ...Type.bodyStrong,
    fontWeight: '800',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
