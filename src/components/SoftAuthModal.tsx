import React from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Pressable,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { AuthAction, saveAuthReturnTarget } from '@/src/utils/authReturnTarget';

interface SoftAuthModalProps {
  visible: boolean;
  action: AuthAction;
  targetPathname: string;
  targetParams?: Record<string, string>;
  onClose: () => void;
}

const ACTION_COPY: Record<
  AuthAction,
  { title: string; subtitle: string; icon: string }
> = {
  wishlist: {
    title: 'Save to Your Wishlist',
    subtitle: 'Sign in to sync your favorite pieces across devices and get notified of price changes or restocks.',
    icon: 'heart.fill',
  },
  reserve: {
    title: 'Reserve Your Piece',
    subtitle: 'Sign in to reserve your fitting slot and pick up in our boutique.',
    icon: 'calendar',
  },
  message: {
    title: 'Chat with Our Boutique',
    subtitle: 'Sign in to connect directly with boutique stylists regarding sizing, fabric, and reservations.',
    icon: 'bubble.left.and.bubble.right.fill',
  },
  review: {
    title: 'Share Your Feedback',
    subtitle: "Sign in to review items you've completed a reservation for.",
    icon: 'star.fill',
  },
  generic: {
    title: 'Sign In to JezSy',
    subtitle: 'Sign in to unlock reservations, digital wardrobe management, and personalized boutique advice.',
    icon: 'person.crop.circle',
  },
};

export function SoftAuthModal({
  visible,
  action,
  targetPathname,
  targetParams = {},
  onClose,
}: SoftAuthModalProps) {
  const router = useRouter();
  const theme = useColorScheme();
  const colors = Colors[theme];

  const copy = ACTION_COPY[action] || ACTION_COPY.generic;

  const handleSignIn = async () => {
    // Save return target ONLY when user explicitly initiates authentication
    await saveAuthReturnTarget({
      pathname: targetPathname,
      params: targetParams,
      action,
      createdAt: Date.now(),
    });

    onClose();
    router.push('/(auth)/welcome');
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.tint + '15' }]}>
            <IconSymbol name={copy.icon as any} size={28} color={colors.tint} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>{copy.title}</Text>
          <Text style={[styles.subtitle, { color: colors.secondaryText }]}>{copy.subtitle}</Text>

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.tint }]}
            onPress={handleSignIn}
            accessibilityRole="button"
            accessibilityLabel="Sign in or register"
          >
            <Text style={[styles.primaryButtonText, { color: colors.onTint }]}>
              Sign In or Register
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Continue browsing without signing in"
          >
            <Text style={[styles.secondaryButtonText, { color: colors.secondaryText }]}>
              Continue Browsing
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  title: {
    ...Type.headline,
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Type.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  primaryButtonText: {
    ...Type.label,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    ...Type.caption,
    fontSize: 14,
    fontWeight: '500',
  },
});
