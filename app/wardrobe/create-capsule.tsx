import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import { useToast } from '@/src/context/ToastContext';

export default function CreateCapsuleScreen() {
  const { showToast } = useToast();
  const router = useRouter();
  const theme = useColorScheme();
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
      showToast('Please give your capsule a name.', 'error');
      return;
    }
    const parsedTarget = parseInt(targetCount, 10);
    if (!Number.isFinite(parsedTarget) || parsedTarget <= 0) {
      showToast('Target item count must be a positive number.', 'error');
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
      showToast(err.message || 'Could not create the capsule. Please try again.', 'error');
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

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
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
            {saving ? <ActivityIndicator color={colors.onTint} /> : <Text style={[styles.saveButtonText, { color: colors.onTint }]}>Create Capsule</Text>}
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  backButton: { padding: Spacing.xs },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  form: { padding: Spacing.xl, gap: Spacing.xl },
  formRow: { gap: Spacing.sm },
  label: { fontSize: 16, fontWeight: '700' },
  input: {
    minHeight: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    fontSize: 15,
  },
  saveButton: {
    height: 56,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
