import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet
} from 'react-native';
import { ColorDetailItem, ColorRole } from '../types/dto/aiAttributes';

interface ColorPickerModalProps {
  visible: boolean;
  initialColor?: ColorDetailItem | null;
  onSave: (color: ColorDetailItem) => void;
  onClose: () => void;
}

const PRESET_SWATCHES = [
  { name: 'Black', hex: '#111827' },
  { name: 'White', hex: '#FFFFFF' },
  { name: 'Navy', hex: '#1E3A8A' },
  { name: 'Beige', hex: '#D4B996' },
  { name: 'Cream', hex: '#FFFDD0' },
  { name: 'Grey', hex: '#6B7280' },
  { name: 'Camel', hex: '#C19A6B' },
  { name: 'Brown', hex: '#78350F' },
  { name: 'Burgundy', hex: '#800020' },
  { name: 'Olive', hex: '#556B2F' },
  { name: 'Forest Green', hex: '#064E3B' },
  { name: 'Sage', hex: '#9CA38F' },
  { name: 'Sky Blue', hex: '#38BDF8' },
  { name: 'Denim Blue', hex: '#3B82F6' },
  { name: 'Blush Pink', hex: '#FBCFE8' },
  { name: 'Red', hex: '#DC2626' },
  { name: 'Gold', hex: '#D4AF37' },
  { name: 'Silver', hex: '#C0C0C0' },
  { name: 'Rust', hex: '#C2410C' },
  { name: 'Teal', hex: '#0F766E' }
];

export const ColorPickerModal: React.FC<ColorPickerModalProps> = ({
  visible,
  initialColor,
  onSave,
  onClose
}) => {
  const [hex, setHex] = useState<string>(initialColor?.hex || '#111827');
  const [name, setName] = useState<string>(initialColor?.name || 'Custom Color');
  const [role, setRole] = useState<ColorRole>(initialColor?.role || 'dominant');

  const handleSelectPreset = (preset: { name: string; hex: string }) => {
    setHex(preset.hex);
    setName(preset.name);
  };

  const handleConfirm = () => {
    const cleanHex = hex.startsWith('#') ? hex : `#${hex}`;
    onSave({
      name: name.trim() || 'Custom Color',
      hex: cleanHex,
      role,
      confidence: 1.0
    });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>Add Another Color</Text>

          {/* Color Preview & HEX */}
          <View style={styles.previewRow}>
            <View style={[styles.previewCircle, { backgroundColor: hex }]} />
            <View style={styles.inputContainer}>
              <Text style={styles.label}>Color Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Navy Blue, Charcoal"
                placeholderTextColor="#666"
              />
              <Text style={[styles.label, { marginTop: 8 }]}>HEX Code</Text>
              <TextInput
                style={styles.input}
                value={hex}
                onChangeText={setHex}
                placeholder="#RRGGBB"
                placeholderTextColor="#666"
                autoCapitalize="characters"
              />
            </View>
          </View>

          {/* Role Selection */}
          <Text style={styles.sectionLabel}>Color Role</Text>
          <View style={styles.roleRow}>
            {[
              { id: 'dominant', label: 'Main color' },
              { id: 'secondary', label: 'Other color' },
              { id: 'accent', label: 'Accent color' },
            ].map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.roleChip, role === item.id && styles.roleChipActive]}
                onPress={() => setRole(item.id as ColorRole)}
              >
                <Text style={[styles.roleText, role === item.id && styles.roleTextActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Preset Swatches */}
          <Text style={styles.sectionLabel}>Quick Swatches</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.swatchScroll}>
            {PRESET_SWATCHES.map((swatch) => (
              <TouchableOpacity
                key={swatch.hex}
                style={[
                  styles.swatch,
                  { backgroundColor: swatch.hex },
                  hex.toLowerCase() === swatch.hex.toLowerCase() && styles.swatchSelected
                ]}
                onPress={() => handleSelectPreset(swatch)}
              />
            ))}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={handleConfirm}>
              <Text style={styles.saveText}>Add Color</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end'
  },
  container: {
    backgroundColor: '#1E1E1E',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '80%'
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#E6C687',
    marginBottom: 16
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16
  },
  previewCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: '#E6C687',
    marginRight: 16
  },
  inputContainer: {
    flex: 1
  },
  label: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 4
  },
  input: {
    backgroundColor: '#2A2A2A',
    color: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#374151'
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E5E7EB',
    marginTop: 12,
    marginBottom: 8
  },
  roleRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16
  },
  roleChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151'
  },
  roleChipActive: {
    backgroundColor: '#E6C687',
    borderColor: '#E6C687'
  },
  roleText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '600'
  },
  roleTextActive: {
    color: '#121212'
  },
  swatchScroll: {
    flexDirection: 'row',
    marginBottom: 24
  },
  swatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#4B5563'
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: '#E6C687'
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#2A2A2A',
    alignItems: 'center'
  },
  cancelText: {
    color: '#9CA3AF',
    fontSize: 15,
    fontWeight: '600'
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#E6C687',
    alignItems: 'center'
  },
  saveText: {
    color: '#121212',
    fontSize: 15,
    fontWeight: '700'
  }
});
