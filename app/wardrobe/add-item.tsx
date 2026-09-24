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
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { wardrobeService } from '@/src/services';
import { useAuth } from '@/src/context/AuthContext';
import { isNativeBackgroundRemovalSupported, removeBackground } from '@six33/react-native-bg-removal';
import { removeBackgroundWeb } from '@/src/utils/webBackgroundRemoval';
import { useToast } from '@/src/context/ToastContext';
import { ImageCropModal } from '@/src/components/ImageCropModal';
import { resolveImageFileInfo } from '@/src/utils/imageUpload';
import { isOnline } from '@/src/services/offlineSync';
import { fashionMlService } from '@/src/services/fashionMlService';
import { analyzeGarmentImage, GarmentTagSuggestion } from '@/src/services/garmentTaggingService';
import { inferSystemBucket } from '@/src/utils/garmentSemanticClassifier';

const { width } = Dimensions.get('window');
const EMPTY_STYLING_DETAILS = { pattern: '', material: '', fit: '', lengthType: '', sleeveType: '', neckline: '', silhouette: '' };

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
  const [removeBg, setRemoveBg] = useState<boolean>(true);
  const [backgroundRemovalError, setBackgroundRemovalError] = useState<string | null>(null);
  const [backgroundRemovalAttempt, setBackgroundRemovalAttempt] = useState(0);
  const [isTagging, setIsTagging] = useState(false);
  const [tagSuggestion, setTagSuggestion] = useState<GarmentTagSuggestion | null>(null);
  const [detectedDetails, setDetectedDetails] = useState(EMPTY_STYLING_DETAILS);
  const [detectionConfidence, setDetectionConfidence] = useState<number | null>(null);
  const [showStylingDetails, setShowStylingDetails] = useState(false);

  // Five primary clean fields + optional notes
  const [category, setCategory] = useState<string>('');
  const [subCategory, setSubCategory] = useState<string>('');
  const [color, setColor] = useState<string>('');
  const [whereWornOften, setWhereWornOften] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [userNotes, setUserNotes] = useState<string>('');

  const [saving, setSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const saveStartedAtRef = useRef<number | null>(null);
  const saveGenerationRef = useRef(0);
  // One save attempt per image: the client-generated item id and the uploaded file survive retries, so a
  // retry after a timeout reuses both instead of creating a second row and a second orphaned upload.
  const attemptRef = useRef<{ uri: string; itemId: string; path?: string; publicUrl?: string } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (saveStartedAtRef.current === null) return;
      const elapsed = Date.now() - saveStartedAtRef.current;
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
  }, [showToast]);

  useEffect(() => {
    let isMounted = true;

    const processImage = async () => {
      if (!imageUri) {
        setProcessedImageUri(null);
        setBackgroundRemovalError(null);
        return;
      }
      
      if (!removeBg) {
        setProcessedImageUri(null);
        setBackgroundRemovalError(null);
        return;
      }

      setIsProcessingBg(true);
      setBackgroundRemovalError(null);
      try {
        if (Platform.OS === 'web') {
          const webCutoutUri = await removeBackgroundWeb(imageUri);
          if (isMounted && webCutoutUri) {
            setProcessedImageUri(webCutoutUri);
          }
        } else {
          if (!(await isNativeBackgroundRemovalSupported())) {
            throw new Error('Background removal is not supported on this device.');
          }
          const result = await removeBackground(imageUri);
          if (!result || result === imageUri) {
            throw new Error('No isolated garment image was created.');
          }
          if (isMounted) {
            setProcessedImageUri(result);
          }
        }
      } catch (err) {
        console.warn('Background removal failed, falling back to original image:', err);
        if (isMounted) {
          setProcessedImageUri(null);
          setBackgroundRemovalError('Could not remove the background on this device. Your original photo is still safe to use.');
        }
      } finally {
        if (isMounted) {
          setIsProcessingBg(false);
        }
      }
    };

    processImage();

    return () => {
      isMounted = false;
    };
  }, [backgroundRemovalAttempt, imageUri, removeBg]);

  const pickImage = async (useCamera: boolean) => {
    try {
      let result;
      if (useCamera) {
        const { status, canAskAgain } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          if (!canAskAgain) {
            Alert.alert(
              'Camera Access Blocked',
              'Camera permission has been blocked for JezSy. Please enable camera access in your device Settings to take photos of your clothes.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ]
            );
          } else {
            Alert.alert('Permission needed', 'Camera permission is required to take photos of your clothes.');
          }
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.8,
        });
      } else {
        const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          if (!canAskAgain) {
            Alert.alert(
              'Photo Library Access Blocked',
              'Photo library permission has been blocked for JezSy. Please enable photo access in your device Settings to select photos of your clothes.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Open Settings', onPress: () => Linking.openSettings() },
              ]
            );
          } else {
            Alert.alert('Permission needed', 'Gallery permission is required to select photos of your clothes.');
          }
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setRawPickedUri(asset.uri);
        if (asset.width && asset.height) {
          setRawPickedSize({ width: asset.width, height: asset.height });
        } else {
          setRawPickedSize(null);
        }
        setCropModalVisible(true);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image.');
    }
  };

  const handleCropComplete = (croppedUri: string) => {
    setImageUri(croppedUri);
    setTagSuggestion(null);
    setCropModalVisible(false);
    setRawPickedUri(null);
    setRawPickedSize(null);
  };

  const handleCropCancel = () => {
    setCropModalVisible(false);
    if (rawPickedUri) {
      setImageUri(rawPickedUri);
    }
    setTagSuggestion(null);
    setRawPickedUri(null);
    setRawPickedSize(null);
  };

  const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMsg?: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const err: any = new Error(timeoutMsg || 'Operation timed out');
          err.isTimeout = true;
          reject(err);
        }, timeoutMs);
      });
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const handleAutoDetect = async () => {
    if (!imageUri || isTagging) return;
    if (!(await isOnline())) {
      showToast('Auto-detect needs an internet connection. You can enter the details manually.', 'error');
      return;
    }
    setIsTagging(true);
    try {
      const suggestion = await analyzeGarmentImage(imageUri);
      setTagSuggestion(suggestion);
      showToast('Details detected. Review the suggestion before applying it.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not detect clothing details. Please enter them manually.', 'error');
    } finally {
      setIsTagging(false);
    }
  };

  const applyTagSuggestion = () => {
    if (!tagSuggestion) return;
    setCategory(tagSuggestion.category);
    setSubCategory(tagSuggestion.subCategory);
    setColor(tagSuggestion.colorTags.join(', ') || tagSuggestion.primaryColor);
    setDetectedDetails({
      pattern: tagSuggestion.pattern === 'unknown' ? '' : tagSuggestion.pattern,
      material: tagSuggestion.material === 'unknown' ? '' : tagSuggestion.material,
      fit: tagSuggestion.fit === 'unknown' ? '' : tagSuggestion.fit,
      lengthType: tagSuggestion.lengthType === 'unknown' ? '' : tagSuggestion.lengthType,
      sleeveType: tagSuggestion.sleeveType === 'unknown' ? '' : tagSuggestion.sleeveType,
      neckline: tagSuggestion.neckline === 'unknown' ? '' : tagSuggestion.neckline,
      silhouette: tagSuggestion.silhouette === 'unknown' ? '' : tagSuggestion.silhouette,
    });
    setDetectionConfidence(tagSuggestion.confidence);
    setShowStylingDetails(true);
    setTagSuggestion(null);
    showToast('Suggestions applied. You can edit any field before saving.', 'success');
  };

  const handleSave = async () => {
    if (!imageUri) {
      showToast('Please select or take a photo of your item.', 'error');
      return;
    }

    const trimmedCategory = category.trim();
    const trimmedSub = subCategory.trim();
    const trimmedColor = color.trim();
    const trimmedWhereWorn = whereWornOften.trim();
    const trimmedDesc = description.trim();
    const trimmedNotes = userNotes.trim();

    if (!trimmedCategory && !trimmedDesc) {
      showToast('Please provide a category or describe your item.', 'error');
      return;
    }

    const online = await isOnline();
    if (!online) {
      showToast('You appear to be offline. Please check your internet connection and try again.', 'error');
      return;
    }

    const myGeneration = ++saveGenerationRef.current;
    saveStartedAtRef.current = Date.now();
    setSaving(true);
    setStatusMessage('Preparing image...');

    try {
      const activeUri = (removeBg && processedImageUri) ? processedImageUri : imageUri;

      const userId = session?.user?.id;
      if (!userId) {
        throw new Error('You must be signed in to save items to your wardrobe.');
      }

      // A different image is a different item: release the previous attempt's upload if its row was never created.
      const previous = attemptRef.current;
      if (previous && previous.uri !== activeUri) {
        if (previous.path && (await wardrobeService.itemExists(previous.itemId, userId)) === false) {
          await wardrobeService.removeWardrobeImage(previous.path);
        }
        attemptRef.current = null;
      }
      if (!attemptRef.current) {
        attemptRef.current = { uri: activeUri, itemId: Crypto.randomUUID() };
      }
      const attempt = attemptRef.current;

      const response = attempt.path ? null : await fetch(activeUri);
      const headerContentType = response?.headers?.get('content-type');
      const bytes = response ? await response.arrayBuffer() : null;
      if (response && (!bytes || bytes.byteLength === 0)) {
        throw new Error('Selected image file is empty.');
      }
      const { contentType, ext } = resolveImageFileInfo(activeUri, headerContentType);

      // Non-blocking ML visual representation generation
      let visualEmbedding: number[] | null = null;
      try {
        const rep = await fashionMlService.extractVisualRepresentation(activeUri);
        if (rep?.embedding) {
          visualEmbedding = rep.embedding;
        }
      } catch {
        visualEmbedding = null;
      }

      if (!attempt.path) {
        setStatusMessage('Uploading photo...');
        // Random uuid, not a timestamp: the bucket is public, so the URL is the only thing protecting the photo.
        const filePath = `${userId}/${Crypto.randomUUID()}.${ext}`;

        const attemptUpload = async () => {
          return await supabase.storage
            .from('wardrobe-images')
            .upload(filePath, bytes as ArrayBuffer, {
              contentType,
              upsert: false,
            });
        };

        let uploadResult: any = null;
        let lastUploadErr: any = null;

        for (let tries = 1; tries <= 4; tries++) {
          if (myGeneration !== saveGenerationRef.current) return;
          try {
            setStatusMessage(tries === 1 ? 'Uploading photo...' : `Retrying upload (${tries}/4)...`);
            uploadResult = await withTimeout(attemptUpload(), 40000, 'Photo upload timed out');
            if (uploadResult?.error) {
              lastUploadErr = uploadResult.error;
              if (tries < 4) {
                await new Promise((resolve) => setTimeout(resolve, tries * 1500));
                continue;
              }
            } else {
              lastUploadErr = null;
              break;
            }
          } catch (err: any) {
            lastUploadErr = err;
            if (tries < 4) {
              await new Promise((resolve) => setTimeout(resolve, tries * 1500));
            }
          }
        }

        if (lastUploadErr) {
          const err: any = new Error(lastUploadErr.message || 'Upload failed.');
          err.exhaustedRetries = true;
          throw err;
        }
        const { data: uploadData, error: uploadError } = uploadResult!;
        if (uploadError || !uploadData) throw uploadError || new Error('Upload failed.');

        attempt.path = uploadData.path;
        attempt.publicUrl = supabase.storage.from('wardrobe-images').getPublicUrl(uploadData.path).data.publicUrl;
      }
      const publicUrl = attempt.publicUrl as string;

      setStatusMessage('Saving details...');

      // Infer bucket for system compat without altering user's text
      const effectiveCategory = trimmedCategory || 'Clothing';
      const inferredBucket = inferSystemBucket(effectiveCategory, trimmedSub, trimmedDesc);

      // Parse color tags from text for filtering while preserving exact user text
      const parsedColorTags = trimmedColor
        ? trimmedColor.split(/[,/&]|\band\b/i).map((s) => s.trim()).filter(Boolean)
        : [];
      const colorTags = parsedColorTags.length > 0 ? parsedColorTags : (trimmedColor ? [trimmedColor] : []);

      // Parse occasion tags from text for filtering while preserving exact user text
      const parsedOccasionTags = trimmedWhereWorn
        ? trimmedWhereWorn.split(/[,/&]|\band\b/i).map((s) => s.trim()).filter(Boolean)
        : [];
      const occasionTags = parsedOccasionTags.length > 0 ? parsedOccasionTags : (trimmedWhereWorn ? [trimmedWhereWorn] : []);

      const outcome = await wardrobeService.saveItemVerified({
        id: attempt.itemId,
        userId,
        category: effectiveCategory,
        garmentType: inferredBucket,
        subCategory: trimmedSub || null,
        imageUrl: publicUrl,
        color: trimmedColor || null,
        colorTags,
        whereWornOften: trimmedWhereWorn || null,
        occasions: occasionTags,
        description: trimmedDesc || null,
        userNotes: trimmedNotes || null,
        embedding: visualEmbedding,
        aiAttributes: {
          rawColor: trimmedColor || undefined,
          whereWornOften: trimmedWhereWorn || undefined,
          description: trimmedDesc || undefined,
          userNotes: trimmedNotes || undefined,
          detectionSource: detectionConfidence === null ? undefined : 'gemini-image-tagging',
        },
        pattern: detectedDetails.pattern || undefined,
        material: detectedDetails.material || undefined,
        fit: detectedDetails.fit || undefined,
        lengthType: detectedDetails.lengthType || undefined,
        sleeveType: detectedDetails.sleeveType || undefined,
        neckline: detectedDetails.neckline || undefined,
        silhouette: detectedDetails.silhouette || undefined,
        aiConfidence: detectionConfidence ?? undefined,
      });

      if (outcome.status === 'failed') {
        // The database definitively refused the row, so the uploaded photo would be orphaned.
        if (attempt.path) await wardrobeService.removeWardrobeImage(attempt.path);
        attemptRef.current = null;
        throw outcome.error;
      }
      if (outcome.status === 'unknown') {
        // Not confirmed either way: keep the id and the upload so tapping Add again cannot create a duplicate.
        const err: any = new Error('We could not confirm the item was saved.');
        err.isUnconfirmed = true;
        throw err;
      }
      attemptRef.current = null;

      if (myGeneration !== saveGenerationRef.current) return;
      saveStartedAtRef.current = null;

      // Reset form
      setImageUri(null);
      setProcessedImageUri(null);
      setRawPickedUri(null);
      setRawPickedSize(null);
      setTagSuggestion(null);
      setDetectedDetails(EMPTY_STYLING_DETAILS);
      setDetectionConfidence(null);
      setShowStylingDetails(false);
      setCategory('');
      setSubCategory('');
      setColor('');
      setWhereWornOften('');
      setDescription('');
      setUserNotes('');

      const goToWardrobe = () => router.replace('/wardrobe?tab=items');
      if (Platform.OS === 'web') {
        showToast('Item added to your wardrobe.', 'success');
        goToWardrobe();
      } else {
        notifySuccess();
        Alert.alert('Item Added', 'Item added to your wardrobe.', [
          { text: 'Done', onPress: goToWardrobe },
        ]);
      }
    } catch (err: any) {
      if (myGeneration !== saveGenerationRef.current) return;
      saveStartedAtRef.current = null;
      console.error('Error saving wardrobe item:', err);
      let userMessage = err?.message || 'Failed to save item. Try again.';
      if (err?.exhaustedRetries) {
        userMessage = 'Still stuck after several tries. Please reload the app and try again.';
      } else if (err?.isUnconfirmed || err?.isTimeout) {
        userMessage = 'We could not confirm the save. Check your connection and tap Add to Wardrobe again; it will not create a duplicate.';
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
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Add New Item</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
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
                <TouchableOpacity style={styles.removeImageBtn} onPress={() => { setImageUri(null); setTagSuggestion(null); setDetectedDetails(EMPTY_STYLING_DETAILS); setDetectionConfidence(null); setShowStylingDetails(false); }}>
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

          {/* Background Removal toggle */}
          <View style={[styles.formRow, styles.switchRow]}>
            <View style={{ flex: 1, paddingRight: Spacing.lg }}>
              <Text style={[styles.label, { color: colors.text }]}>Remove Background</Text>
              <Text style={[styles.subLabel, { color: colors.secondaryText }]}>
                Automatically isolate clothing item using on-device processing
              </Text>
            </View>
            <Switch
              value={removeBg}
              onValueChange={setRemoveBg}
              trackColor={{ false: '#767577', true: colors.tint }}
              thumbColor={Platform.OS === 'android' ? (removeBg ? 'white' : '#f4f3f4') : undefined}
            />
          </View>

          {backgroundRemovalError && (
            <View style={[styles.backgroundRemovalError, { borderColor: colors.border, backgroundColor: colors.card }]}>
              <Text style={[styles.subLabel, { color: colors.secondaryText }]}>{backgroundRemovalError}</Text>
              <TouchableOpacity onPress={() => setBackgroundRemovalAttempt((attempt) => attempt + 1)} accessibilityRole="button" accessibilityLabel="Try background removal again">
                <Text style={[styles.retryBackgroundRemovalText, { color: colors.tint }]}>Try again</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.autoDetectCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <View style={styles.autoDetectCopy}>
              <Text style={[styles.label, { color: colors.text }]}>Auto-detect details</Text>
              <Text style={[styles.subLabel, { color: colors.secondaryText }]}>Optional. Your photo is analyzed only when you tap this button.</Text>
            </View>
            <TouchableOpacity
              style={[styles.autoDetectButton, { borderColor: colors.tint, opacity: imageUri && !isTagging ? 1 : 0.5 }]}
              onPress={handleAutoDetect}
              disabled={!imageUri || isTagging}
              accessibilityRole="button"
              accessibilityLabel={isTagging ? 'Detecting clothing details' : 'Auto-detect clothing details'}
            >
              {isTagging ? <ActivityIndicator color={colors.tint} size="small" /> : <IconSymbol name="sparkles" size={16} color={colors.tint} />}
              <Text style={[styles.autoDetectButtonText, { color: colors.tint }]}>{isTagging ? 'Detecting...' : 'Auto-detect'}</Text>
            </TouchableOpacity>
          </View>

          {tagSuggestion && (
            <View style={[styles.suggestionCard, { borderColor: colors.tint + '66', backgroundColor: colors.tint + '10' }]}>
              <Text style={[styles.label, { color: colors.text }]}>Suggested details</Text>
              <Text style={[styles.suggestionText, { color: colors.secondaryText }]}>
                {tagSuggestion.category} · {tagSuggestion.subCategory} · {tagSuggestion.primaryColor}
              </Text>
              <Text style={[styles.subLabel, { color: colors.secondaryText }]}>
                {tagSuggestion.colorTags.join(', ')} · {tagSuggestion.pattern} pattern · {tagSuggestion.material} appearance · {tagSuggestion.fit} fit
              </Text>
              <Text style={[styles.subLabel, { color: colors.secondaryText }]}>
                {tagSuggestion.lengthType} length · {tagSuggestion.sleeveType} sleeves · {tagSuggestion.neckline} neckline · {tagSuggestion.silhouette} silhouette
              </Text>
              <Text style={[styles.subLabel, { color: colors.secondaryText }]}>Review before applying. You can edit every field before saving.</Text>
              <View style={styles.suggestionActions}>
                <TouchableOpacity style={[styles.applySuggestionButton, { backgroundColor: colors.tint }]} onPress={applyTagSuggestion}>
                  <Text style={[styles.applySuggestionText, { color: colors.onTint }]}>Apply suggestions</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.dismissSuggestionButton} onPress={() => setTagSuggestion(null)}>
                  <Text style={[styles.dismissSuggestionText, { color: colors.secondaryText }]}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Primary Item Information Flow */}
          <View style={styles.form}>
            {/* Category */}
            <View style={styles.formRow}>
              <Text style={[styles.label, { color: colors.text }]}>Category</Text>
              <TextInput
                keyboardAppearance={theme}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                placeholder="Example: Dress"
                placeholderTextColor={colors.secondaryText}
                value={category}
                onChangeText={setCategory}
              />
            </View>

            {/* Sub Category */}
            <View style={styles.formRow}>
              <Text style={[styles.label, { color: colors.text }]}>Sub Category</Text>
              <TextInput
                keyboardAppearance={theme}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                placeholder="Example: Maxi Dress"
                placeholderTextColor={colors.secondaryText}
                value={subCategory}
                onChangeText={setSubCategory}
              />
            </View>

            {/* Color */}
            <View style={styles.formRow}>
              <Text style={[styles.label, { color: colors.text }]}>Color</Text>
              <TextInput
                keyboardAppearance={theme}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                placeholder="Example: Navy Blue"
                placeholderTextColor={colors.secondaryText}
                value={color}
                onChangeText={setColor}
              />
            </View>

            {!showStylingDetails && (
              <TouchableOpacity
                style={[styles.additionalDetailsButton, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => setShowStylingDetails(true)}
                accessibilityRole="button"
                accessibilityLabel="Add optional styling details manually"
              >
                <Text style={[styles.label, { color: colors.text }]}>Add styling details (optional)</Text>
                <Text style={[styles.subLabel, { color: colors.secondaryText }]}>Pattern, material, fit, cut, and more</Text>
              </TouchableOpacity>
            )}

            {showStylingDetails && (
              <View style={[styles.detectedDetailsCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <View style={styles.stylingDetailsHeader}>
                  <View>
                    <Text style={[styles.label, { color: colors.text }]}>{detectionConfidence === null ? 'Styling details (optional)' : 'Detected styling details'}</Text>
                    <Text style={[styles.subLabel, { color: colors.secondaryText }]}>{detectionConfidence === null ? 'Add details manually to improve recommendations.' : 'Optional suggestions. Correct or clear anything before saving.'}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setShowStylingDetails(false)} accessibilityRole="button" accessibilityLabel="Hide styling details">
                    <Text style={[styles.hideStylingDetailsText, { color: colors.tint }]}>Hide</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.detectedDetailsGrid}>
                  {[
                    ['Pattern', 'pattern', 'Example: striped'],
                    ['Material appearance', 'material', 'Example: linen'],
                    ['Fit', 'fit', 'Example: relaxed'],
                    ['Length', 'lengthType', 'Example: midi'],
                    ['Sleeves', 'sleeveType', 'Example: long'],
                    ['Neckline', 'neckline', 'Example: v-neck'],
                    ['Silhouette', 'silhouette', 'Example: a-line'],
                  ].map(([label, key, placeholder]) => (
                    <View style={styles.formRow} key={key}>
                      <Text style={[styles.subLabel, { color: colors.secondaryText }]}>{label}</Text>
                      <TextInput
                        keyboardAppearance={theme}
                        style={[styles.input, styles.detectedDetailInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                        placeholder={placeholder}
                        placeholderTextColor={colors.secondaryText}
                        value={detectedDetails[key as keyof typeof detectedDetails]}
                        onChangeText={(value) => setDetectedDetails((current) => ({ ...current, [key]: value }))}
                      />
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Where do you wear this often? */}
            <View style={styles.formRow}>
              <Text style={[styles.label, { color: colors.text }]}>Where do you wear this often?</Text>
              <TextInput
                keyboardAppearance={theme}
                style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                placeholder="Example: Casual"
                placeholderTextColor={colors.secondaryText}
                value={whereWornOften}
                onChangeText={setWhereWornOften}
              />
            </View>

            {/* Description */}
            <View style={styles.formRow}>
              <Text style={[styles.label, { color: colors.text }]}>Description</Text>
              <TextInput
                keyboardAppearance={theme}
                style={[
                  styles.input,
                  styles.textArea,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }
                ]}
                placeholder="Describe your item"
                placeholderTextColor={colors.secondaryText}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
                maxLength={2000}
              />
            </View>

            {/* Personal Notes (Optional) */}
            <View style={styles.formRow}>
              <Text style={[styles.label, { color: colors.text }]}>Personal Notes (Optional)</Text>
              <TextInput
                keyboardAppearance={theme}
                style={[
                  styles.input,
                  styles.compactNotesArea,
                  { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }
                ]}
                placeholder="Example: I love wearing this with sneakers."
                placeholderTextColor={colors.secondaryText}
                value={userNotes}
                onChangeText={setUserNotes}
                multiline
                numberOfLines={2}
                maxLength={2000}
              />
            </View>
          </View>

          {/* Action Button */}
          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: colors.tint, opacity: imageUri && !saving ? 1 : 0.6 }]}
            onPress={handleSave}
            disabled={!imageUri || saving}
            accessibilityRole="button"
            accessibilityLabel={saving ? (statusMessage || 'Saving...') : 'Add to Wardrobe'}
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
          
          <View style={{ height: 20 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <ImageCropModal
        visible={cropModalVisible}
        uri={rawPickedUri}
        initialSize={rawPickedSize}
        onConfirm={handleCropComplete}
        onCancel={handleCropCancel}
      />
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
    padding: Spacing.xs,
    width: 40,
  },
  headerTitle: {
    ...Type.subtitle,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  imageContainer: {
    width: '100%',
    height: width * 0.75,
    maxHeight: 320,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  pickerButtons: {
    flexDirection: 'row',
    gap: Spacing.xl,
  },
  pickerBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
    height: 100,
    borderRadius: Radius.md,
    gap: Spacing.xs,
  },
  pickerBtnText: {
    ...Type.caption,
    fontWeight: '600',
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
  processingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  processingText: {
    ...Type.caption,
    fontWeight: '600',
  },
  removeImageBtn: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: Spacing.sm,
    borderRadius: Radius.pill,
  },
  form: {
    gap: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  formRow: {
    gap: Spacing.xs,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  autoDetectCard: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  backgroundRemovalError: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.xs,
  },
  retryBackgroundRemovalText: {
    ...Type.caption,
    fontWeight: '700',
  },
  autoDetectCopy: {
    gap: 2,
  },
  autoDetectButton: {
    height: 42,
    borderWidth: 1,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  autoDetectButtonText: {
    ...Type.caption,
    fontWeight: '700',
  },
  suggestionCard: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: Spacing.xs,
  },
  detectedDetailsCard: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  additionalDetailsButton: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  stylingDetailsHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  hideStylingDetailsText: {
    ...Type.caption,
    fontWeight: '700',
    paddingVertical: Spacing.xs,
  },
  detectedDetailsGrid: {
    gap: Spacing.sm,
  },
  suggestionText: {
    ...Type.bodyStrong,
  },
  suggestionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  applySuggestionButton: {
    height: 40,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    justifyContent: 'center',
  },
  applySuggestionText: {
    ...Type.caption,
    fontWeight: '700',
  },
  dismissSuggestionButton: {
    height: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  dismissSuggestionText: {
    ...Type.caption,
    fontWeight: '600',
  },
  label: {
    ...Type.body,
    fontWeight: '600',
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
  detectedDetailInput: {
    height: 44,
  },
  textArea: {
    height: 110,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },
  compactNotesArea: {
    height: 64,
    paddingTop: 10,
    paddingBottom: 10,
    textAlignVertical: 'top',
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
