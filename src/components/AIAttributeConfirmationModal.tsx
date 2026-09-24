import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { ColorDetailItem, GarmentAnalysisResult, UserCorrections } from '../types/dto/aiAttributes';
import { ColorPickerModal } from './ColorPickerModal';

interface AIAttributeConfirmationModalProps {
  visible: boolean;
  analysis: GarmentAnalysisResult | null;
  onConfirm: (confirmed: GarmentAnalysisResult, corrections: UserCorrections | null) => void;
  onCancel: () => void;
}

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
  'Dinner'
];

const COMMON_PATTERNS = ['Solid', 'Striped', 'Floral', 'Plaid', 'Polka Dot', 'Graphic', 'Animal Print'];
const COMMON_FITS = ['Regular', 'Slim', 'Oversized', 'Tailored', 'Loose', 'Fitted'];
const COMMON_MATERIALS = ['Cotton', 'Denim', 'Linen', 'Silk', 'Wool', 'Polyester', 'Leather', 'Knit'];

export const AIAttributeConfirmationModal: React.FC<AIAttributeConfirmationModalProps> = ({
  visible,
  analysis,
  onConfirm,
  onCancel
}) => {
  // Editable state initialized from AI analysis (hooks called unconditionally)
  const [garmentType, setGarmentType] = useState<string>(analysis?.garmentType || 'Top');
  const [category, setCategory] = useState<string>(analysis?.category || 'Evening Wear');
  const [subcategory, setSubcategory] = useState<string>(analysis?.subcategory || '');
  const [colors, setColors] = useState<ColorDetailItem[]>(analysis?.colors || []);
  const [pattern, setPattern] = useState<string>(analysis?.pattern || 'Solid');
  const [material, setMaterial] = useState<string>(analysis?.material || 'Cotton');
  const [fit, setFit] = useState<string>(analysis?.fit || 'Regular');
  const [selectedOccasions, setSelectedOccasions] = useState<string[]>(analysis?.occasions || ['Casual']);
  const [customOccasion, setCustomOccasion] = useState<string>('');

  // Color picker sub-modal
  const [colorPickerVisible, setColorPickerVisible] = useState(false);
  const [editingColorIndex, setEditingColorIndex] = useState<number | null>(null);

  // Sync state whenever analysis prop changes
  React.useEffect(() => {
    if (analysis) {
      setGarmentType(analysis.garmentType || 'Top');
      setCategory(analysis.category || 'Evening Wear');
      setSubcategory(analysis.subcategory || '');
      setColors(analysis.colors || []);
      setPattern(analysis.pattern || 'Solid');
      setMaterial(analysis.material || 'Cotton');
      setFit(analysis.fit || 'Regular');
      setSelectedOccasions(analysis.occasions || ['Casual']);
    }
  }, [analysis]);

  if (!analysis || !visible) return null;

  const toggleOccasion = (occ: string) => {
    setSelectedOccasions((prev) =>
      prev.includes(occ) ? prev.filter((o) => o !== occ) : [...prev, occ]
    );
  };

  const handleAddCustomOccasion = () => {
    if (customOccasion.trim() && !selectedOccasions.includes(customOccasion.trim())) {
      setSelectedOccasions((prev) => [...prev, customOccasion.trim()]);
      setCustomOccasion('');
    }
  };

  const handleRemoveColor = (index: number) => {
    setColors((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveColor = (color: ColorDetailItem) => {
    if (editingColorIndex !== null) {
      setColors((prev) => {
        const next = [...prev];
        next[editingColorIndex] = color;
        return next;
      });
      setEditingColorIndex(null);
    } else {
      setColors((prev) => [...prev, color]);
    }
  };

  const handleConfirm = () => {
    // Detect corrections
    let hasCorrections = false;
    const original: UserCorrections['original'] = {
      garmentType: analysis.garmentType,
      category: analysis.category,
      subcategory: analysis.subcategory,
      colors: analysis.colors.map((c) => c.name),
      pattern: analysis.pattern,
      material: analysis.material,
      fit: analysis.fit,
      occasions: analysis.occasions
    };

    const corrected: UserCorrections['corrected'] = {
      garmentType,
      category,
      subcategory,
      colors: colors.map((c) => c.name),
      pattern,
      material,
      fit,
      occasions: selectedOccasions
    };

    if (
      garmentType !== analysis.garmentType ||
      category !== analysis.category ||
      subcategory !== analysis.subcategory ||
      pattern !== analysis.pattern ||
      material !== analysis.material ||
      fit !== analysis.fit ||
      JSON.stringify(selectedOccasions.sort()) !== JSON.stringify((analysis.occasions || []).sort())
    ) {
      hasCorrections = true;
    }

    const corrections: UserCorrections | null = hasCorrections
      ? {
          original,
          corrected,
          correctedAt: new Date().toISOString()
        }
      : null;

    const finalResult: GarmentAnalysisResult = {
      ...analysis,
      garmentType,
      category,
      subcategory,
      colors,
      pattern,
      material,
      fit,
      occasions: selectedOccasions
    };

    onConfirm(finalResult, corrections);
  };

  const confidencePercent = Math.round(analysis.confidence * 100);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>AI Clothing Analysis</Text>
              <Text style={styles.headerSubtitle}>Review and adjust detected characteristics</Text>
            </View>
            <View
              style={[
                styles.confidenceBadge,
                confidencePercent >= 80 ? styles.badgeHigh : styles.badgeMedium
              ]}
            >
              <Text style={styles.confidenceText}>{confidencePercent}% Match</Text>
            </View>
          </View>

          <ScrollView
            style={styles.scrollArea}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {/* Classification */}
            <Text style={styles.sectionTitle}>Garment Classification</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Garment Type</Text>
              <TextInput
                style={styles.input}
                value={garmentType}
                onChangeText={setGarmentType}
                placeholder="e.g. Top, Bottom, Dress"
                placeholderTextColor="#666"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Category</Text>
              <TextInput
                style={styles.input}
                value={category}
                onChangeText={setCategory}
                placeholder="e.g. Evening Wear, Shirts"
                placeholderTextColor="#666"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Subcategory / Cut</Text>
              <TextInput
                style={styles.input}
                value={subcategory}
                onChangeText={setSubcategory}
                placeholder="e.g. Polo Shirt, Chinos"
                placeholderTextColor="#666"
              />
            </View>

            {/* Colors */}
            <View style={styles.colorHeader}>
              <Text style={styles.sectionTitle}>Colors</Text>
              <TouchableOpacity
                onPress={() => {
                  setEditingColorIndex(null);
                  setColorPickerVisible(true);
                }}
              >
                <Text style={styles.addColorText}>+ Add Color</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.colorChipsRow}>
              {colors.map((c, i) => (
                <TouchableOpacity
                  key={`${c.hex}_${i}`}
                  style={styles.colorChip}
                  onPress={() => {
                    setEditingColorIndex(i);
                    setColorPickerVisible(true);
                  }}
                >
                  <View style={[styles.chipSwatch, { backgroundColor: c.hex }]} />
                  <Text style={styles.chipText}>{c.name}</Text>
                  <Text style={styles.chipRole}>({c.role.slice(0, 3)})</Text>
                  <TouchableOpacity onPress={() => handleRemoveColor(i)} style={styles.removeColorBtn}>
                    <Text style={styles.removeColorText}>×</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              ))}
            </View>

            {/* Pattern */}
            <Text style={styles.sectionTitle}>Pattern</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {COMMON_PATTERNS.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.pill, pattern === p && styles.pillActive]}
                  onPress={() => setPattern(p)}
                >
                  <Text style={[styles.pillText, pattern === p && styles.pillTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Material */}
            <Text style={styles.sectionTitle}>Material</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {COMMON_MATERIALS.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.pill, material === m && styles.pillActive]}
                  onPress={() => setMaterial(m)}
                >
                  <Text style={[styles.pillText, material === m && styles.pillTextActive]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Fit */}
            <Text style={styles.sectionTitle}>Fit</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              {COMMON_FITS.map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[styles.pill, fit === f && styles.pillActive]}
                  onPress={() => setFit(f)}
                >
                  <Text style={[styles.pillText, fit === f && styles.pillTextActive]}>{f}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Occasions */}
            <Text style={styles.sectionTitle}>Occasions</Text>
            <View style={styles.occasionsWrap}>
              {COMMON_OCCASIONS.map((occ) => {
                const active = selectedOccasions.includes(occ);
                return (
                  <TouchableOpacity
                    key={occ}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => toggleOccasion(occ)}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>{occ}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Custom Occasion Input */}
            <View style={styles.customOccasionRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={customOccasion}
                onChangeText={setCustomOccasion}
                placeholder="Add custom occasion..."
                placeholderTextColor="#666"
              />
              <TouchableOpacity style={styles.addCustomBtn} onPress={handleAddCustomOccasion}>
                <Text style={styles.addCustomText}>Add</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* Action Footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelBtnText}>Discard</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
              <Text style={styles.confirmBtnText}>Confirm & Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      <ColorPickerModal
        visible={colorPickerVisible}
        initialColor={editingColorIndex !== null ? colors[editingColorIndex] : null}
        onSave={handleSaveColor}
        onClose={() => {
          setColorPickerVisible(false);
          setEditingColorIndex(null);
        }}
      />
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'flex-end'
  },
  container: {
    backgroundColor: '#181818',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    flexShrink: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#282828'
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#E6C687'
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2
  },
  confidenceBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12
  },
  badgeHigh: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)'
  },
  badgeMedium: {
    backgroundColor: 'rgba(234, 179, 8, 0.2)'
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E6C687'
  },
  scrollArea: {
    maxHeight: 500,
    flexShrink: 1,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#E5E7EB',
    marginTop: 14,
    marginBottom: 8
  },
  inputGroup: {
    marginBottom: 10
  },
  inputLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 4
  },
  input: {
    backgroundColor: '#242424',
    color: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#333333'
  },
  colorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8
  },
  addColorText: {
    color: '#E6C687',
    fontSize: 13,
    fontWeight: '600'
  },
  colorChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 6
  },
  colorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#242424',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151'
  },
  chipSwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 6
  },
  chipText: {
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '500'
  },
  chipRole: {
    color: '#9CA3AF',
    fontSize: 11,
    marginLeft: 4
  },
  removeColorBtn: {
    marginLeft: 6,
    paddingHorizontal: 4
  },
  removeColorText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '700'
  },
  chipScroll: {
    flexDirection: 'row',
    marginBottom: 4
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#242424',
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333'
  },
  pillActive: {
    backgroundColor: '#E6C687',
    borderColor: '#E6C687'
  },
  pillText: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '500'
  },
  pillTextActive: {
    color: '#121212',
    fontWeight: '700'
  },
  occasionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  customOccasionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    marginBottom: 16
  },
  addCustomBtn: {
    backgroundColor: '#2A2A2A',
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#374151'
  },
  addCustomText: {
    color: '#E6C687',
    fontWeight: '600',
    fontSize: 13
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#282828'
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#242424',
    alignItems: 'center'
  },
  cancelBtnText: {
    color: '#9CA3AF',
    fontSize: 15,
    fontWeight: '600'
  },
  confirmBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: '#E6C687',
    alignItems: 'center'
  },
  confirmBtnText: {
    color: '#121212',
    fontSize: 15,
    fontWeight: '700'
  }
});
