import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Type, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';

export function StreakBadge() {
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { session } = useAuth();
  
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const pulseAnimation = useRef<Animated.CompositeAnimation | null>(null);

  const fetchStreak = useCallback(async () => {
    if (!session?.user?.id) return;

    try {
      const { data, error } = await supabase
        .from('user_streaks')
        .select('current_streak, longest_streak')
        .eq('user_id', session.user.id)
        .maybeSingle();
      
      if (error) {
        // Silently catch if table row does not exist or user is unauthenticated
        return;
      }

      const streakVal = data?.current_streak ?? 0;
      if (streakVal > 0) {
        setCurrentStreak(streakVal);
        setLongestStreak(data?.longest_streak ?? 0);
        
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: Platform.OS !== 'web',
        }).start();

        // Pulse animation if streak > 0
        pulseAnimation.current?.stop();
        pulseAnimation.current = Animated.loop(
          Animated.sequence([
            Animated.timing(scaleAnim, { toValue: 1.1, duration: 800, useNativeDriver: Platform.OS !== 'web' }),
            Animated.timing(scaleAnim, { toValue: 1, duration: 800, useNativeDriver: Platform.OS !== 'web' })
          ])
        );
        pulseAnimation.current.start();
      } else {
        setCurrentStreak(0);
        setLongestStreak(0);
      }
    } catch (err) {
      console.error(err);
    }
  }, [session?.user?.id, scaleAnim, opacityAnim]);

  useEffect(() => {
    fetchStreak();

    return () => {
      pulseAnimation.current?.stop();
      scaleAnim.stopAnimation();
    };
  }, [fetchStreak, scaleAnim]);

  if (currentStreak === 0) return null; // Don't show if no streak yet

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: opacityAnim,
        },
      ]}
    >
      <Animated.View style={[styles.iconContainer, { transform: [{ scale: scaleAnim }] }]}>
        <IconSymbol name="flame.fill" size={24} color="#FF5A5F" />
      </Animated.View>
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: colors.text }]}>{currentStreak} Day Streak!</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Personal Best: {longestStreak}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: Spacing.xl,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 90, 95, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.lg,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    ...Type.bodyLargeStrong,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: 13,
  }
});
