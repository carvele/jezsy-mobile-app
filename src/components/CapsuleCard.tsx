import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

export interface Capsule {
  id: string;
  name: string;
  description: string | null;
  target_count: number;
  item_count: number; // Joined from capsule_items
}

interface CapsuleCardProps {
  capsule: Capsule;
  onPress: () => void;
}

export function CapsuleCard({ capsule, onPress }: CapsuleCardProps) {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  
  const progress = Math.min(capsule.item_count / capsule.target_count, 1);
  const isComplete = progress >= 1;

  return (
    <TouchableOpacity 
      style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]}>{capsule.name}</Text>
          {isComplete && <IconSymbol name="checkmark.circle.fill" size={20} color="#4CD964" />}
        </View>
        <Text style={[styles.count, { color: colors.tint }]}>
          {capsule.item_count} / {capsule.target_count} items
        </Text>
      </View>
      
      {capsule.description ? (
        <Text style={[styles.description, { color: colors.secondaryText }]} numberOfLines={2}>
          {capsule.description}
        </Text>
      ) : null}

      <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
        <View 
          style={[
            styles.progressFill, 
            { 
              width: `${progress * 100}%`,
              backgroundColor: isComplete ? '#4CD964' : colors.tint 
            }
          ]} 
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  count: {
    fontSize: 14,
    fontWeight: '600',
  },
  description: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  }
});
