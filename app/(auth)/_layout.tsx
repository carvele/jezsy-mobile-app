import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';

export default function AuthLayout() {
  const { session, isPasswordRecovery, isLoading } = useAuth();

  // If user is already authenticated and not in password recovery, redirect to tabs immediately
  // This prevents the onboarding screen ("Immersive Fashion") from flashing when navigating to Home
  if (!isLoading && session && !isPasswordRecovery) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0A0A0A' } }} />
  );
}
