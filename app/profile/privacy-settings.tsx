import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Switch, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useToast } from '@/src/context/ToastContext';

export default function PrivacySettingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();
  const colors = Colors.light;

  const [isShared, setIsShared] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (user) {
      loadPrivacySettings();
    }
  }, [user]);

  const loadPrivacySettings = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user!.id)
        .single();
      
      if (error) throw error;
      setIsShared(!!(data as any)?.is_wardrobe_shared);
    } catch (err: any) {
      console.log('Error loading privacy settings:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = async (nextValue: boolean) => {
    if (!user) return;
    setUpdating(true);
    // Optimistic update
    setIsShared(nextValue);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_wardrobe_shared: nextValue } as any)
        .eq('id', user.id);

      if (error) {
        throw error;
      }
      
      showToast(nextValue ? 'Wardrobe shared with stylists' : 'Wardrobe is now private', 'success');
    } catch (err: any) {
      // Revert on error
      setIsShared(!nextValue);
      showToast('Failed to update privacy settings', 'error');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.headerTitle, { color: colors.text, marginBottom: Spacing.xl }]}>
          Privacy Settings
        </Text>

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Digital Wardrobe Access</Text>
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Share Wardrobe with Stylists
              </Text>
              <Text style={[styles.settingDesc, { color: colors.secondaryText }]}>
                Allow JezSy Couture stylists to view your digital wardrobe to recommend outfits and provide better styling advice.
              </Text>
            </View>
            
            {loading ? (
              <ActivityIndicator color={colors.tint} />
            ) : (
              <Switch
                value={isShared}
                onValueChange={handleToggle}
                disabled={updating}
                trackColor={{ false: '#767577', true: colors.tint }}
                accessibilityRole="switch"
                accessibilityLabel="Share Wardrobe with Stylists"
              />
            )}
          </View>
        </View>

        <Text style={[styles.footnote, { color: colors.secondaryText }]}>
          Your personal closet items are private by default under Data Privacy regulations until explicit consent is granted.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.xl,
    paddingBottom: 40,
  },
  headerTitle: {
    ...Type.display,
  },
  card: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  cardHeader: {
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5e5',
  },
  cardTitle: {
    ...Type.subtitle,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  settingTextContainer: {
    flex: 1,
    paddingRight: Spacing.lg,
  },
  settingTitle: {
    ...Type.bodyLarge,
    fontWeight: '600',
    marginBottom: 4,
  },
  settingDesc: {
    ...Type.caption,
    lineHeight: 18,
  },
  footnote: {
    ...Type.caption,
    textAlign: 'center',
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.md,
  }
});
