// Domain config for the guided system tour: what modules exist, and what
// contextual steps each one walks the user through on its real screen.
// Bumping a module's `version` invalidates old progress for everyone (see
// tourProgress.ts), so use it when a module's steps change materially.

export type TourModuleId = 'discover' | 'ar_try_on' | 'wardrobe' | 'concierge';

export type TourStepCompletion =
  | { type: 'next' } // user taps "Got it" / "Next" on the coachmark itself
  | { type: 'interaction'; event: string } // fires when tourEvents emits this event
  | { type: 'navigation'; route: string }; // fires when tourEvents emits a navigation to this route

export interface TourStep {
  id: string;
  screen: string;
  title: string;
  description: string;
  /** Optional anchor id a screen registers via useTourTarget(moduleId, stepId, target). */
  target?: string;
  completion: TourStepCompletion;
}

export interface TourModuleDefinition {
  id: TourModuleId;
  version: number;
  icon: string;
  title: string;
  subtitle: string;
  /** Highlights shown on the welcome-hub primer screen before entering the module. */
  highlights: { icon: string; title: string; description: string }[];
  actionRoute: string;
  actionLabel: string;
  steps: TourStep[];
}

export const TOUR_MODULES: Record<TourModuleId, TourModuleDefinition> = {
  discover: {
    id: 'discover',
    version: 1,
    icon: 'magnifyingglass',
    title: 'Discover Styles',
    subtitle: 'Explore our curated catalog of luxury fashion.',
    highlights: [
      {
        icon: 'house.fill',
        title: 'Curated Collections',
        description: 'Explore trending haute couture, premium rentals, and seasonal edits.',
      },
      {
        icon: 'slider.horizontal.3',
        title: 'Smart Filters',
        description: 'Find garments tailored to your measurements and palette.',
      },
    ],
    actionRoute: '/(tabs)/explore',
    actionLabel: 'Browse Catalog',
    steps: [
      {
        id: 'browse',
        screen: 'explore',
        title: 'Browse the catalog',
        description: 'Tap a category to drill in, or Shop All to see everything at once.',
        target: 'discover.categories',
        completion: { type: 'next' },
      },
      {
        id: 'search',
        screen: 'explore',
        title: 'Search & filter',
        description: 'Search by name, or use Filter to narrow by size, color, and fit.',
        target: 'discover.searchBar',
        completion: { type: 'interaction', event: 'discover_search_opened' },
      },
      {
        id: 'open_product',
        screen: 'explore',
        title: 'Open something you like',
        description: 'Tap any item to see its details, save it, or try it on in AR.',
        completion: { type: 'navigation', route: 'product_detail' },
      },
    ],
  },
  ar_try_on: {
    id: 'ar_try_on',
    version: 1,
    icon: 'cube.fill',
    title: 'AR Fitting Room',
    subtitle: 'Experience how luxury garments look and fit before reserving.',
    highlights: [
      {
        icon: 'camera.fill',
        title: 'Real-Time Body Fitting',
        description: 'Use your camera for live pose tracking and 3D simulations.',
      },
      {
        icon: 'figure.stand',
        title: 'Calibrated Body Scan',
        description: 'Get tailored sizing recommendations based on your unique shape.',
      },
    ],
    actionRoute: '/(tabs)/explore',
    actionLabel: 'Browse Catalog',
    steps: [
      {
        id: 'find_ar_item',
        screen: 'explore',
        title: 'Find an AR-ready item',
        description: 'Look for the "Try in AR" tag, or use the AR Try-On filter.',
        completion: { type: 'next' },
      },
      {
        id: 'enter_ar',
        screen: 'ar-tryon',
        title: 'Enter the fitting room',
        description: 'Point your camera at yourself and hold still for pose tracking to lock on.',
        completion: { type: 'navigation', route: 'ar_tryon_screen' },
      },
    ],
  },
  wardrobe: {
    id: 'wardrobe',
    version: 1,
    icon: 'tshirt',
    title: 'Digital Wardrobe',
    subtitle: 'Turn your physical closet into an intelligent digital wardrobe powered by AI.',
    highlights: [
      {
        icon: 'plus',
        title: 'Auto Background Removal',
        description: 'Snap photos of your clothes; AI crops and catalogs each item instantly.',
      },
      {
        icon: 'square.grid.2x2.fill',
        title: 'Outfit Builder',
        description: 'Generate daily outfit pairings from your wardrobe and wishlist.',
      },
    ],
    actionRoute: '/(tabs)/wardrobe',
    actionLabel: 'Go to Digital Wardrobe',
    steps: [
      {
        id: 'enter_wardrobe',
        screen: 'wardrobe',
        title: "Your digital closet",
        description: 'Everything you add here is available for outfit pairing and AR try-on.',
        completion: { type: 'navigation', route: 'wardrobe_screen' },
      },
    ],
  },
  concierge: {
    id: 'concierge',
    version: 1,
    icon: 'sparkles',
    title: 'Concierge & Support',
    subtitle: 'Get help with reservations, styling, and returns.',
    highlights: [
      {
        icon: 'message.fill',
        title: 'Direct Chat',
        description: 'Chat directly with our luxury styling and support team.',
      },
      {
        icon: 'bell.fill',
        title: 'Instant Updates',
        description: 'Receive notifications about your reservations and wishlist items.',
      },
    ],
    actionRoute: '/(tabs)/messages',
    actionLabel: 'Message Concierge',
    steps: [
      {
        id: 'enter_concierge',
        screen: 'messages',
        title: 'Reach the concierge',
        description: 'Ask about sizing, reservations, or styling advice any time.',
        completion: { type: 'navigation', route: 'messages_screen' },
      },
    ],
  },
};

export const TOUR_MODULE_IDS = Object.keys(TOUR_MODULES) as TourModuleId[];
