import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Switch, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useToast } from '@/src/context/ToastContext';

type OutfitPrivacy = 'private' | 'connections' | 'public';
type ProfileVisibility = 'private' | 'public';

export default function PrivacySettingsScreen() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const colors = Colors.light;

  const [isShared, setIsShared] = useState(false);
  const [outfitPrivacy, setOutfitPrivacy] = useState<OutfitPrivacy>('private');
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>('public');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadPrivacySettings = async () => {
      try {
        if (!user) return;
        const { data, error } = await supabase
          .from('profiles')
          .select('is_wardrobe_shared, outfit_privacy, profile_visibility')
          .eq('id', user.id)
          .single();

        if (error) throw error;
        if (mounted && data) {
          setIsShared(!!data.is_wardrobe_shared);
          setOutfitPrivacy((data.outfit_privacy as OutfitPrivacy) || 'private');
          setProfileVisibility((data.profile_visibility as ProfileVisibility) || 'public');
        }
      } catch (err: any) {
        console.log('Error loading privacy settings:', err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadPrivacySettings();
    return () => { mounted = false; };
  }, [user]);

  const handleOutfitPrivacyChange = async (value: OutfitPrivacy) => {
    if (!user || outfitPrivacy === value) return;
    setUpdating(true);
    const prev = outfitPrivacy;
    setOutfitPrivacy(value);
    try {
      const { error } = await supabase.from('profiles').update({ outfit_privacy: value }).eq('id', user.id);
      if (error) throw error;
      showToast('Outfit privacy updated', 'success');
    } catch {
      setOutfitPrivacy(prev);
      showToast('Failed to update privacy settings', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const handleProfileVisibilityChange = async (value: ProfileVisibility) => {
    if (!user || profileVisibility === value) return;
    setUpdating(true);
    const prev = profileVisibility;
    setProfileVisibility(value);
    try {
      const { error } = await supabase.from('profiles').update({ profile_visibility: value }).eq('id', user.id);
      if (error) throw error;
      showToast('Profile visibility updated', 'success');
    } catch {
      setProfileVisibility(prev);
      showToast('Failed to update privacy settings', 'error');
    } finally {
      setUpdating(false);
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
        .update({ is_wardrobe_shared: nextValue })
        .eq('id', user.id);

      if (error) {
        throw error;
      }
      
      showToast(nextValue ? 'Wardrobe shared with stylists' : 'Wardrobe is now private', 'success');
    } catch {
      // Revert on error
      setIsShared(!nextValue);
      showToast('Failed to update privacy settings', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const renderOutfitOption = (value: OutfitPrivacy, title: string, description: string) => {
    const isSelected = outfitPrivacy === value;
    return (
      <TouchableOpacity
        style={[styles.radioOption, { borderColor: isSelected ? colors.tint : colors.border }]}
        onPress={() => handleOutfitPrivacyChange(value)}
        disabled={updating}
      >
        <View style={styles.radioHeader}>
          <Text style={[styles.radioTitle, { color: isSelected ? colors.text : colors.secondaryText }]}>{title}</Text>
          <View style={[styles.radioCircle, { borderColor: isSelected ? colors.tint : colors.border }]}>
            {isSelected && <View style={[styles.radioInner, { backgroundColor: colors.tint }]} />}
          </View>
        </View>
        <Text style={[styles.radioDesc, { color: colors.secondaryText }]}>{description}</Text>
      </TouchableOpacity>
    );
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

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Outfit Privacy</Text>
          </View>
          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Who can see your saved outfits?</Text>
              <Text style={[styles.settingDesc, { color: colors.secondaryText, marginBottom: Spacing.md }]}>
                Controls whether other users can view the looks you have saved in your wardrobe.
              </Text>
              {loading ? (
                <ActivityIndicator color={colors.tint} />
              ) : (
                <View style={styles.optionsContainer}>
                  {renderOutfitOption('private', 'Private', 'Only you can see your saved outfits.')}
                  {renderOutfitOption('connections', 'My Network', 'Your accepted connections can see your saved outfits.')}
                  {renderOutfitOption('public', 'Public', 'Anyone on the app can view your saved outfits.')}
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Profile Visibility</Text>
          </View>
          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>Make my profile discoverable</Text>
              <Text style={[styles.settingDesc, { color: colors.secondaryText }]}>
                When off, your profile is hidden from search and your profile link will not work for people you have not connected with.
              </Text>
            </View>
            {loading ? (
              <ActivityIndicator color={colors.tint} />
            ) : (
              <Switch
                value={profileVisibility === 'public'}
                onValueChange={(next) => handleProfileVisibilityChange(next ? 'public' : 'private')}
                disabled={updating}
                trackColor={{ false: '#767577', true: colors.tint }}
                accessibilityRole="switch"
                accessibilityLabel="Make my profile discoverable"
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
  },
  optionsContainer: {
    gap: Spacing.sm,
  },
  radioOption: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  radioHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  radioTitle: {
    fontWeight: '600',
    fontSize: 15,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  radioDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
});
