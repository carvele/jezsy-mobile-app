import { notifySuccess } from '@/src/utils/haptics';
import React, { useState, useEffect, useRef } from 'react';
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
import { wardrobeService } from '@/src/services';
import { useAuth } from '@/src/context/AuthContext';
import { removeBackground } from '@six33/react-native-bg-removal';
import { removeBackgroundWeb } from '@/src/utils/webBackgroundRemoval';
import { useToast } from '@/src/context/ToastContext';
import { ImageCropModal } from '@/src/components/ImageCropModal';
import { resolveImageFileInfo } from '@/src/utils/imageUpload';
import { isOnline } from '@/src/services/offlineSync';
import { ColorPickerModal } from '@/src/components/ColorPickerModal';
import { ColorDetailItem } from '@/src/types/dto/aiAttributes';

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

const COMMON_OCCASIONS = [
  'Casual',
  'Everyday',
  'Work',
  'Business Casual',
  'Formal',
  'Cocktail',
  'Date Night',
  'Party',
  'Interview',
  'Dinner',
  'Wedding',
  'Travel',
  'Athletic',
];
const COMMON_PATTERNS = [
  'Solid',
  'Striped',
  'Floral',
  'Plaid',
  'Polka Dot',
  'Graphic',
  'Animal Print',
  'Abstract',
  'Geometric',
  'Multicolor Graphic',
  'Micro-check',
  'Pinstripe',
  'Camouflage',
  'Textured',
  'Custom',
];
const COMMON_FITS = [
  'Regular',
  'Slim',
  'Oversized',
  'Tailored',
  'Loose',
  'Fitted',
  'Relaxed',
  'Cropped',
  'Boxy',
  'Straight',
  'Tapered',
  'Wide-leg',
  'Skinny',
];
const COMMON_MATERIALS = [
  'Cotton',
  'Denim',
  'Linen',
  'Silk',
  'Wool',
  'Polyester',
  'Leather',
  'Knit',
  'Velvet',
  'Suede',
  'Faux Leather',
  'Canvas',
  'Nylon',
  'Rayon',
  'Blend',
  'Other',
];
const QUICK_COLOR_PALETTE = [
  { name: 'Black', hex: '#212121' },
  { name: 'Charcoal', hex: '#374151' },
  { name: 'Grey', hex: '#9E9E9E' },
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Navy', hex: '#1B2A4A' },
  { name: 'Blue', hex: '#1E88E5' },
  { name: 'Burgundy', hex: '#800020' },
  { name: 'Red', hex: '#E53935' },
  { name: 'Pink', hex: '#E91E63' },
  { name: 'Olive', hex: '#556B2F' },
  { name: 'Green', hex: '#43A047' },
  { name: 'Beige', hex: '#F5F5DC' },
  { name: 'Brown', hex: '#795548' },
  { name: 'Gold', hex: '#D4AF37' },
];

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
  const [subCategory, setSubCategory] = useState<string>('');
  const [removeBg, setRemoveBg] = useState<boolean>(true);
  const [categoryModalVisible, setCategoryModalVisible] = useState<boolean>(false);
  const [categorySearch, setCategorySearch] = useState<string>('');
  
  // User Description & Personal Notes
  const [description, setDescription] = useState<string>('');
  const [userNotes, setUserNotes] = useState<string>('');
  const [pattern, setPattern] = useState<string>('Solid');
  const [customPattern, setCustomPattern] = useState<string>('');
  const [material, setMaterial] = useState<string>('Cotton');
  const [customMaterial, setCustomMaterial] = useState<string>('');
  const [fit, setFit] = useState<string>('Regular');
  const [occasions, setOccasions] = useState<string[]>(['Casual']);
  const [customOccasion, setCustomOccasion] = useState<string>('');
  const [colorDetails, setColorDetails] = useState<ColorDetailItem[]>([]);
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [moreDetailsOpen, setMoreDetailsOpen] = useState<boolean>(false);
  const [moreDetails, setMoreDetails] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  // Wall-clock (not setTimeout-based) recovery for a save that started while
  // the tab was foregrounded and then got backgrounded mid-upload. Mobile
  // Chrome throttles or fully freezes a hidden tab's JS timers to save
  // battery, so withTimeout's own setTimeout(...) can simply never fire --
  // confirmed live, reported as "waited a few minutes [in another app], came
  // back, still stuck on Uploading to storage" on two separate phones.
  // document.visibilitychange reliably fires when a frozen tab wakes back
  // up even though its own timers didn't, so that's the signal used here to
  // check real elapsed time and force the UI out of a stuck state the
  // setTimeout guard missed.
  const saveStartedAtRef = useRef<number | null>(null);
  const saveGenerationRef = useRef(0);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (saveStartedAtRef.current === null) return;
      const elapsed = Date.now() - saveStartedAtRef.current;
      // A little past the longest legitimate run: up to 4 upload attempts
      // at 40s each plus the pauses between retries, then the DB insert's
      // own 12s. So this only fires once the operation is unambiguously
      // past any legitimate completion window, not mid-retry.
      if (elapsed > 220000) {
        saveStartedAtRef.current = null;
        saveGenerationRef.current += 1;
        setSaving(false);
        setStatusMessage('');
        showToast('The upload was interrupted while the app was in the background. Please try again.', 'error');
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleCropConfirm = async (croppedUri: string) => {
    setImageUri(croppedUri);
    setCropModalVisible(false);
    setRawPickedUri(null);
    setRawPickedSize(null);
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
    saveStartedAtRef.current = Date.now();
    const myGeneration = ++saveGenerationRef.current;
    try {
      if (!(await isOnline())) {
        const offlineErr: any = new Error('No internet connection. Check your connection and try again.');
        offlineErr.isOffline = true;
        throw offlineErr;
      }

      // Reverted the fresh supabase.auth.getSession() call that was here:
      // it was chasing a misdiagnosed cause (the real bug was upsert:true on
      // the storage upload, fixed separately and confirmed the true root
      // cause). Every getSession() call contends for supabase-js's
      // cross-tab Web Locks auth lock -- confirmed live via a genuine
      // "Lock ... was not released within 5000ms" warning on a freshly
      // loaded tab, which is a real contributor to the "randomly stuck
      // loading" reports. session.user.id from AuthContext (already
      // populated via its own onAuthStateChange listener) is sufficient and
      // adds no extra lock contention.
      if (!session?.user?.id) {
        const authErr: any = new Error('Your session expired. Please log in again to add items.');
        authErr.isAuthStale = true;
        throw authErr;
      }
      const userId = session.user.id;

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
      // Up to 4 attempts (raised from 2), with a short pause between each --
      // confirmed live that resuming from several minutes idle (the phone's
      // screen-lock/background-tab case this whole flow is hardened for) can
      // take more than one retry to clear, since it's not just a slow
      // request but the client's auth token background-refreshing right as
      // the upload wants to use it. A single immediate retry sometimes
      // raced the same still-settling refresh; a brief pause gives it room
      // to finish first. Still fully safe to repeat: each attempt uses a
      // fresh filename, so there's no conflict risk from retrying.
      const maxAttempts = 4;
      let uploadResult: Awaited<ReturnType<typeof attemptUpload>> | undefined;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          uploadResult = await attemptUpload();
          break;
        } catch (err: any) {
          if (!err?.isTimeout) throw err;
          if (attempt === maxAttempts) {
            // All 4 attempts timed out -- confirmed live this can happen
            // (a brief background/foreground cycle is enough to trigger it,
            // not just a long idle period), and once it does, it can stay
            // wedged for minutes: more retries within this same page load
            // have diminishing odds of helping. A full reload gives the
            // browser a genuinely fresh session/lock state, which is far
            // more likely to actually clear it than tapping Save again.
            err.exhaustedRetries = true;
            throw err;
          }
          setStatusMessage(`Upload interrupted, retrying... (${attempt + 1}/${maxAttempts})`);
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }
      }
      const { data: uploadData, error: uploadError } = uploadResult!;

      if (uploadError || !uploadData) throw uploadError || new Error('Upload failed.');

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('wardrobe-images')
        .getPublicUrl(uploadData.path);

      setStatusMessage('Saving details...');

      // User-authored attributes are authoritative
      const effectivePattern = pattern === 'Custom' && customPattern.trim() ? customPattern.trim() : pattern;
      const effectiveMaterial = material === 'Other' && customMaterial.trim() ? customMaterial.trim() : material;
      const effectiveCategory = category.trim() || (garmentType ? `${garmentType}s` : 'Wardrobe Item');
      const effectiveSubCategory = subCategory.trim() || null;
      const trimmedDescription = description.trim();
      const trimmedNotes = userNotes.trim();

      // Insert wardrobe item row via wardrobeService with bounded timeout
      const result = await withTimeout(
        wardrobeService.addItem({
          userId,
          category: effectiveCategory,
          garmentType: garmentType || 'Top',
          subCategory: effectiveSubCategory,
          imageUrl: publicUrl,
          colorTags: selectedColors,
          pattern: effectivePattern,
          material: effectiveMaterial,
          fit: fit || null,
          occasions,
          colorDetails,
          isCustomCategory: !CATEGORIES.includes(effectiveCategory),
          description: trimmedDescription || null,
          userNotes: trimmedNotes || null,
          aiAttributes: {
            description: trimmedDescription || undefined,
            userNotes: trimmedNotes || undefined,
            moreDetails: Object.keys(moreDetails).length > 0 ? moreDetails : undefined,
            colorDetails,
          } as any,
          userCorrections: null,
        }),
        12000,
      );

      if (!result.ok) throw result.error;

      // If the visibility-recovery effect already declared this attempt
      // interrupted (tab was backgrounded past the recovery threshold) and
      // reset the UI, don't let this same attempt's late, actually-
      // successful resolution silently flip things back to "success" out
      // from under a user who may already be retrying.
      if (myGeneration !== saveGenerationRef.current) return;
      saveStartedAtRef.current = null;

      setImageUri(null);
      setProcessedImageUri(null);
      setRawPickedUri(null);
      setRawPickedSize(null);
      setGarmentType(null);
      setSelectedColors([]);
      setColorDetails([]);
      setSubCategory('');
      setDescription('');
      setUserNotes('');
      setPattern('Solid');
      setCustomPattern('');
      setMaterial('Cotton');
      setCustomMaterial('');
      setFit('Regular');
      setOccasions(['Casual']);
      setCustomOccasion('');
      setMoreDetails({});
      setMoreDetailsOpen(false);

      // canGoBack() is not reliable here: after a page reload (the exact
      // recovery this flow suggests once upload retries exhaust), Expo
      // Router's web linking reconstructs a synthetic history stack from
      // the URL alone. That stack can report canGoBack() === true even
      // though there's no real "came from Wardrobe" entry, and back()
      // then pops to the tab navigator's default tab (Home) instead of
      // Wardrobe. This screen is only ever reached to add a garment, so
      // always land on Wardrobe explicitly instead of guessing from history.
      const goToWardrobe = () => router.replace('/wardrobe?tab=items');
      if (Platform.OS === 'web') {
        showToast('Item added to your wardrobe.', 'success');
        goToWardrobe();
      } else {
        notifySuccess();
        Alert.alert('Item Added', 'Item added to your wardrobe.', [
          { text: 'Done', onPress: goToWardrobe }
        ]);
      }
    } catch (err: any) {
      if (myGeneration !== saveGenerationRef.current) return;
      saveStartedAtRef.current = null;
      console.error('Error saving wardrobe item:', err);
      let userMessage = err?.message || 'Failed to save item. Try again.';
      if (err?.exhaustedRetries) {
        userMessage = 'Still stuck after several tries. Please reload the app (pull down to refresh, or close and reopen this tab), then try again.';
      } else if (err?.isTimeout) {
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
      if (myGeneration === saveGenerationRef.current) {
        setSaving(false);
        setStatusMessage('');
      }
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

          {/* Tell JeZy about this item */}
          <View style={styles.formRow}>
            <Text style={[styles.sectionHeading, { color: colors.text }]}>Tell JeZy about this item</Text>
            <TextInput
              keyboardAppearance={theme}
              style={[
                styles.input,
                styles.largeTextArea,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }
              ]}
              placeholder="Example: Navy blue fit-and-flare midi dress with short sleeves, a bow-tie neckline, fitted waist, polyester fabric, suitable for work, dinner, church and semi-formal events."
              placeholderTextColor={colors.secondaryText}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              maxLength={2000}
            />
            <Text style={[styles.helperText, { color: colors.secondaryText }]}>
              Describe the color, style, material, fit, details, and where you usually wear it.
            </Text>
          </View>

          {/* Notes for JeZy (Personal Notes) */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Notes for JeZy (Optional)</Text>
            <Text style={[styles.subLabel, { color: colors.secondaryText, marginBottom: 2 }]}>
              Private notes just for you and your personal stylist (e.g. favorite pairings, weather habits, or memories).
            </Text>
            <TextInput
              keyboardAppearance={theme}
              style={[
                styles.input,
                styles.textArea,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }
              ]}
              placeholder="Example: I love wearing this with sneakers. / This was a gift. / I only wear this during rainy weather."
              placeholderTextColor={colors.secondaryText}
              value={userNotes}
              onChangeText={setUserNotes}
              multiline
              numberOfLines={2}
              maxLength={2000}
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

          {/* Category Selector -- opens a searchable list */}
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

          {/* Subcategory / Style */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Style / Type</Text>
            <TextInput keyboardAppearance={theme}
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="e.g. Graphic T-shirt, Dress Shoes, Skinny Jeans"
              placeholderTextColor={colors.secondaryText}
              value={subCategory}
              onChangeText={setSubCategory}
            />
          </View>

          {/* Dynamic Colors Section with Hex Chips */}
          <View style={styles.formRow}>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: colors.text }]}>Colors</Text>
              <TouchableOpacity
                style={[styles.customColorInlineBtn, { borderColor: colors.tint }]}
                onPress={() => setColorPickerVisible(true)}
              >
                <IconSymbol name="plus" size={14} color={colors.tint} />
                <Text style={[styles.customColorInlineBtnText, { color: colors.tint }]}>+ Add Another Color</Text>
              </TouchableOpacity>
            </View>

            {/* Active Detected / Selected Color Chips */}
            {colorDetails.length > 0 ? (
              <View style={styles.colorChipsWrap}>
                {colorDetails.map((c, index) => {
                  const isWhite = c.hex.toLowerCase() === '#ffffff' || c.name.toLowerCase() === 'white';
                  const roleLabel = c.role === 'dominant' ? 'Main color' : c.role === 'secondary' ? 'Other color' : 'Accent color';
                  return (
                    <View
                      key={`${c.name}-${index}`}
                      style={[styles.colorDetailChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                      <View
                        style={[
                          styles.colorDetailSwatch,
                          {
                            backgroundColor: c.hex,
                            borderColor: isWhite ? '#CCCCCC' : 'rgba(255,255,255,0.2)',
                            borderWidth: 1,
                          }
                        ]}
                      />
                      <Text style={[styles.colorDetailName, { color: colors.text }]}>
                        {c.name} ({roleLabel})
                      </Text>
                      <TouchableOpacity
                        style={styles.colorDetailRemove}
                        onPress={() => {
                          setColorDetails((prev) => prev.filter((_, i) => i !== index));
                          setSelectedColors((prev) => prev.filter((name) => name !== c.name));
                        }}
                        accessibilityLabel={`Remove color ${c.name}`}
                      >
                        <IconSymbol name="xmark" size={12} color={colors.secondaryText} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={[styles.subLabel, { color: colors.secondaryText, marginVertical: Spacing.xs }]}>
                No colors selected yet. Choose from quick colors or tap + Add Another Color.
              </Text>
            )}

            {/* Quick Color Palette */}
            <Text style={[styles.subLabel, { color: colors.secondaryText, marginTop: Spacing.xs }]}>
              Quick add colors:
            </Text>
            <View style={styles.quickPaletteRow}>
              {QUICK_COLOR_PALETTE.map((col) => {
                const isAlreadyActive = colorDetails.some(
                  (c) => c.name.toLowerCase() === col.name.toLowerCase() || c.hex.toLowerCase() === col.hex.toLowerCase()
                );
                return (
                  <TouchableOpacity
                    key={col.name}
                    style={[
                      styles.quickColorPill,
                      {
                        backgroundColor: isAlreadyActive ? colors.tint : colors.card,
                        borderColor: isAlreadyActive ? colors.tint : colors.border,
                      }
                    ]}
                    onPress={() => {
                      if (isAlreadyActive) {
                        setColorDetails((prev) => prev.filter((c) => c.name.toLowerCase() !== col.name.toLowerCase()));
                        setSelectedColors((prev) => prev.filter((name) => name.toLowerCase() !== col.name.toLowerCase()));
                      } else {
                        const role = colorDetails.length === 0 ? 'dominant' : 'accent';
                        const newItem: ColorDetailItem = { name: col.name, hex: col.hex, role, confidence: 1.0 };
                        setColorDetails((prev) => [...prev, newItem]);
                        if (!selectedColors.includes(col.name)) {
                          setSelectedColors((prev) => [...prev, col.name]);
                        }
                      }
                    }}
                  >
                    <View
                      style={[
                        styles.quickColorDot,
                        {
                          backgroundColor: col.hex,
                          borderColor: col.name === 'White' ? '#CCC' : 'rgba(0,0,0,0.2)',
                          borderWidth: 1,
                        }
                      ]}
                    />
                    <Text
                      style={[
                        styles.quickColorText,
                        { color: isAlreadyActive ? colors.onTint : colors.text }
                      ]}
                    >
                      {col.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Pattern / Design Selector */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Pattern / Design</Text>
            <View style={styles.chipWrapRow}>
              {COMMON_PATTERNS.map((p) => {
                const isSelected = pattern === p;
                return (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.chip,
                      { borderColor: colors.border, backgroundColor: isSelected ? colors.tint : colors.card }
                    ]}
                    onPress={() => {
                      setPattern(p);
                    }}
                  >
                    <Text style={[styles.chipText, { color: isSelected ? colors.onTint : colors.text }]}>
                      {p}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {(pattern === 'Custom' || !COMMON_PATTERNS.includes(pattern)) && (
              <TextInput
                keyboardAppearance={theme}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card, marginTop: Spacing.sm }]}
                placeholder="Enter custom pattern / design..."
                placeholderTextColor={colors.secondaryText}
                value={customPattern}
                onChangeText={(text) => {
                  setCustomPattern(text);
                }}
              />
            )}
          </View>

          {/* Fabric / Material Selector */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Fabric / Material</Text>
            <View style={styles.chipWrapRow}>
              {COMMON_MATERIALS.map((m) => {
                const isSelected = material === m;
                return (
                  <TouchableOpacity
                    key={m}
                    style={[
                      styles.chip,
                      { borderColor: colors.border, backgroundColor: isSelected ? colors.tint : colors.card }
                    ]}
                    onPress={() => {
                      setMaterial(m);
                    }}
                  >
                    <Text style={[styles.chipText, { color: isSelected ? colors.onTint : colors.text }]}>
                      {m}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {(material === 'Other' || !COMMON_MATERIALS.includes(material)) && (
              <TextInput
                keyboardAppearance={theme}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card, marginTop: Spacing.sm }]}
                placeholder="Enter custom fabric / material..."
                placeholderTextColor={colors.secondaryText}
                value={customMaterial}
                onChangeText={(text) => {
                  setCustomMaterial(text);
                }}
              />
            )}
          </View>

          {/* Fit Selector */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Fit</Text>
            <View style={styles.chipWrapRow}>
              {(garmentType === 'Bottom'
                ? ['Regular', 'Slim', 'Straight', 'Tapered', 'Wide-leg', 'Skinny', 'Relaxed']
                : garmentType === 'Shoes'
                ? ['Regular', 'Wide', 'Narrow']
                : COMMON_FITS
              ).map((f) => {
                const isSelected = fit === f;
                return (
                  <TouchableOpacity
                    key={f}
                    style={[
                      styles.chip,
                      { borderColor: colors.border, backgroundColor: isSelected ? colors.tint : colors.card }
                    ]}
                    onPress={() => {
                      setFit(f);
                    }}
                  >
                    <Text style={[styles.chipText, { color: isSelected ? colors.onTint : colors.text }]}>
                      {f}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* When can I wear this? Multi-Select */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>When can I wear this?</Text>
            <View style={styles.chipWrapRow}>
              {COMMON_OCCASIONS.map((occ) => {
                const isSelected = occasions.includes(occ);
                return (
                  <TouchableOpacity
                    key={occ}
                    style={[
                      styles.chip,
                      { borderColor: colors.border, backgroundColor: isSelected ? colors.tint : colors.card }
                    ]}
                    onPress={() => {
                      setOccasions((prev) =>
                        prev.includes(occ) ? prev.filter((o) => o !== occ) : [...prev, occ]
                      );
                    }}
                  >
                    <Text style={[styles.chipText, { color: isSelected ? colors.onTint : colors.text }]}>
                      {isSelected ? `✓ ${occ}` : occ}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {/* Custom occasions */}
              {occasions.filter((o) => !COMMON_OCCASIONS.includes(o)).map((customOcc) => (
                <TouchableOpacity
                  key={customOcc}
                  style={[
                    styles.chip,
                    { borderColor: colors.border, backgroundColor: colors.tint }
                  ]}
                  onPress={() => {
                    setOccasions((prev) => prev.filter((o) => o !== customOcc));
                  }}
                >
                  <Text style={[styles.chipText, { color: colors.onTint }]}>
                    ✓ {customOcc} ✕
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Custom occasion input */}
            <View style={styles.customOccasionRow}>
              <TextInput
                keyboardAppearance={theme}
                style={[styles.customOccasionInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                placeholder="e.g. Wedding Guest, Beach Vacation, Concert..."
                placeholderTextColor={colors.secondaryText}
                value={customOccasion}
                onChangeText={setCustomOccasion}
              />
              <TouchableOpacity
                style={[styles.customOccasionAddBtn, { backgroundColor: colors.tint }]}
                onPress={() => {
                  const trimmed = customOccasion.trim();
                  if (trimmed && !occasions.includes(trimmed)) {
                    setOccasions((prev) => [...prev, trimmed]);
                    setCustomOccasion('');
                  }
                }}
              >
                <Text style={[styles.customOccasionAddBtnText, { color: colors.onTint }]}>+ Add Your Own Occasion</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* More Details (Context-Sensitive) */}
          <View style={styles.formRow}>
            <TouchableOpacity
              style={styles.moreDetailsToggle}
              onPress={() => setMoreDetailsOpen((prev) => !prev)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <IconSymbol name="slider.horizontal.3" size={16} color={colors.tint} />
                <Text style={[styles.label, { color: colors.text, marginBottom: 0 }]}>More Details</Text>
              </View>
              <IconSymbol
                name={moreDetailsOpen ? 'chevron.up' : 'chevron.down'}
                size={16}
                color={colors.secondaryText}
              />
            </TouchableOpacity>

            {moreDetailsOpen && (
              <View style={[styles.moreDetailsContainer, { borderColor: colors.border }]}>
                {(garmentType === 'Top' || garmentType === 'Dress') && (
                  <>
                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600' }]}>Neckline / Collar</Text>
                    <View style={styles.chipWrapRow}>
                      {['Bow-tie / Ribbon', 'High Neck / Pussy-bow', 'Crew Neck', 'V-Neck', 'Collared', 'Scoop', 'Off-Shoulder', 'Square', 'Sweetheart'].map((n) => {
                        const sel = moreDetails.neckline === n;
                        return (
                          <TouchableOpacity
                            key={n}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, neckline: sel ? '' : n }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{n}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600', marginTop: Spacing.sm }]}>Sleeve Style</Text>
                    <View style={styles.chipWrapRow}>
                      {['Short Sleeve', 'Long Sleeve', 'Sleeveless', '3/4 Sleeve', 'Cap Sleeve', 'Puffed / Bell'].map((s) => {
                        const sel = moreDetails.sleeveType === s;
                        return (
                          <TouchableOpacity
                            key={s}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, sleeveType: sel ? '' : s }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{s}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600', marginTop: Spacing.sm }]}>Length</Text>
                    <View style={styles.chipWrapRow}>
                      {['Mini', 'Knee-length', 'Midi', 'Maxi', 'Cropped', 'Regular'].map((l) => {
                        const sel = moreDetails.length === l;
                        return (
                          <TouchableOpacity
                            key={l}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, length: sel ? '' : l }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{l}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {garmentType === 'Dress' && (
                      <>
                        <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600', marginTop: Spacing.sm }]}>Waist & Silhouette</Text>
                        <View style={styles.chipWrapRow}>
                          {['Fit-and-Flare / A-Line', 'Fitted Waist', 'Empire Waist', 'Shift / Relaxed', 'Wrap', 'Bodycon', 'Sheath'].map((w) => {
                            const sel = moreDetails.silhouette === w;
                            return (
                              <TouchableOpacity
                                key={w}
                                style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                                onPress={() => setMoreDetails((prev) => ({ ...prev, silhouette: sel ? '' : w }))}
                              >
                                <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{w}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    )}

                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600', marginTop: Spacing.sm }]}>Closure</Text>
                    <View style={styles.chipWrapRow}>
                      {['Back Zipper', 'Side Zipper', 'Buttons', 'Pullover', 'Wrap Tie'].map((c) => {
                        const sel = moreDetails.closure === c;
                        return (
                          <TouchableOpacity
                            key={c}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, closure: sel ? '' : c }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{c}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                {garmentType === 'Shoes' && (
                  <>
                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600' }]}>Shoe Style</Text>
                    <View style={styles.chipWrapRow}>
                      {['Dress Shoes', 'Loafers', 'Sneakers', 'Boots', 'Sandals', 'Heels / Pumps', 'Flats'].map((s) => {
                        const sel = moreDetails.shoeStyle === s;
                        return (
                          <TouchableOpacity
                            key={s}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, shoeStyle: sel ? '' : s }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{s}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600', marginTop: Spacing.sm }]}>Heel Height</Text>
                    <View style={styles.chipWrapRow}>
                      {['Flat', 'Low Heel', 'Mid Heel', 'High Heel'].map((h) => {
                        const sel = moreDetails.heelHeight === h;
                        return (
                          <TouchableOpacity
                            key={h}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, heelHeight: sel ? '' : h }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{h}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600', marginTop: Spacing.sm }]}>Closure</Text>
                    <View style={styles.chipWrapRow}>
                      {['Lace-up', 'Slip-on', 'Buckle', 'Zipper', 'Velcro'].map((c) => {
                        const sel = moreDetails.closure === c;
                        return (
                          <TouchableOpacity
                            key={c}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, closure: sel ? '' : c }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{c}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600', marginTop: Spacing.sm }]}>Finish</Text>
                    <View style={styles.chipWrapRow}>
                      {['Smooth', 'Matte', 'Suede', 'Patent Gloss', 'Canvas', 'Textured'].map((f) => {
                        const sel = moreDetails.finish === f;
                        return (
                          <TouchableOpacity
                            key={f}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, finish: sel ? '' : f }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{f}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                {garmentType === 'Bottom' && (
                  <>
                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600' }]}>Rise</Text>
                    <View style={styles.chipWrapRow}>
                      {['High Rise', 'Mid Rise', 'Low Rise'].map((r) => {
                        const sel = moreDetails.rise === r;
                        return (
                          <TouchableOpacity
                            key={r}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, rise: sel ? '' : r }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{r}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600', marginTop: Spacing.sm }]}>Leg Style</Text>
                    <View style={styles.chipWrapRow}>
                      {['Straight', 'Tapered', 'Wide-leg', 'Skinny', 'Flared', 'Bootcut', 'Relaxed'].map((l) => {
                        const sel = moreDetails.legStyle === l;
                        return (
                          <TouchableOpacity
                            key={l}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, legStyle: sel ? '' : l }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{l}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600', marginTop: Spacing.sm }]}>Length</Text>
                    <View style={styles.chipWrapRow}>
                      {['Ankle', 'Full Length', 'Cropped', 'Shorts'].map((len) => {
                        const sel = moreDetails.length === len;
                        return (
                          <TouchableOpacity
                            key={len}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, length: sel ? '' : len }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{len}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                {garmentType === 'Outerwear' && (
                  <>
                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600' }]}>Collar & Lapel</Text>
                    <View style={styles.chipWrapRow}>
                      {['Notch Lapel', 'Peak Lapel', 'Stand Collar', 'Hooded', 'Shawl Collar'].map((c) => {
                        const sel = moreDetails.collar === c;
                        return (
                          <TouchableOpacity
                            key={c}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, collar: sel ? '' : c }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{c}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600', marginTop: Spacing.sm }]}>Closure</Text>
                    <View style={styles.chipWrapRow}>
                      {['Single-breasted', 'Double-breasted', 'Zipper', 'Button', 'Open Front'].map((cl) => {
                        const sel = moreDetails.closure === cl;
                        return (
                          <TouchableOpacity
                            key={cl}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, closure: sel ? '' : cl }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{cl}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}

                {garmentType === 'Accessory' && (
                  <>
                    <Text style={[styles.subLabel, { color: colors.text, fontWeight: '600' }]}>Accessory Type</Text>
                    <View style={styles.chipWrapRow}>
                      {['Bag', 'Belt', 'Scarf', 'Hat', 'Jewelry', 'Sunglasses'].map((a) => {
                        const sel = moreDetails.accessoryType === a;
                        return (
                          <TouchableOpacity
                            key={a}
                            style={[styles.chip, { borderColor: colors.border, backgroundColor: sel ? colors.tint : colors.card }]}
                            onPress={() => setMoreDetails((prev) => ({ ...prev, accessoryType: sel ? '' : a }))}
                          >
                            <Text style={[styles.chipText, { color: sel ? colors.onTint : colors.text }]}>{a}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        </View>

        {/* Action Button */}
        <TouchableOpacity
          style={[styles.saveButton, { backgroundColor: colors.tint, opacity: imageUri && !saving ? 1 : 0.6 }]}
          onPress={handleSave}
          disabled={!imageUri || saving}
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

      <ColorPickerModal
        visible={colorPickerVisible}
        onSave={(c) => {
          setColorDetails((prev) => [...prev, c]);
          if (!selectedColors.includes(c.name)) {
            setSelectedColors((prev) => [...prev, c.name]);
          }
        }}
        onClose={() => setColorPickerVisible(false)}
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
  textArea: {
    height: 80,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  moreDetailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
  },
  moreDetailsContainer: {
    gap: Spacing.md,
    marginTop: Spacing.xs,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
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
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  customColorInlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  customColorInlineBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  colorChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  colorDetailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    gap: 8,
  },
  colorDetailSwatch: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  colorDetailName: {
    fontSize: 13,
    fontWeight: '600',
  },
  colorDetailRemove: {
    padding: 2,
    marginLeft: 2,
  },
  quickPaletteRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: Spacing.xs,
  },
  quickColorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: Radius.pill,
    borderWidth: 1,
    gap: 6,
  },
  quickColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  quickColorText: {
    fontSize: 11,
    fontWeight: '500',
  },
  customOccasionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  customOccasionInput: {
    flex: 1,
    height: 42,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    fontSize: 13,
  },
  customOccasionAddBtn: {
    height: 42,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  customOccasionAddBtnText: {
    fontWeight: '700',
    fontSize: 13,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  largeTextArea: {
    height: 100,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },
});
