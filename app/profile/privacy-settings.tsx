import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, Switch, ScrollView, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { useToast } from '@/src/context/ToastContext';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function PrivacySettingsScreen() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const router = useRouter();

  const [isShared, setIsShared] = useState(false);
  const [wardrobePrivacy, setWardrobePrivacy] = useState<'private' | 'connections'>('private');
  const [wishlistPrivacy, setWishlistPrivacy] = useState<'private' | 'connections' | 'public'>('private');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadPrivacySettings = async () => {
      try {
        if (!user) return;
        const { data, error } = await supabase
          .from('profiles')
          .select('is_wardrobe_shared, wardrobe_privacy, wishlist_privacy')
          .eq('id', user.id)
          .single();
        
        if (error) throw error;
        if (mounted && data) {
          setIsShared(!!data.is_wardrobe_shared);
          setWardrobePrivacy((data.wardrobe_privacy as any) || 'private');
          setWishlistPrivacy((data.wishlist_privacy as any) || 'private');
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

  const handleToggle = async (nextValue: boolean) => {
    if (!user) return;
    setUpdating(true);
    setIsShared(nextValue);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_wardrobe_shared: nextValue })
        .eq('id', user.id);

      if (error) throw error;
      showToast(nextValue ? 'Wardrobe shared with stylists' : 'Wardrobe is now private', 'success');
    } catch {
      setIsShared(!nextValue);
      showToast('Failed to update privacy settings', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const handlePrivacyChange = async (type: 'wardrobe' | 'wishlist', value: 'private' | 'connections' | 'public') => {
    if (!user) return;
    
    if (type === 'wardrobe' && wardrobePrivacy === value) return;
    if (type === 'wishlist' && wishlistPrivacy === value) return;

    setUpdating(true);
    const prevWardrobe = wardrobePrivacy;
    const prevWishlist = wishlistPrivacy;

    if (type === 'wardrobe') setWardrobePrivacy(value as 'private' | 'connections');
    if (type === 'wishlist') setWishlistPrivacy(value);

    try {
      const updatePayload = type === 'wardrobe' 
        ? { wardrobe_privacy: value }
        : { wishlist_privacy: value };

      const { error } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', user.id);

      if (error) throw error;
      showToast('Privacy updated', 'success');
    } catch {
      if (type === 'wardrobe') setWardrobePrivacy(prevWardrobe);
      if (type === 'wishlist') setWishlistPrivacy(prevWishlist);
      showToast('Failed to update privacy settings', 'error');
    } finally {
      setUpdating(false);
    }
  };

  const renderRadioOption = (
    type: 'wardrobe' | 'wishlist',
    value: 'private' | 'connections' | 'public',
    title: string,
    description: string
  ) => {
    const isSelected = type === 'wardrobe' ? wardrobePrivacy === value : wishlistPrivacy === value;
    return (
      <TouchableOpacity 
        style={[
          styles.radioOption, 
          { borderColor: isSelected ? colors.tint : colors.border }
        ]}
        onPress={() => handlePrivacyChange(type, value)}
        disabled={updating}
      >
        <View style={styles.radioHeader}>
          <Text style={[styles.radioTitle, { color: isSelected ? colors.text : colors.secondaryText }]}>
            {title}
          </Text>
          <View style={[
            styles.radioCircle, 
            { borderColor: isSelected ? colors.tint : colors.border }
          ]}>
            {isSelected && <View style={[styles.radioInner, { backgroundColor: colors.tint }]} />}
          </View>
        </View>
        <Text style={[styles.radioDesc, { color: colors.secondaryText }]}>{description}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Privacy Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        
        {/* Wishlist Privacy Card */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.cardHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Wishlist Privacy</Text>
          </View>
          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Who can see what you saved?
              </Text>
              <Text style={[styles.settingDesc, { color: colors.secondaryText, marginBottom: Spacing.md }]}>
                Control who can see your saved items and if you appear in &ldquo;Loved By&rdquo; on product pages.
              </Text>
              
              {loading ? (
                <ActivityIndicator color={colors.tint} />
              ) : (
                <View style={styles.optionsContainer}>
                  {renderRadioOption('wishlist', 'private', 'Private', 'Only you can see your saved items.')}
                  {renderRadioOption('wishlist', 'connections', 'My Network', 'Your accepted connections can see your saved items.')}
                  {renderRadioOption('wishlist', 'public', 'Public', 'Anyone can view your wishlist, and you may appear as someone who saved an item on public product pages.')}
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Wardrobe Privacy Card */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.cardHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>Digital Wardrobe Access</Text>
          </View>

          <View style={[styles.settingRow, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
            <View style={styles.settingTextContainer}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Share with Stylists
              </Text>
              <Text style={[styles.settingDesc, { color: colors.secondaryText }]}>
                Allow JezSy Couture stylists to view your digital wardrobe to recommend outfits.
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
              />
            )}
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Who can see your wardrobe?
              </Text>
              <Text style={[styles.settingDesc, { color: colors.secondaryText, marginBottom: Spacing.md }]}>
                Control which other users can view your digital closet items.
              </Text>
              
              {loading ? (
                <ActivityIndicator color={colors.tint} />
              ) : (
                <View style={styles.optionsContainer}>
                  {renderRadioOption('wardrobe', 'private', 'Private', 'Only you (and stylists if enabled) can see your wardrobe.')}
                  {renderRadioOption('wardrobe', 'connections', 'My Network', 'Your accepted connections can browse your wardrobe.')}
                </View>
              )}
            </View>
          </View>
        </View>

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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backBtn: {
    padding: Spacing.xs,
    marginLeft: -Spacing.xs,
  },
  headerTitle: {
    ...Type.title,
  },
  content: {
    padding: Spacing.lg,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: Spacing.xl,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
      },
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.05)' },
    }),
  },
  cardHeader: {
    padding: Spacing.lg,
    borderBottomWidth: 1,
  },
  cardTitle: {
    ...Type.title,
    fontSize: 18,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: Spacing.lg,
  },
  settingTextContainer: {
    flex: 1,
    paddingRight: Spacing.md,
  },
  settingTitle: {
    ...Type.body,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  settingDesc: {
    ...Type.caption,
    lineHeight: 20,
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
  }
});
