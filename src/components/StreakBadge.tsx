import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';

export function StreakBadge() {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const { session } = useAuth();
  
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnimation = useRef<Animated.CompositeAnimation | null>(null);

  const fetchStreak = useCallback(async () => {
    if (!session?.user?.id) return;

    try {
      const { data, error } = await supabase
        .from('user_streaks')
        .select('*')
        .eq('user_id', session.user.id)
        .single();
      
      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching streak:', error);
        return;
      }

      if (data) {
        const nextCurrentStreak = data.current_streak || 0;
        setCurrentStreak(nextCurrentStreak);
        setLongestStreak(data.longest_streak || 0);
        
        // Pulse animation if streak > 0
        if (nextCurrentStreak > 0) {
          pulseAnimation.current?.stop();
          pulseAnimation.current = Animated.loop(
            Animated.sequence([
              Animated.timing(scaleAnim, { toValue: 1.1, duration: 800, useNativeDriver: true }),
              Animated.timing(scaleAnim, { toValue: 1, duration: 800, useNativeDriver: true })
            ])
          );
          pulseAnimation.current.start();
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, [session?.user?.id, scaleAnim]);

  useEffect(() => {
    fetchStreak();

    return () => {
      pulseAnimation.current?.stop();
      scaleAnim.stopAnimation();
    };
  }, [fetchStreak, scaleAnim]);

  if (currentStreak === 0) return null; // Don't show if no streak yet

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Animated.View style={[styles.iconContainer, { transform: [{ scale: scaleAnim }] }]}>
        <IconSymbol name="flame.fill" size={24} color="#FF5A5F" />
      </Animated.View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: colors.text }]}>{currentStreak} Day Streak!</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Personal Best: {longestStreak}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 90, 95, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
  }
});
