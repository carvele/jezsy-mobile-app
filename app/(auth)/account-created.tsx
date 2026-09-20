import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { Colors, Spacing } from '@/constants/theme';

export default function AccountCreatedScreen() {
  const router = useRouter();
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Account Created Successfully</Text>
      <Text style={styles.message}>Your JezSy account has been created successfully.</Text>
      <Text style={styles.message}>You can now sign in using either your email address or mobile number.</Text>
      <PrimaryButton label="Continue" onPress={() => router.replace('/(tabs)')} dark style={styles.button} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', padding: Spacing.xl, backgroundColor: Colors.dark.background, gap: Spacing.lg },
  title: { color: Colors.dark.text, fontSize: 28, fontWeight: '800' },
  message: { color: Colors.dark.secondaryText, fontSize: 16, lineHeight: 24 },
  button: { marginTop: Spacing.lg },
});
