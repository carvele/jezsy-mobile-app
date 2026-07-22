import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Alert, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/src/context/AuthContext';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';

export default function PinSetupScreen() {
  const router = useRouter();
  const theme = useColorScheme() ?? 'light';
  const colors = Colors[theme];
  const { setHasPinSetup, setIsPinAuthenticated } = useAuth();

  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'create' | 'confirm'>('create');

  const handlePress = (num: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step === 'create') {
      if (pin.length < 6) {
        setPin(prev => prev + num);
      }
    } else {
      if (confirmPin.length < 6) {
        const newConfirm = confirmPin + num;
        setConfirmPin(newConfirm);

        if (newConfirm.length === 6) {
          if (newConfirm === pin) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            handleSavePin(pin);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            Alert.alert('PIN Mismatch', 'The PINs do not match. Please try again.');
            setPin('');
            setConfirmPin('');
            setStep('create');
          }
        }
      }
    }
  };

  const handleBackspace = () => {
    if (step === 'create') {
      setPin(prev => prev.slice(0, -1));
    } else {
      setConfirmPin(prev => prev.slice(0, -1));
    }
  };

  const handleNext = () => {
    if (pin.length === 6) {
      setStep('confirm');
    }
  };

  const handleSavePin = async (finalPin: string) => {
    try {
      await SecureStore.setItemAsync('jezsy_user_pin', finalPin);
      setHasPinSetup(true);
      setIsPinAuthenticated(true);
      // Let RootLayout handle the redirect
      router.replace('/(tabs)');
    } catch (error) {
      console.error('Error saving PIN:', error);
      Alert.alert('Error', 'Failed to save PIN.');
    }
  };

  const currentPin = step === 'create' ? pin : confirmPin;
  const title = step === 'create' ? 'Create a 6-Digit PIN' : 'Confirm your PIN';
  const subtitle = step === 'create' ? 'This adds an extra layer of security to your account.' : 'Re-enter your 6-digit PIN to confirm.';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => step === 'confirm' ? setStep('create') : router.back()}>
          <IconSymbol name="arrow.left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Secure Access</Text>
      </View>

      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>{subtitle}</Text>

        <View style={styles.dotsContainer}>
          {[...Array(6)].map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i < currentPin.length ? colors.tint : colors.card,
                  borderColor: i < currentPin.length ? colors.tint : colors.border,
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

      {step === 'create' && pin.length === 6 && (
        <TouchableOpacity
          style={[styles.continueBtn, { backgroundColor: colors.tint }]}
          onPress={handleNext}
        >
          <Text style={styles.continueBtnText}>Next</Text>
        </TouchableOpacity>
      )}
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
    paddingHorizontal: 20,
    paddingTop: 20,
    marginBottom: 40,
  },
  backButton: {
    padding: 8,
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 24,
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
  continueBtn: {
    marginHorizontal: 30,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
  },
  continueBtnText: {
    color: '#0D0D0D',
    fontSize: 16,
    fontWeight: '800',
  },
});
