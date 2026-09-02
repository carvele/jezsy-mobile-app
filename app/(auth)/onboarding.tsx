import React, { useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, useWindowDimensions, TouchableOpacity, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { useRouter, Redirect } from 'expo-router';
import { Image } from 'expo-image';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { ArrowRight } from 'lucide-react-native';
import { markOnboardingSeen } from '@/src/utils/onboarding';
import { useAuth } from '@/src/context/AuthContext';

const SLIDES = [
  {
    id: '1',
    title: 'Immersive\nFashion',
    description: 'Discover the latest trends with our curated collections.',
    image: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=1000&auto=format&fit=crop',
  },
  {
    id: '2',
    title: 'Digital\nWardrobe',
    description: 'Save your favorite outfits and mix and match virtually.',
    image: 'https://images.unsplash.com/photo-1532453288672-3a27e9be9efd?q=80&w=1000&auto=format&fit=crop',
  },
  {
    id: '3',
    title: 'AR\nTry-On',
    description: 'Experience clothes in augmented reality before you reserve.',
    image: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?q=80&w=1000&auto=format&fit=crop',
  },
];

export default function Onboarding() {
  const router = useRouter();
  const { session, isPasswordRecovery, isLoading } = useAuth();
  const { width, height } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const handleScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const nextIdx = Math.round(offsetX / width);
    if (nextIdx >= 0 && nextIdx < SLIDES.length) {
      setCurrentIndex(nextIdx);
    }
  }, [width]);

  const nextSlide = () => {
    if (currentIndex < SLIDES.length - 1) {
      const targetIndex = currentIndex + 1;
      setCurrentIndex(targetIndex);
      flatListRef.current?.scrollToOffset({
        offset: targetIndex * width,
        animated: true,
      });
    } else {
      markOnboardingSeen();
      router.push('/(auth)/welcome');
    }
  };

  const skip = () => {
    markOnboardingSeen();
    router.push('/(auth)/welcome');
  };

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: width,
    offset: width * index,
    index,
  }), [width]);

  if (!isLoading && session && !isPasswordRecovery) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEnd}
        getItemLayout={getItemLayout}
        bounces={false}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width, height }]} accessible accessibilityLabel={`${item.title.replace('\n', ' ')}. ${item.description}`}>
            <Image source={item.image} style={styles.image} contentFit="cover" />
            <View style={styles.overlay} />
            <View style={[styles.content, { bottom: height * 0.25 }]}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.description}>{item.description}</Text>
            </View>
          </View>
        )}
        keyExtractor={(item) => item.id}
      />

      <View style={styles.footer}>
        <View style={styles.pagination}>
          {SLIDES.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                currentIndex === index && styles.activeDot,
              ]}
            />
          ))}
        </View>
        <Text style={srOnly} accessibilityLiveRegion="polite">
          Slide {currentIndex + 1} of {SLIDES.length}: {SLIDES[currentIndex].title.replace('\n', ' ')}
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            onPress={skip}
            style={styles.skipButton}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
          >
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={nextSlide}
            style={styles.nextButton}
            accessibilityRole="button"
            accessibilityLabel={currentIndex === SLIDES.length - 1 ? 'Get started' : 'Next onboarding slide'}
          >
            <Text style={styles.nextText}>{currentIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}</Text>
            <ArrowRight size={20} color={c.onTint} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const srOnly = {
  position: 'absolute' as const,
  width: 1,
  height: 1,
  opacity: 0,
};

// Deliberately not theme-aware. The background is a full-bleed image carousel under a dark overlay,
// so white text on it is correct whatever the system theme is -- lightening
// it would make that text unreadable.
const c = Colors.dark;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  slide: {
    flex: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  content: {
    position: 'absolute',
    paddingHorizontal: 30,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  title: {
    fontSize: 48,
    fontWeight: '800',
    color: 'white',
    marginBottom: 10,
    lineHeight: 52,
  },
  description: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 24,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: 30,
    paddingBottom: 50,
  },
  pagination: {
    flexDirection: 'row',
    marginBottom: 30,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginRight: Spacing.sm,
  },
  activeDot: {
    backgroundColor: c.tint,
    width: 24,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skipButton: {
    paddingVertical: 10,
  },
  skipText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 16,
    fontWeight: '600',
  },
  // Not PrimaryButton: this is a compact inline pill sitting beside Skip, not
  // the full-width 56pt CTA the other onboarding screens use.
  nextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.tint,
    paddingHorizontal: Spacing.xxl,
    paddingVertical: 14,
    borderRadius: Radius.pill,
    gap: Spacing.sm,
  },
  nextText: {
    color: c.onTint,
    ...Type.bodyLargeStrong,
  },
});
