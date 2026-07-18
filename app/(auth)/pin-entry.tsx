import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useAuth } from '@/src/context/AuthContext';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function PinEntryScreen() {
  const router = useRouter();
  const theme = useColorScheme() ?? 'light';
  const colors = Colors[theme];
  const { setIsPinAuthenticated, signOut } = useAuth();

  const [pin, setPin] = useState('');
  const [storedPin, setStoredPin] = useState<string | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync('jezsy_user_pin').then(res => {
      if (res) setStoredPin(res);
    });
  }, []);

  const handlePress = (num: string) => {
    if (pin.length < 6) {
      const newPin = pin + num;
      setPin(newPin);

      if (newPin.length === 6) {
        verifyPin(newPin);
      }
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const verifyPin = (enteredPin: string) => {
    if (enteredPin === storedPin) {
      setIsPinAuthenticated(true);
      router.replace('/(tabs)');
    } else {
      Alert.alert('Incorrect PIN', 'Please try again.');
      setPin('');
    }
  };

  const handleForgotPin = () => {
    Alert.alert(
      'Reset PIN',
      'If you forgot your PIN, you must sign out and sign back in to reset it. Do you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: signOut }
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View style={[styles.iconContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <IconSymbol name="lock.fill" size={32} color={colors.tint} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>Enter PIN</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>Enter your 6-digit PIN to access Jezsy</Text>

        <View style={styles.dotsContainer}>
          {[...Array(6)].map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i < pin.length ? colors.tint : colors.card,
                  borderColor: i < pin.length ? colors.tint : colors.border,
                }
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.numpad}>
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['', '0', 'delete']].map((row, rowIndex) => (
          <View key={rowIndex} style={styles.numpadRow}>
            {row.map((btn, colIndex) => {
              if (btn === '') {
                return <View key={colIndex} style={styles.numpadBtn} />;
              }
              if (btn === 'delete') {
                return (
                  <TouchableOpacity
                    key={colIndex}
                    style={styles.numpadBtn}
                    onPress={handleBackspace}
                  >
                    <IconSymbol name="delete.left" size={28} color={colors.text} />
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={colIndex}
                  style={[styles.numpadBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => handlePress(btn)}
                >
                  <Text style={[styles.numpadBtnText, { color: colors.text }]}>{btn}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.forgotBtn} onPress={handleForgotPin}>
        <Text style={[styles.forgotBtnText, { color: colors.tint }]}>Forgot PIN?</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: 60,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 40,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 60,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  numpad: {
    paddingHorizontal: 30,
    gap: 20,
    marginBottom: 40,
  },
  numpadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  numpadBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  numpadBtnText: {
    fontSize: 32,
    fontWeight: '500',
  },
  forgotBtn: {
    alignItems: 'center',
    padding: 16,
  },
  forgotBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
