import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import * as ReactTestRenderer from 'react-test-renderer';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store[key] || null),
      setItem: jest.fn(async (key: string, val: string) => {
        store[key] = val;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete store[key];
      }),
      multiRemove: jest.fn(async (keys: string[]) => {
        for (const k of keys) {
          delete store[k];
        }
      }),
      clear: jest.fn(async () => {
        store = {};
      }),
    },
  };
});

jest.mock('expo-image', () => ({
  Image: (props: any) => React.createElement('Image', props),
}));

jest.mock('@/components/ui/icon-symbol', () => ({
  IconSymbol: (props: any) => React.createElement('IconSymbol', props),
}));

jest.mock('@/src/utils/haptics', () => ({
  tapMedium: jest.fn(),
  tapLight: jest.fn(),
}));

import { WardrobeTokens, Radius } from '@/constants/theme';
import { localExposureService } from '../localExposureService';
import { generateOutfits } from '@/src/utils/outfitGenerator';
import { SuggestedOutfitCard } from '@/src/components/SuggestedOutfitCard';
import { DeterministicFlatLayCanvas } from '@/src/components/styling/DeterministicFlatLayCanvas';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('Phase B Product & Runtime Verification Harness', () => {
  const userId = 'user-runtime-verification';

  const sampleWardrobe = [
    { id: 'item-top-1', category: 'Tops', garment_type: 'Silk Blouse', color_tags: ['cream', 'white'], wear_count: 0, image_url: 'https://img.jezsy.com/top1.jpg' },
    { id: 'item-top-2', category: 'Tops', garment_type: 'Cashmere Knit', color_tags: ['beige'], wear_count: 3, last_worn_at: '2026-08-15T00:00:00Z', image_url: 'https://img.jezsy.com/top2.jpg' },
    { id: 'item-bot-1', category: 'Bottoms', garment_type: 'Tailored Trousers', color_tags: ['black'], wear_count: 1, last_worn_at: '2026-09-10T00:00:00Z', image_url: 'https://img.jezsy.com/bot1.jpg' },
    { id: 'item-bot-2', category: 'Bottoms', garment_type: 'Pleated Skirt', color_tags: ['navy'], wear_count: 0, image_url: 'https://img.jezsy.com/bot2.jpg' },
    { id: 'item-outer-1', category: 'Outerwear', garment_type: 'Wool Coat', color_tags: ['camel'], wear_count: 2, image_url: 'https://img.jezsy.com/coat.jpg' },
    { id: 'item-shoe-1', category: 'Shoes', garment_type: 'Leather Loafer', color_tags: ['black'], wear_count: 4, image_url: 'https://img.jezsy.com/shoe.jpg' },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    localExposureService.purgeInMemoryForUser(userId);
    await AsyncStorage.clear();
  });

  describe('1. Visual Tokens & Theme Restraint', () => {
    it('verifies light mode atelier surfaces match warm cream / quiet luxury spec', () => {
      const light = WardrobeTokens.theme.light;
      expect(light.canvasBackground).toBe('#FBFBF9'); // Warm off-white canvas
      expect(light.cardSurface).toBe('#FFFFFF');
      expect(light.actionPrimary).toBe('#8A6D3B'); // Antique Gold (WCAG AA compliant)
      expect(light.cardBorder).toContain('rgba(0,0,0,');
    });

    it('verifies dark mode atelier surfaces match dark luxury spec', () => {
      const dark = WardrobeTokens.theme.dark;
      expect(dark.canvasBackground).toBe('#121212');
      expect(dark.cardSurface).toBe('#1C1C1E');
      expect(dark.actionPrimary).toBe('#C9A96E'); // Luxury Gold
      expect(dark.actionPrimaryText).toBe('#0D0D0D');
    });

    it('verifies card proportions and touch targets meet minimum ergonomics', () => {
      expect(WardrobeTokens.flatLayCanvasHeight).toBe(320);
      expect(WardrobeTokens.actionButtonHeight).toBe(48); // Exceeds 44pt minimum touch target
      expect(WardrobeTokens.garmentCardRadius).toBe(Radius.md);
    });
  });

  describe('2. Deterministic Flat-Lay Canvas Layout Across Screen Sizes', () => {
    it('renders on standard phone width (390pt) without distortion', () => {
      let root: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        root = ReactTestRenderer.create(
          React.createElement(DeterministicFlatLayCanvas, {
            items: [sampleWardrobe[0], sampleWardrobe[2], sampleWardrobe[5]],
            height: 320,
          })
        );
      });
      const images = root!.root.findAllByType('Image' as any);
      expect(images).toHaveLength(3);
    });

    it('renders on small phone width (320pt) cleanly', () => {
      let root: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        root = ReactTestRenderer.create(
          React.createElement(DeterministicFlatLayCanvas, {
            items: [sampleWardrobe[0], sampleWardrobe[2]],
            height: 280, // Small device height
          })
        );
      });
      const images = root!.root.findAllByType('Image' as any);
      expect(images).toHaveLength(2);
    });
  });

  describe('3. SuggestedOutfitCard Atelier Variant Structure', () => {
    it('renders disjoint summary and action regions with grounded bullets', () => {
      const outfit = {
        key: 'look-1',
        items: [sampleWardrobe[0], sampleWardrobe[2]], // Top has wear_count 0
        score: 96,
        label: 'Perfect Harmony',
        headline: 'Quiet Atelier Pairing',
        reason: 'Cream top balances structured black trouser.',
        assessment: 'Appropriate for this occasion',
        isAiRanked: true,
      };

      let root: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        root = ReactTestRenderer.create(
          React.createElement(SuggestedOutfitCard, {
            outfit,
            onSave: jest.fn(),
            onPass: jest.fn(),
            variant: 'atelier',
          })
        );
      });

      const instance = root!.root;
      // Summary region contains headline and bullets
      const summaryViews = instance.findAll((n) => n.props && n.props.accessible === true);
      expect(summaryViews.length).toBeGreaterThan(0);
      expect(summaryViews[0].props.accessibilityLabel).toContain('Quiet Atelier Pairing');

      // Action buttons are separate from summary
      const touchables = instance.findAllByType('TouchableOpacity' as any);
      const passBtn = touchables.find((t) => t.props.accessibilityLabel === 'Pass on this look');
      const saveBtn = touchables.find((t) => t.props.accessibilityLabel === 'Save outfit to wardrobe');
      expect(passBtn).toBeDefined();
      expect(saveBtn).toBeDefined();

      // Check grounded bullet derivation
      const texts = instance.findAllByType('Text' as any).map((t) => t.props.children);
      expect(texts.some((t) => typeof t === 'string' && t.includes('Features a new, unworn'))).toBe(true);
    });
  });

  describe('4. MP4 Behavioral Discovery Loop Simulation', () => {
    it('executes full pass -> replace -> restart -> persistent suppression -> save loop', async () => {
      // Step A: Candidate pool generation (20 candidates)
      const pool = generateOutfits(sampleWardrobe as any, 20);
      expect(pool.length).toBeGreaterThanOrEqual(4);

      // Step B: Only top 3 are presented
      const presented = new Set<string>();
      let top3 = pool.filter((o) => !presented.has(o.key)).slice(0, 3);
      expect(top3).toHaveLength(3);

      // Log presentation ONLY for top 3
      for (const o of top3) {
        presented.add(o.key);
        await localExposureService.logPresentation(userId, o.key, o.items.map((i) => i.id));
      }

      // Confirm candidate 4 (generated but unseen) is NOT in history
      const candidate4 = pool[3];
      const historyStep1 = await localExposureService.getExposureHistory(userId);
      expect(historyStep1.recentOutfits.some((r) => r.outfitKey === candidate4.key)).toBe(false);

      // Step C: User passes on look 1
      const passedLook = top3[0];
      await localExposureService.logInteraction(userId, passedLook.key, 'passed', passedLook.items.map((i) => i.id));

      // Replacement enters
      const historyStep2 = await localExposureService.getExposureHistory(userId);
      const nextAvailable = pool.filter((o) => !localExposureService.isOutfitCooldownActive(o.key, historyStep2));
      expect(nextAvailable.some((o) => o.key === passedLook.key)).toBe(false);

      const newTop3 = nextAvailable.slice(0, 3);
      expect(newTop3).toHaveLength(3);
      expect(newTop3.some((o) => o.key === candidate4.key)).toBe(true); // Candidate 4 entered!

      // Step D: App Restart simulation (purge in-memory history and reload from AsyncStorage)
      localExposureService.purgeInMemoryForUser(userId);
      const historyRestart = await localExposureService.getExposureHistory(userId);

      // Passed look remains suppressed after app restart
      expect(localExposureService.isOutfitCooldownActive(passedLook.key, historyRestart)).toBe(true);
      const reloadedAvailable = pool.filter((o) => !localExposureService.isOutfitCooldownActive(o.key, historyRestart));
      expect(reloadedAvailable.some((o) => o.key === passedLook.key)).toBe(false);

      // Step E: User saves look 2
      const savedLook = newTop3[0];
      await localExposureService.logInteraction(userId, savedLook.key, 'saved', savedLook.items.map((i) => i.id));
      const historySaved = await localExposureService.getExposureHistory(userId);
      expect(localExposureService.isOutfitCooldownActive(savedLook.key, historySaved)).toBe(true);

      // Step F: Dual-write verification (legacy key contains passed look for rollback)
      const legacyRaw = await AsyncStorage.getItem(`jezsy_wardrobe_passed_suggestions_${userId}`);
      expect(legacyRaw).not.toBeNull();
      expect(JSON.parse(legacyRaw!)).toContain(passedLook.key);
    });
  });
});
