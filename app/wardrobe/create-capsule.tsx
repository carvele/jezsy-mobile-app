import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';

export default function CreateCapsuleScreen() {
  const router = useRouter();
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const { session } = useAuth();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetCount, setTargetCount] = useState('30');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!session?.user?.id) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Name Required', 'Please give your capsule a name.');
      return;
    }
    const parsedTarget = parseInt(targetCount, 10);
    if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      Alert.alert('Invalid Target', 'Target item count must be a positive number.');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('capsules')
        .insert({
          user_id: session.user.id,
          name: trimmedName,
          description: description.trim() || null,
          target_count: parsedTarget,
        })
        .select('id')
        .single();
      if (error) throw error;
      router.replace(`/wardrobe/capsule/${data.id}` as any);
    } catch (err: any) {
      console.error('Error creating capsule:', err);
      Alert.alert('Save Failed', err.message || 'Could not create the capsule. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton} accessibilityRole="button" accessibilityLabel="Go back">
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>New Capsule</Text>
        <View style={{ width: 32 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.form}>
          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Name</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="e.g. Work Capsule, Summer Trip"
              placeholderTextColor={colors.secondaryText}
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Description (Optional)</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="What's this capsule for?"
              placeholderTextColor={colors.secondaryText}
              value={description}
              onChangeText={setDescription}
              multiline
            />
          </View>

          <View style={styles.formRow}>
            <Text style={[styles.label, { color: colors.text }]}>Target Item Count</Text>
            <TextInput
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="30"
              placeholderTextColor={colors.secondaryText}
              value={targetCount}
              onChangeText={setTargetCount}
              keyboardType="number-pad"
            />
          </View>

          <TouchableOpacity
            style={[styles.saveButton, { backgroundColor: colors.tint, opacity: saving ? 0.6 : 1 }]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#0D0D0D" /> : <Text style={styles.saveButtonText}>Create Capsule</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  form: { padding: 20, gap: 20 },
  formRow: { gap: 8 },
  label: { fontSize: 16, fontWeight: '700' },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
  },
  saveButton: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  saveButtonText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '800',
  },
});
