import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Switch, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useAuth } from '@/src/context/AuthContext';
import { supabase } from '@/src/lib/supabase';
import { savePushTokenToProfile } from '@/src/utils/pushNotifications';

export default function NotificationsSettingsScreen() {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const fetchState = async () => {
      if (!user) return;
      try {
        const { data } = await supabase
          .from('profiles')
          .select('expo_push_token')
          .eq('id', user.id)
          .maybeSingle();
        setPushEnabled(!!data?.expo_push_token);
      } catch (err) {
        console.error('Error fetching notification settings', err);
      } finally {
        setLoading(false);
      }
    };
    fetchState();
  }, [user]);

  // Push delivery is gated purely on profiles.expo_push_token: the
  // notify-status edge function only sends a push when that column is set
  // (see supabase/functions/notify-status). Toggling this off clears it,
  // toggling on re-registers for a token, so this switch is real control,
  // not a preference flag the backend ignores.
  const handleToggle = async (next: boolean) => {
    if (!user) return;
    setPushEnabled(next);
    setUpdating(true);
    try {
      if (next) {
        await savePushTokenToProfile(user.id);
        const { data } = await supabase
          .from('profiles')
          .select('expo_push_token')
          .eq('id', user.id)
          .maybeSingle();
        if (!data?.expo_push_token) {
          setPushEnabled(false);
          Alert.alert(
            'Could Not Enable',
            'Push notifications need permission and a physical device. Check your device settings and try again.',
          );
        }
      } else {
        const { error } = await supabase
          .from('profiles')
          .update({ expo_push_token: null })
          .eq('id', user.id);
        if (error) throw error;
      }
    } catch (err: any) {
      setPushEnabled(!next);
      Alert.alert('Error', err.message || 'Could not update notification settings.');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <IconSymbol name="chevron.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.iconBadge, { backgroundColor: colors.background }]}>
              <IconSymbol name="bell.fill" size={20} color={colors.tint} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>Push Notifications</Text>
              <Text style={[styles.rowSubtitle, { color: colors.secondaryText }]}>
                Reservation and order status updates on this device
              </Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={handleToggle}
              disabled={updating}
              trackColor={{ false: '#767577', true: colors.tint }}
              accessibilityRole="switch"
              accessibilityLabel="Push notifications"
              accessibilityState={{ checked: pushEnabled, disabled: updating }}
            />
          </View>

          <Text style={[styles.footnote, { color: colors.secondaryText }]}>
            In-app notifications (visible in your Notifications tab) always keep working. This
            switch only controls whether this device also receives a push alert.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    gap: 14,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  rowSubtitle: { fontSize: 12, lineHeight: 17 },
  footnote: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 16,
    paddingHorizontal: 4,
  },
});
