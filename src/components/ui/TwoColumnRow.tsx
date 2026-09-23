import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { GRID_COLUMN_GAP } from '@/src/utils/layout';

export interface TwoColumnRowProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Enforces a rigid 2-column flex row layout.
 * Automatically appends a non-interactive empty spacer with identical flex geometry
 * when an odd number of children is rendered, ensuring the trailing item stays at exactly half-width.
 */
export function TwoColumnRow({ children, style }: TwoColumnRowProps) {
  const childArray = React.Children.toArray(children).filter(Boolean);
  const isOdd = childArray.length % 2 !== 0;

  return (
    <View style={[styles.row, style]}>
      {childArray}
      {isOdd && <View style={styles.spacer} accessible={false} aria-hidden={true} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: GRID_COLUMN_GAP,
  },
  spacer: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 0,
  },
});
