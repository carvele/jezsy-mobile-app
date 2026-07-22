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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { removeBackground } from '@six33/react-native-bg-removal';
import { ColorOption, DEFAULT_COLOR_OPTIONS, fetchColorOptions } from '@/src/utils/colorOptions';

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
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const router = useRouter();
  const { session } = useAuth();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [processedImageUri, setProcessedImageUri] = useState<string | null>(null);
  const [isProcessingBg, setIsProcessingBg] = useState<boolean>(false);
  
  const [category, setCategory] = useState<string>('Evening Wear');
  const [garmentType, setGarmentType] = useState<GarmentType | null>(null);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [colorOptions, setColorOptions] = useState<ColorOption[]>(DEFAULT_COLOR_OPTIONS);
  const [subCategory, setSubCategory] = useState<string>('');
  const [removeBg, setRemoveBg] = useState<boolean>(true);
  
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
        // Attempting native background removal (Phase 2: On-Device ML)
        // Verified to work with Fabric/TurboModules where supported.
        const bgRemovedUri = await removeBackground(imageUri);
        if (isMounted && bgRemovedUri) {
          setProcessedImageUri(bgRemovedUri);
        }
      } catch (e) {
        console.warn('Native background removal failed, falling back to original image:', e);
        if (isMounted) {
          setProcessedImageUri(null);
          // If native module fails (e.g., missing dependencies or unsupported device),
          // fallback to manual/original image. 
          Alert.alert(
            'Background Removal Failed',
            'On-device background removal is not supported on this device. Using original image instead.',
            [{ text: 'OK' }]
          );
          setRemoveBg(false);
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
          Alert.alert('Permission Denied', 'Camera permission is required to snap photos.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [3, 4],
          quality: 0.8,
        });
      } else {
        const libraryPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!libraryPerm.granted) {
          Alert.alert('Permission Denied', 'Gallery permission is required to choose photos.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [3, 4],
          quality: 0.8,
        });
      }

      if (!result.canceled && result.assets?.[0]) {
        setImageUri(result.assets[0].uri);
      }
    } catch (e) {
      console.error('Error picking image:', e);
      Alert.alert('Error', 'An error occurred while picking the image.');
    }
  };

  const toggleColor = (colorName: string) => {
    setSelectedColors((prev) =>
      prev.includes(colorName)
        ? prev.filter((c) => c !== colorName)
        : [...prev, colorName]
    );
  };

  const handleSave = async () => {
    if (!session?.user?.id) {
      Alert.alert('Authentication Required', 'You must be logged in to add items.');
      return;
    }
    if (!imageUri) {
      Alert.alert('No Image', 'Please select or capture a photo first.');
      return;
    }
    if (!garmentType) {
      Alert.alert('Missing Type', 'Please choose a garment type (Top, Bottom, etc.) so it can be included in wardrobe insights.');
      return;
    }

    setSaving(true);
    try {
      // Use processed image if background removal was enabled and successful
      let finalUri = (removeBg && processedImageUri) ? processedImageUri : imageUri;

      setStatusMessage('Uploading to storage...');
      const ext = finalUri.includes('.')
        ? finalUri.substring(finalUri.lastIndexOf('.') + 1).split('?')[0]
        : 'jpg';
      const fileName = `${session.user.id}/${Date.now()}.${ext}`;

      const formData = new FormData();
      formData.append('file', {
        uri: finalUri,
        name: fileName.split('/').pop() || `photo.${ext}`,
        type: `image/${ext}`,
      } as any);

      // Upload to supabase storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('wardrobe-images')
        .upload(fileName, formData, { upsert: false, contentType: `image/${ext}` });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('wardrobe-images')
        .getPublicUrl(uploadData.path);

      setStatusMessage('Saving details...');
      // Insert wardrobe item row
      const { error: dbError } = await supabase.from('wardrobe_items').insert({
        user_id: session.user.id,
        category,
        garment_type: garmentType,
        sub_category: subCategory.trim() || null,
        image_url: publicUrl,
        color_tags: selectedColors,
      });

      if (dbError) throw dbError;

      Alert.alert('Success', 'Item added to your wardrobe.', [
        { text: 'Awesome', onPress: () => router.back() }
      ]);
    } catch (err: any) {
      console.error('Error saving wardrobe item:', err);
      Alert.alert('Save Failed', err.message || 'Could not save item. Please try again.');
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
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={[styles.label, { color: colors.text }]}>Remove Background</Text>
              <Text style={[styles.subLabel, { color: colors.secondaryText }]}>
                Cut out the clothing item automatically using on-device ML
              </Text>
            </View>
            <Switch
              value={removeBg}
              onValueChange={setRemoveBg}
              trackColor={{ false: '#767577', true: colors.tint }}
              thumbColor={Platform.OS === 'android' ? (removeBg ? '#fff' : '#f4f3f4') : undefined}
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
                    <Text style={[styles.chipText, { color: isSelected ? '#0D0D0D' : colors.text }]}>
                      {type}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Category Dropdown/Selector */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {CATEGORIES.map((cat) => {
                const isSelected = category === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.chip,
                      { borderColor: colors.border, backgroundColor: isSelected ? colors.tint : colors.card }
                    ]}
                    onPress={() => setCategory(cat)}
                  >
                    <Text style={[styles.chipText, { color: isSelected ? '#0D0D0D' : colors.text }]}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Subcategory description */}
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Detail / Style Code (Optional)</Text>
            <TextInput
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
                        color={col.name === 'White' || col.name === 'Gold' || col.name === 'Silver' ? '#000000' : '#FFFFFF'}
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
              <ActivityIndicator color="#0D0D0D" size="small" />
              <Text style={styles.saveButtonText}>{statusMessage || 'Saving...'}</Text>
            </View>
          ) : (
            <Text style={styles.saveButtonText}>Add to Wardrobe</Text>
          )}
        </TouchableOpacity>
        
        <View style={{ height: 60 }} />
      </ScrollView>
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
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    padding: 20,
  },
  imageContainer: {
    height: width * 0.9,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
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
    width: 40,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    padding: 8,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 16,
  },
  processingText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  pickerButtons: {
    flexDirection: 'row',
    gap: 20,
  },
  pickerBtn: {
    width: 120,
    height: 120,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  pickerBtnText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  form: {
    gap: 20,
    marginBottom: 32,
  },
  formRow: {
    gap: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
  },
  subLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 15,
  },
  chipRow: {
    paddingVertical: 4,
    gap: 8,
  },
  chipWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  colorPalette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 4,
  },
  colorCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveButton: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#C9A96E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  saveButtonText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '800',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
