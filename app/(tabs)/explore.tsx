import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { BottomSheetModal, BottomSheetScrollView, BottomSheetView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Platform,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MasonryList from '@react-native-seoul/masonry-list';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { useCart } from '@/src/context/CartContext';
import { CATEGORY_SELECT, WithCategoryEmbed } from '@/src/utils/categoryDisplay';
import { ProductCardSkeleton, SkeletonList } from '@/src/components/Skeleton';
import { ProductCard } from '@/src/components/ProductCard';
import { CategoryCard } from '@/src/components/CategoryCard';
import { recordCategoryVisit } from '@/src/utils/categoryAffinity';
import { ColorOption, DEFAULT_COLOR_OPTIONS, fetchColorOptions } from '@/src/utils/colorOptions';
import { recommendSize } from '@/src/utils/sizeRecommender';
import { GRID_GUTTER, GRID_COLUMN_GAP, useGridCardWidth } from '@/src/utils/layout';
import { BrandEmptyState } from '@/src/components/BrandEmptyState';
import { useSizingProfile } from '@/src/hooks/useSizingProfile';
import { useToast } from '@/src/context/ToastContext';

type Product = Database['public']['Tables']['products']['Row'] & WithCategoryEmbed;
const PRODUCT_SELECT = `*, ${CATEGORY_SELECT}`;
const PAGE_SIZE = 20;
// The product grid splits its page inset between the list and the row; the two
// must still add up to GRID_GUTTER.
const PRODUCT_ROW_INSET = 4;

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type Category = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  image_url: string | null;
  sort_order: number | null;
};

const FILTER_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const FILTER_FITS = ['Regular Fit', 'Slim Fit', 'Oversized', 'Relaxed', 'Tailored'];
const FILTER_MATERIALS = ['Cotton', 'Silk', 'Linen', 'Wool', 'Cashmere', 'Denim', 'Leather', 'Satin', 'Polyester'];

const SORT_OPTIONS = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'newest', label: 'Newest Arrivals' },
  { id: 'priceAsc', label: 'Price: Low to High' },
  { id: 'priceDesc', label: 'Price: High to Low' },
  { id: 'popular', label: 'Most Popular' },
  { id: 'rating', label: 'Best Rated' },
];

// Stable identity across renders so BottomSheetModal doesn't see a changed
// backdropComponent prop (and re-render the backdrop tree) on every render.
const renderSheetBackdrop = (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
  <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} pressBehavior="close" />
);

export default function ExploreScreen() {
  const { columns } = useGridCardWidth();
  const theme = useColorScheme();
  const colors = Colors[theme];
  const { showToast } = useToast();
  const { itemCount } = useCart();
  const { measurements: sizingMeasurements, fitPreference, ready: sizingReady, needsSetup: needsSizingSetup } = useSizingProfile();
  const [sizingNudgeDismissed, setSizingNudgeDismissed] = useState(false);
  const router = useRouter();
  const params = useLocalSearchParams<{ category?: string; all?: string }>();

  // Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searchResults, setSearchResults] = useState<Product[]>([]);

  // Navigation States
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState<string | null>(null);
  // "Shop All" bypasses the category drill-down entirely and loads every
  // active product directly -- there was previously no way to browse the
  // catalog without picking a category first.
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [handledInitialParams, setHandledInitialParams] = useState(false);

  // Category States
  const [topCategories, setTopCategories] = useState<Category[]>([]);
  const [subCategoriesByParent, setSubCategoriesByParent] = useState<Record<string, Category[]>>({});

  // Color filter swatches, sourced from the DB-managed color_options table.
  const [colorOptions, setColorOptions] = useState<ColorOption[]>(DEFAULT_COLOR_OPTIONS);

  // Products Loading State
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Pagination: filters/sort below run client-side over whatever's in
  // `products` so far, not the whole catalog -- growing that set page by
  // page as the user scrolls, same as any infinite-scroll grid.
  const [productsPage, setProductsPage] = useState(0);
  const [hasMoreProducts, setHasMoreProducts] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCategories = useCallback(async () => {
    setCategoriesLoading(true);
    setCategoriesError(null);
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) {
        console.error('Error fetching categories:', error);
        setCategoriesError(error.message || 'Could not load categories');
      } else if (data) {
        const tops = data.filter((c) => !c.parent_id);
        setTopCategories(tops);
        const hierarchy: Record<string, Category[]> = {};
        tops.forEach((top) => {
          hierarchy[top.name] = data.filter((c) => c.parent_id === top.id);
        });
        setSubCategoriesByParent(hierarchy);
        setCategoriesError(null);
      }
    } catch (err) {
      console.error('Failed to fetch categories:', err);
      setCategoriesError('Could not load categories');
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetchColorOptions().then(setColorOptions);
  }, []);

  // Consume an incoming deep link (e.g. from Home's category rail or "See
  // All") once. Category matching needs topCategories loaded first, so this
  // waits for that fetch rather than racing it.
  useEffect(() => {
    if (handledInitialParams) return;
    if (params.all === '1') {
      setShowAllProducts(true);
      setHandledInitialParams(true);
    } else if (params.category && topCategories.length > 0) {
      const match = topCategories.find((c) => c.name === params.category);
      if (match) {
        setSelectedCategory(match.name);
        setHandledInitialParams(true);
      }
    }
  }, [params.all, params.category, topCategories, handledInitialParams]);

  // products.category_id references a subcategory row directly; these maps
  // resolve the display names this screen navigates by (set from tile
  // presses below) back to the ids actually needed to query/search.
  const subCategoryIdByName = useMemo(() => {
    const map: Record<string, string> = {};
    Object.values(subCategoriesByParent).forEach((subs) => {
      subs.forEach((s) => { map[s.name] = s.id; });
    });
    return map;
  }, [subCategoriesByParent]);

  const subCategoryIdsMatching = useCallback((text: string) => {
    const lower = text.toLowerCase();
    const ids = new Set<string>();
    topCategories
      .filter((c) => c.name.toLowerCase().includes(lower))
      .forEach((top) => (subCategoriesByParent[top.name] || []).forEach((s) => ids.add(s.id)));
    Object.values(subCategoriesByParent)
      .flat()
      .filter((s) => s.name.toLowerCase().includes(lower))
      .forEach((s) => ids.add(s.id));
    return Array.from(ids);
  }, [topCategories, subCategoriesByParent]);

  // Filter States (Applied)
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [selectedPriceRange, setSelectedPriceRange] = useState<string | null>(null);
  const [customMinPrice, setCustomMinPrice] = useState('');
  const [customMaxPrice, setCustomMaxPrice] = useState('');
  const [selectedNewArrivalsOnly, setSelectedNewArrivalsOnly] = useState(false);
  const [selectedSaleOnly, setSelectedSaleOnly] = useState(false);
  const [selectedArOnly, setSelectedArOnly] = useState(false);
  const [selectedMySizeOnly, setSelectedMySizeOnly] = useState(false);
  const [selectedFits, setSelectedFits] = useState<string[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Sorting State
  const [selectedSort, setSelectedSort] = useState<string>('recommended');
  const sortSheetRef = useRef<BottomSheetModal>(null);
  const filterSheetRef = useRef<BottomSheetModal>(null);
  // Snap points: filter sheet is tall (85%), sort sheet is short (auto)
  const filterSnapPoints = useMemo(() => ['85%'], []);
  const sortSnapPoints = useMemo(() => ['40%'], []);

  // Temp Filter States (Within Bottom Sheet)
  const [tempSizes, setTempSizes] = useState<string[]>([]);
  const [tempColors, setTempColors] = useState<string[]>([]);
  const [tempPriceRange, setTempPriceRange] = useState<string | null>(null);
  const [tempMinPrice, setTempMinPrice] = useState('');
  const [tempMaxPrice, setTempMaxPrice] = useState('');
  const [tempNewArrivalsOnly, setTempNewArrivalsOnly] = useState(false);
  const [tempSaleOnly, setTempSaleOnly] = useState(false);
  const [tempArOnly, setTempArOnly] = useState(false);
  const [tempMySizeOnly, setTempMySizeOnly] = useState(false);
  const [tempFits, setTempFits] = useState<string[]>([]);
  const [tempMaterials, setTempMaterials] = useState<string[]>([]);
  const [tempTags, setTempTags] = useState<string[]>([]);

  // Reset navigation selection down to a specific level
  const resetSelection = (level: number) => {
    if (level === 0) {
      setSelectedCategory(null);
      setSelectedSubCategory(null);
      setShowAllProducts(false);
    } else if (level === 1) {
      setSelectedSubCategory(null);
    }
  };

  // Back button handler
  const handleBack = () => {
    if (isSearchActive) {
      setIsSearchActive(false);
      setSearchQuery('');
      setSearchResults([]);
    } else if (showAllProducts) {
      setShowAllProducts(false);
    } else if (selectedSubCategory) {
      setSelectedSubCategory(null);
    } else if (selectedCategory) {
      setSelectedCategory(null);
    }
  };

  // Fetch search results from Supabase via search_catalog RPC.
  // All standard filters (size, color, price, fit, material, tags, sale, AR, new arrivals)
  // are pushed server-side. Only the fit-aware My Size filter remains client-side.
  const fetchSearchResults = useCallback(async (text: string) => {
    if (!text.trim()) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setSearchError(null);
    try {
      const safeText = text.replace(/[,()\"]/g, ' ').trim();
      if (!safeText) {
        setSearchResults([]);
        return;
      }
      // Expand category-name matches to their subcategory IDs server-side.
      const matchingCategoryIds = subCategoryIdsMatching(safeText);
      const categoryIds = matchingCategoryIds.length > 0 ? matchingCategoryIds : null;

      let minPrice: number | null = customMinPrice ? parseFloat(customMinPrice) : null;
      let maxPrice: number | null = customMaxPrice ? parseFloat(customMaxPrice) : null;
      if (selectedPriceRange === 'under1000') { maxPrice = 999.99; }
      else if (selectedPriceRange === '1000to2000') { minPrice = 1000; maxPrice = 2000; }
      else if (selectedPriceRange === '2000to4000') { minPrice = 2000; maxPrice = 4000; }
      else if (selectedPriceRange === 'over4000') { minPrice = 4000.01; }

      const { data, error } = await (supabase.rpc as any)('search_catalog', {
        search_query: safeText,
        category_ids: categoryIds,
        size_filters: selectedSizes.length > 0 ? selectedSizes : null,
        color_filters: selectedColors.length > 0 ? selectedColors : null,
        fit_filters: selectedFits.length > 0 ? selectedFits : null,
        material_filters: selectedMaterials.length > 0 ? selectedMaterials : null,
        tag_filters: selectedTags.length > 0 ? selectedTags : null,
        on_sale_only: selectedSaleOnly,
        new_arrivals_only: selectedNewArrivalsOnly,
        ar_only: selectedArOnly,
        min_price: isNaN(minPrice as number) ? null : minPrice,
        max_price: isNaN(maxPrice as number) ? null : maxPrice,
        sort_by: selectedSort,
      }).select(PRODUCT_SELECT);

      if (error) {
        console.error('Error fetching search results:', error);
        setSearchError(error.message || 'Search failed');
        showToast('Search encountered an error. Please try again.', 'error');
      } else if (data) {
        setSearchResults(data);
        setSearchError(null);
      }
    } catch (err) {
      // Screen-level indication a search had failed vs. genuinely returned nothing
      console.error(err);
      setSearchError('Search failed. Please try again.');
      showToast('Search failed. Please try again.', 'error');
    } finally {
      setIsSearching(false);
    }
  }, [
    subCategoryIdsMatching, showToast,
    selectedSizes, selectedColors, selectedFits, selectedMaterials, selectedTags,
    selectedSaleOnly, selectedNewArrivalsOnly, selectedArOnly,
    customMinPrice, customMaxPrice, selectedPriceRange, selectedSort,
  ]);

  // Trigger search on query change
  useEffect(() => {
    if (isSearchActive) {
      fetchSearchResults(searchQuery);
    }
  }, [searchQuery, isSearchActive, fetchSearchResults]);

  // Builds the filtered/sorted RPC call for browse mode (category drill-down or Shop All).
  // Shared by the initial fetch, pull-to-refresh, and infinite scroll load-more so they
  // can never drift out of sync on filters or ordering. All standard filters are
  // pushed server-side; only the fit-aware My Size filter stays client-side.
  const buildProductsQuery = useCallback(() => {
    let categoryIds: string[] | null = null;

    if (showAllProducts) {
      // null = no category constraint; RPC returns all public products.
      categoryIds = null;
    } else if (selectedCategory && selectedSubCategory) {
      if (selectedSubCategory === 'View All') {
        categoryIds = (subCategoriesByParent[selectedCategory] || []).map((s) => s.id);
      } else {
        const subId = subCategoryIdByName[selectedSubCategory];
        if (!subId) return null;
        categoryIds = [subId];
      }
    } else {
      return null;
    }

    let minPrice: number | null = customMinPrice ? parseFloat(customMinPrice) : null;
    let maxPrice: number | null = customMaxPrice ? parseFloat(customMaxPrice) : null;
    if (selectedPriceRange === 'under1000') { maxPrice = 999.99; }
    else if (selectedPriceRange === '1000to2000') { minPrice = 1000; maxPrice = 2000; }
    else if (selectedPriceRange === '2000to4000') { minPrice = 2000; maxPrice = 4000; }
    else if (selectedPriceRange === 'over4000') { minPrice = 4000.01; }

    return (supabase.rpc as any)('search_catalog', {
      search_query: null,
      category_ids: categoryIds,
      size_filters: selectedSizes.length > 0 ? selectedSizes : null,
      color_filters: selectedColors.length > 0 ? selectedColors : null,
      fit_filters: selectedFits.length > 0 ? selectedFits : null,
      material_filters: selectedMaterials.length > 0 ? selectedMaterials : null,
      tag_filters: selectedTags.length > 0 ? selectedTags : null,
      on_sale_only: selectedSaleOnly,
      new_arrivals_only: selectedNewArrivalsOnly,
      ar_only: selectedArOnly,
      min_price: isNaN(minPrice as number) ? null : minPrice,
      max_price: isNaN(maxPrice as number) ? null : maxPrice,
      sort_by: selectedSort,
    }).select(PRODUCT_SELECT);
  }, [
    showAllProducts, selectedCategory, selectedSubCategory, subCategoriesByParent, subCategoryIdByName,
    selectedSizes, selectedColors, selectedFits, selectedMaterials, selectedTags,
    selectedSaleOnly, selectedNewArrivalsOnly, selectedArOnly,
    customMinPrice, customMaxPrice, selectedPriceRange, selectedSort,
  ]);

  // Fetch page 0 whenever the active category/subcategory/"Shop All" mode changes.
  const fetchInitialProducts = useCallback(() => {
    const query = buildProductsQuery();
    if (!query) {
      setProducts([]);
      setProductsError(null);
      return;
    }

    setLoading(true);
    setProductsError(null);
    setProductsPage(0);
    setHasMoreProducts(true);

    query
      .range(0, PAGE_SIZE - 1)
      .then(
        ({ data, error }: { data: any; error: any }) => {
          if (error) {
            console.error('Error fetching products:', error);
            setProductsError(error.message || 'Could not load products');
            showToast('Could not load products. Please try again.', 'error');
          } else if (data) {
            setProducts(data);
            setHasMoreProducts(data.length === PAGE_SIZE);
            setProductsError(null);
          }
          setLoading(false);
        },
        (err: unknown) => {
          console.error('Network or server error loading products:', err);
          setProductsError('Network or server error');
          setLoading(false);
        }
      );
  }, [buildProductsQuery, showToast]);

  useEffect(() => {
    fetchInitialProducts();
  }, [fetchInitialProducts]);

  // Re-runs page 0 for whatever category is active, so a pull always reflects
  // the current filters rather than resetting the user's place.
  const onRefreshProducts = useCallback(async () => {
    const query = buildProductsQuery();
    if (!query) return;
    setRefreshing(true);
    try {
      const { data, error } = await query.range(0, PAGE_SIZE - 1);
      if (error) {
        console.error('Error refreshing products:', error);
        setProductsError(error.message || 'Could not refresh products');
        showToast('Could not refresh products. Please try again.', 'error');
      } else if (data) {
        setProducts(data);
        setProductsPage(0);
        setHasMoreProducts(data.length === PAGE_SIZE);
        setProductsError(null);
      }
    } catch (err) {
      console.error('Unexpected error refreshing products:', err);
      setProductsError('Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [buildProductsQuery, showToast]);

  const loadMoreProducts = useCallback(async () => {
    if (loading || loadingMore || !hasMoreProducts) return;
    const query = buildProductsQuery();
    if (!query) return;

    const nextPage = productsPage + 1;
    setLoadingMore(true);
    try {
      const from = nextPage * PAGE_SIZE;
      const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
      if (error) {
        console.error('Error fetching more products:', error);
      } else if (data) {
        setProducts((prev) => [...prev, ...data]);
        setProductsPage(nextPage);
        setHasMoreProducts(data.length === PAGE_SIZE);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [buildProductsQuery, loading, loadingMore, hasMoreProducts, productsPage]);

  // Fit-aware sizing: recommended size per product for the currently visible
  // list, computed from the user's stored measurements. Empty when the user
  // has no usable measurements, which keeps the badge and "My Size" filter
  // from ever guessing.
  const recommendedSizes = useMemo(() => {
    const map = new Map<string, string | null>();
    if (!sizingReady || !sizingMeasurements) return map;
    const source = isSearchActive ? searchResults : products;
    source.forEach((p) => {
      map.set(p.id, recommendSize(sizingMeasurements, (p as any).measurements, fitPreference));
    });
    return map;
  }, [products, searchResults, isSearchActive, sizingMeasurements, fitPreference, sizingReady]);

  // F-001: All standard filters and sorting are now handled server-side by the
  // search_catalog RPC. The only client-side work remaining is the fit-aware
  // "My Size" filter, which relies on personal body measurements that cannot
  // be expressed in SQL.
  const processedProducts = useMemo(() => {
    const source = isSearchActive ? searchResults : products;
    if (!selectedMySizeOnly) return source;

    return source.filter((product) => {
      const rec = recommendedSizes.get(product.id);
      if (!rec) return false;
      const sizes = product.sizes || [];
      if (sizes.length > 0 && !sizes.includes(rec)) return false;
      return true;
    });
  }, [products, searchResults, isSearchActive, selectedMySizeOnly, recommendedSizes]);

  // Filter Modal Actions
  const openFilterModal = () => {
    setTempSizes(selectedSizes);
    setTempColors(selectedColors);
    setTempPriceRange(selectedPriceRange);
    setTempMinPrice(customMinPrice);
    setTempMaxPrice(customMaxPrice);
    setTempNewArrivalsOnly(selectedNewArrivalsOnly);
    setTempSaleOnly(selectedSaleOnly);
    setTempArOnly(selectedArOnly);
    setTempMySizeOnly(selectedMySizeOnly);
    setTempFits(selectedFits);
    setTempMaterials(selectedMaterials);
    setTempTags(selectedTags);
    filterSheetRef.current?.present();
  };

  const applyFilters = () => {
    setSelectedSizes(tempSizes);
    setSelectedColors(tempColors);
    setSelectedPriceRange(tempPriceRange);
    setCustomMinPrice(tempMinPrice);
    setCustomMaxPrice(tempMaxPrice);
    setSelectedNewArrivalsOnly(tempNewArrivalsOnly);
    setSelectedSaleOnly(tempSaleOnly);
    setSelectedArOnly(tempArOnly);
    setSelectedMySizeOnly(tempMySizeOnly);
    setSelectedFits(tempFits);
    setSelectedMaterials(tempMaterials);
    setSelectedTags(tempTags);
    filterSheetRef.current?.dismiss();
  };

  const clearAllFilters = () => {
    setTempSizes([]);
    setTempColors([]);
    setTempPriceRange(null);
    setTempMinPrice('');
    setTempMaxPrice('');
    setTempNewArrivalsOnly(false);
    setTempSaleOnly(false);
    setTempArOnly(false);
    setTempMySizeOnly(false);
    setTempFits([]);
    setTempMaterials([]);
    setTempTags([]);
  };

  const clearAllFiltersDirectly = () => {
    setSelectedSizes([]);
    setSelectedColors([]);
    setSelectedPriceRange(null);
    setCustomMinPrice('');
    setCustomMaxPrice('');
    setSelectedNewArrivalsOnly(false);
    setSelectedSaleOnly(false);
    setSelectedArOnly(false);
    setSelectedMySizeOnly(false);
    setSelectedFits([]);
    setSelectedMaterials([]);
    setSelectedTags([]);
  };

  // Toggle helpers
  const toggleTempSize = (size: string) => {
    setTempSizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    );
  };

  const toggleTempColor = (colorName: string) => {
    setTempColors((prev) =>
      prev.includes(colorName) ? prev.filter((c) => c !== colorName) : [...prev, colorName]
    );
  };

  const toggleTempFit = (fit: string) => {
    setTempFits((prev) =>
      prev.includes(fit) ? prev.filter((f) => f !== fit) : [...prev, fit]
    );
  };

  const toggleTempMaterial = (material: string) => {
    setTempMaterials((prev) =>
      prev.includes(material) ? prev.filter((m) => m !== material) : [...prev, material]
    );
  };

  // Memoised because activeFilterChips depends on them; as plain functions they
  // were rebuilt every render and the memo never held.
  const removeSizeFilter = useCallback((size: string) => {
    setSelectedSizes((prev) => prev.filter((s) => s !== size));
  }, []);

  const removeColorFilter = useCallback((color: string) => {
    setSelectedColors((prev) => prev.filter((c) => c !== color));
  }, []);

  const removeFitFilter = useCallback((fit: string) => {
    setSelectedFits((prev) => prev.filter((f) => f !== fit));
  }, []);

  const removeMaterialFilter = useCallback((material: string) => {
    setSelectedMaterials((prev) => prev.filter((m) => m !== material));
  }, []);

  // Breadcrumbs renderer (e.g. Tops > Knits & Sweaters)
  const renderBreadcrumbs = () => {
    const breadcrumbItems = [];

    // Explore / Root level
    breadcrumbItems.push(
      <TouchableOpacity key="root" onPress={() => resetSelection(0)} accessibilityRole="button" accessibilityLabel="Back to Explore categories">
        <Text style={[styles.breadcrumbText, { color: colors.secondaryText }]}>Explore</Text>
      </TouchableOpacity>
    );

    if (showAllProducts) {
      breadcrumbItems.push(
        <Text key="sep-all" style={[styles.breadcrumbSeparator, { color: colors.secondaryText }]}> &gt; </Text>,
        <Text key="all" style={[styles.breadcrumbText, { color: colors.tint, fontWeight: '700' }]}>All Products</Text>
      );
    }

    if (selectedCategory) {
      breadcrumbItems.push(
        <Text key="sep1" style={[styles.breadcrumbSeparator, { color: colors.secondaryText }]}> &gt; </Text>,
        <TouchableOpacity key="cat" onPress={() => resetSelection(1)} accessibilityRole="button" accessibilityLabel={`Back to ${selectedCategory} subcategories`}>
          <Text style={[styles.breadcrumbText, { color: selectedSubCategory ? colors.secondaryText : colors.tint, fontWeight: selectedSubCategory ? '400' : '700' }]}>{selectedCategory}</Text>
        </TouchableOpacity>
      );
    }

    if (selectedSubCategory) {
      breadcrumbItems.push(
        <Text key="sep2" style={[styles.breadcrumbSeparator, { color: colors.secondaryText }]}> &gt; </Text>,
        <Text key="subcat" style={[styles.breadcrumbText, { color: colors.tint, fontWeight: '700' }]}>{selectedSubCategory}</Text>
      );
    }

    return (
      <View style={styles.breadcrumbWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.breadcrumbsContainer}>
          {breadcrumbItems}
        </ScrollView>
      </View>
    );
  };

  const renderProductItem = useCallback(({ item }: { item: unknown }) => {
    // MasonryList's default export is wrapped in React.memo, which erases its
    // generic <T> -- renderItem's declared type is always `unknown`, so a
    // single narrow cast here is unavoidable. Everything downstream of this
    // point is fully typed as Product.
    const product = item as Product;
    return (
      <ProductCard
        product={product}
        variant="grid"
        recommendedSize={recommendedSizes.get(product.id)}
      />
    );
  }, [recommendedSizes]);

  // One description of every active filter, rendered by the header and counted
  // for the badge. These were previously eight hand-written JSX blocks plus a
  // separately maintained sum, duplicated across the search and browse headers
  // -- four places that had to agree. a11y labels are carried explicitly
  // because they do not follow the visible label uniformly.
  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; a11y: string; onRemove: () => void }[] = [];
    if (selectedNewArrivalsOnly) chips.push({ key: 'new-arrivals', label: 'New Arrivals', a11y: 'Remove New Arrivals filter', onRemove: () => setSelectedNewArrivalsOnly(false) });
    if (selectedSaleOnly) chips.push({ key: 'on-sale', label: 'On Sale', a11y: 'Remove On Sale filter', onRemove: () => setSelectedSaleOnly(false) });
    if (selectedArOnly) chips.push({ key: 'ar', label: 'Try in AR', a11y: 'Remove Try in AR filter', onRemove: () => setSelectedArOnly(false) });
    if (selectedMySizeOnly) chips.push({ key: 'my-size', label: 'My Size', a11y: 'Remove My Size filter', onRemove: () => setSelectedMySizeOnly(false) });
    selectedSizes.forEach((size) => chips.push({ key: `size-${size}`, label: `Size: ${size}`, a11y: `Remove Size ${size} filter`, onRemove: () => removeSizeFilter(size) }));
    selectedColors.forEach((color) => chips.push({ key: `color-${color}`, label: `Color: ${color}`, a11y: `Remove Color ${color} filter`, onRemove: () => removeColorFilter(color) }));
    selectedFits.forEach((fit) => chips.push({ key: `fit-${fit}`, label: `Fit: ${fit}`, a11y: `Remove Fit ${fit} filter`, onRemove: () => removeFitFilter(fit) }));
    selectedMaterials.forEach((mat) => chips.push({ key: `material-${mat}`, label: `Material: ${mat}`, a11y: `Remove Material ${mat} filter`, onRemove: () => removeMaterialFilter(mat) }));
    if (selectedPriceRange) {
      const label = selectedPriceRange === 'under1000' ? 'Under ₱1k' : selectedPriceRange === '1000to2000' ? '₱1k - ₱2k' : selectedPriceRange === '2000to4000' ? '₱2k - ₱4k' : '₱4k+';
      chips.push({ key: 'price-range', label: `Price: ${label}`, a11y: 'Remove price range filter', onRemove: () => setSelectedPriceRange(null) });
    }
    if (customMinPrice || customMaxPrice) {
      chips.push({ key: 'custom-price', label: `Price: ₱${customMinPrice || '0'}-₱${customMaxPrice || '∞'}`, a11y: 'Remove custom price filter', onRemove: () => { setCustomMinPrice(''); setCustomMaxPrice(''); } });
    }
    return chips;
  }, [
    selectedNewArrivalsOnly, selectedSaleOnly, selectedArOnly, selectedMySizeOnly,
    selectedSizes, selectedColors, selectedFits, selectedMaterials,
    selectedPriceRange, customMinPrice, customMaxPrice,
    removeSizeFilter, removeColorFilter, removeFitFilter, removeMaterialFilter,
  ]);

  const activeFiltersCount = activeFilterChips.length;

  const renderQuickFilterPills = () => {
    const isAllActive = !selectedNewArrivalsOnly && !selectedSaleOnly && !selectedArOnly && !selectedMySizeOnly;
    return (
      <View style={[styles.quickFiltersWrapper, { borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickFiltersScroll}>
          <TouchableOpacity
            style={[
              styles.quickFilterChip,
              {
                backgroundColor: isAllActive ? colors.tint : colors.card,
                borderColor: isAllActive ? colors.tint : colors.border,
              },
            ]}
            onPress={() => {
              setSelectedNewArrivalsOnly(false);
              setSelectedSaleOnly(false);
              setSelectedArOnly(false);
              setSelectedMySizeOnly(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Show all items"
          >
            <Text style={[styles.quickFilterChipText, { color: isAllActive ? colors.onTint : colors.text, fontWeight: isAllActive ? '700' : '500' }]}>
              All
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.quickFilterChip,
              {
                backgroundColor: selectedNewArrivalsOnly ? colors.tint : colors.card,
                borderColor: selectedNewArrivalsOnly ? colors.tint : colors.border,
              },
            ]}
            onPress={() => setSelectedNewArrivalsOnly((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel="Filter by New Arrivals"
          >
            <Text style={[styles.quickFilterChipText, { color: selectedNewArrivalsOnly ? colors.onTint : colors.text, fontWeight: selectedNewArrivalsOnly ? '700' : '500' }]}>
              New Arrivals
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.quickFilterChip,
              {
                backgroundColor: selectedSaleOnly ? colors.tint : colors.card,
                borderColor: selectedSaleOnly ? colors.tint : colors.border,
              },
            ]}
            onPress={() => setSelectedSaleOnly((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel="Filter by On Sale"
          >
            <Text style={[styles.quickFilterChipText, { color: selectedSaleOnly ? colors.onTint : colors.text, fontWeight: selectedSaleOnly ? '700' : '500' }]}>
              On Sale
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.quickFilterChip,
              {
                backgroundColor: selectedArOnly ? colors.tint : colors.card,
                borderColor: selectedArOnly ? colors.tint : colors.border,
              },
            ]}
            onPress={() => setSelectedArOnly((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel="Filter by AR Try-On"
          >
            <Text style={[styles.quickFilterChipText, { color: selectedArOnly ? colors.onTint : colors.text, fontWeight: selectedArOnly ? '700' : '500' }]}>
              AR Try-On
            </Text>
          </TouchableOpacity>

          {sizingReady && sizingMeasurements && (
            <TouchableOpacity
              style={[
                styles.quickFilterChip,
                {
                  backgroundColor: selectedMySizeOnly ? colors.tint : colors.card,
                  borderColor: selectedMySizeOnly ? colors.tint : colors.border,
                },
              ]}
              onPress={() => setSelectedMySizeOnly((prev) => !prev)}
              accessibilityRole="button"
              accessibilityLabel="Filter by My Size"
            >
              <Text style={[styles.quickFilterChipText, { color: selectedMySizeOnly ? colors.onTint : colors.text, fontWeight: selectedMySizeOnly ? '700' : '500' }]}>
                My Size
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  };

  // The search and browse grids render an identical header differing only in
  // their results count and sort label. It used to be copy-pasted, so every
  // edit had to be made twice or the two drifted. A local function rather than
  // a component because it closes over ~20 pieces of filter state, which as
  // props would be a 30-entry interface.
  const renderGridHeader = (resultsLabel: string, sortLabel: string, sortA11y: string) => (
    <>
      {/* Sticky Controls Panel */}
      <View style={[styles.gridHeader, { backgroundColor: colors.background, borderBottomWidth: activeFiltersCount > 0 ? 0 : 1, borderBottomColor: colors.border }]}>
        <Text style={[styles.resultsCountText, { color: colors.secondaryText }]}>{resultsLabel}</Text>
        <View style={styles.controlsRow}>
          <TouchableOpacity
            style={[styles.filterTrigger, { backgroundColor: colors.card, borderColor: colors.border }]}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            onPress={openFilterModal}
            accessibilityRole="button"
            accessibilityLabel={activeFiltersCount > 0 ? `Filters, ${activeFiltersCount} active` : 'Open filters'}
          >
            <IconSymbol name="slider.horizontal.3" size={14} color={colors.tint} />
            <Text style={[styles.filterTriggerText, { color: colors.text }]}>Filter</Text>
            {activeFiltersCount > 0 && (
              <View style={[styles.badge, { backgroundColor: colors.tint }]}>
                <Text style={[styles.badgeText, { color: colors.onTint }]}>{activeFiltersCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterTrigger, { backgroundColor: colors.card, borderColor: colors.border }]}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            onPress={() => sortSheetRef.current?.present()}
            accessibilityRole="button"
            accessibilityLabel={sortA11y}
          >
            <IconSymbol name="arrow.up.arrow.down" size={14} color={colors.tint} />
            <Text style={[styles.filterTriggerText, { color: colors.text }]}>{sortLabel}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Active Filter Tags */}
      {activeFiltersCount > 0 && (
        <View style={[styles.activeFiltersWrapper, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeFiltersScroll}>
            <TouchableOpacity
              onPress={clearAllFiltersDirectly}
              style={[styles.clearAllTag, { borderColor: colors.border }]}
              accessibilityRole="button"
              accessibilityLabel="Clear all filters"
            >
              <Text style={[styles.clearAllTagText, { color: colors.notification }]}>Clear All</Text>
            </TouchableOpacity>
            {activeFilterChips.map((chip) => (
              <View key={chip.key} style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.filterTagText, { color: colors.text }]}>{chip.label}</Text>
                <TouchableOpacity onPress={chip.onRemove} hitSlop={8} accessibilityRole="button" accessibilityLabel={chip.a11y}>
                  <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
    </>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Search Header */}
      <View style={styles.header}>
        {(selectedCategory || isSearchActive || showAllProducts) && (
          <TouchableOpacity
            onPress={handleBack}
            style={[styles.backButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <IconSymbol name="arrow.left" size={18} color={colors.text} />
          </TouchableOpacity>
        )}
        <View style={styles.searchBarWrapper}>
          <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <IconSymbol name="magnifyingglass" size={20} color={colors.icon} style={styles.searchIcon} />
            <TextInput keyboardAppearance={theme}
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Search items, categories, or styles..."
              placeholderTextColor={colors.secondaryText}
              value={searchQuery}
              onChangeText={setSearchQuery}
              onFocus={() => setIsSearchActive(true)}
              accessibilityLabel="Search products"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
                <IconSymbol name="xmark" size={16} color={colors.secondaryText} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        {isSearchActive && (
          <TouchableOpacity onPress={handleBack} style={styles.cancelButton} accessibilityRole="button" accessibilityLabel="Cancel search">
            <Text style={[styles.cancelText, { color: colors.tint }]}>Cancel</Text>
          </TouchableOpacity>
        )}
        {!isSearchActive && (
          <TouchableOpacity
            onPress={() => router.push('/cart')}
            style={styles.cartBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={itemCount > 0 ? `Cart, ${itemCount} items` : 'Cart, empty'}
          >
            <IconSymbol name="bag" size={24} color={colors.text} />
            {itemCount > 0 && (
              <View style={[styles.cartBadge, { backgroundColor: colors.notification }]}>
                <Text style={styles.cartBadgeText}>{itemCount > 99 ? '99+' : itemCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Main Body Layout */}
      {isSearchActive ? (
        // Search Results & Suggestions Mode
        <View style={styles.flexOne}>
          {searchQuery.trim().length === 0 ? (
            // Idle / Search Focused suggestions: Uniqlo Minimal Aesthetic
            <View style={styles.suggestionsContainer}>
              <Text style={[styles.sectionTitle, { color: colors.text, marginTop: Spacing.md }]}>Suggested Searches</Text>
              <View style={styles.tagsContainer}>
                {['Summer Dress', 'Denim Jacket', 'Vintage', 'Minimalist', 'Streetwear'].map((tag, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[styles.tag, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => setSearchQuery(tag)}
                    accessibilityRole="button"
                    accessibilityLabel={`Search for ${tag}`}
                  >
                    <IconSymbol name="magnifyingglass" size={12} color={colors.secondaryText} style={styles.tagIcon} />
                    <Text style={[styles.tagText, { color: colors.secondaryText }]}>{tag}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : (
            // Search Results Grid with Filter capabilities
            <View style={styles.flexOne}>
              {isSearching ? (
                <View style={styles.skeletonGrid}>
                  <SkeletonList count={6}><ProductCardSkeleton /></SkeletonList>
                </View>
              ) : searchError ? (
                <View style={styles.errorContainer}>
                  <View style={[styles.errorIconCircle, { backgroundColor: colors.notification + '15' }]}>
                    <IconSymbol name="exclamationmark.triangle.fill" size={32} color={colors.notification} />
                  </View>
                  <Text style={[styles.errorTitle, { color: colors.text }]}>Search failed</Text>
                  <Text style={[styles.errorMessage, { color: colors.secondaryText }]}>
                    We could not load search results. Please check your connection.
                  </Text>
                  <TouchableOpacity
                    style={[styles.retryButton, { backgroundColor: colors.tint }]}
                    onPress={() => fetchSearchResults(searchQuery)}
                    accessibilityRole="button"
                    accessibilityLabel="Retry search"
                  >
                    <IconSymbol name="arrow.clockwise" size={16} color={colors.onTint} />
                    <Text style={[styles.retryButtonText, { color: colors.onTint }]}>Try Again</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <MasonryList
                  data={processedProducts}
                  renderItem={renderProductItem}
                  keyExtractor={(item) => item.id}
                  key={`grid-${columns}`}
                  numColumns={columns}
                  contentContainerStyle={styles.productList}
                  ListHeaderComponent={
                    <View style={{ backgroundColor: colors.background }}>
                      {renderGridHeader(
                        `${processedProducts.length} results found for "${searchQuery}"`,
                        'Sort',
                        'Open sort options',
                      )}
                      {renderQuickFilterPills()}
                    </View>
                  }
                  ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                      <BrandEmptyState
                        icon="bag.fill"
                        title="No matches"
                        message={activeFiltersCount > 0
                          ? "Nothing matches this search and filter combination. Try clearing some filters."
                          : "No products matched your search term."
                        }
                      />
                      {activeFiltersCount > 0 && (
                        <TouchableOpacity
                          style={[styles.clearFiltersButton, { backgroundColor: colors.tint }]}
                          onPress={clearAllFiltersDirectly}
                          accessibilityRole="button"
                          accessibilityLabel="Clear all filters"
                        >
                          <Text style={[styles.clearFiltersButtonText, { color: colors.onTint }]}>Clear All Filters</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  }
                  stickyHeaderIndices={[0]}
                />
              )}
            </View>
          )}
        </View>
      ) : (
        // Hierarchical Browsing Mode
        <View style={styles.flexOne}>
          {renderBreadcrumbs()}

          {/* Level 0: Categories Grid */}
          {!selectedCategory && !showAllProducts && (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              <TouchableOpacity
                style={[styles.shopAllButton, { backgroundColor: colors.tint }]}
                onPress={() => setShowAllProducts(true)}
                accessibilityRole="button"
                accessibilityLabel="Browse all products"
              >
                <IconSymbol name="bag.fill" size={18} color={colors.onTint} />
                <Text style={[styles.shopAllButtonText, { color: colors.onTint }]}>Shop All Products</Text>
              </TouchableOpacity>

              {needsSizingSetup && !sizingNudgeDismissed && (
                <View style={[styles.sizingNudge, { backgroundColor: colors.card, borderColor: colors.tint }]}>
                  <IconSymbol name="person.fill" size={20} color={colors.tint} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sizingNudgeTitle, { color: colors.text }]}>Get your size on every item</Text>
                    <Text style={[styles.sizingNudgeBody, { color: colors.secondaryText }]}>
                      Add your measurements once to see a recommended size right on the catalog.
                    </Text>
                    <TouchableOpacity
                      onPress={() => router.push('/profile/measurements')}
                      accessibilityRole="button"
                      accessibilityLabel="Add your measurements"
                      hitSlop={8}
                    >
                      <Text style={[styles.sizingNudgeAction, { color: colors.tint }]}>Add measurements</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={() => setSizingNudgeDismissed(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss sizing prompt"
                    hitSlop={8}
                  >
                    <IconSymbol name="xmark" size={16} color={colors.secondaryText} />
                  </TouchableOpacity>
                </View>
              )}

              <Text style={[styles.welcomeTitle, { color: colors.text }]}>Categories</Text>
              {categoriesLoading ? (
                <View style={styles.skeletonGrid}>
                  <SkeletonList count={6}><ProductCardSkeleton /></SkeletonList>
                </View>
              ) : categoriesError ? (
                <View style={styles.errorContainerSmall}>
                  <Text style={[styles.errorMessage, { color: colors.secondaryText }]}>
                    Could not load categories.
                  </Text>
                  <TouchableOpacity
                    style={[styles.retryButtonSmall, { backgroundColor: colors.tint }]}
                    onPress={fetchCategories}
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading categories"
                  >
                    <Text style={[styles.retryButtonText, { color: colors.onTint }]}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.categoriesGrid}>
                  {topCategories.map((cat) => (
                    <CategoryCard
                      key={cat.id}
                      category={cat}
                      variant="grid"
                      onPress={() => {
                        recordCategoryVisit(cat.name);
                        setSelectedCategory(cat.name);
                      }}
                    />
                  ))}
                </View>
              )}
            </ScrollView>
          )}

          {/* Level 1: Sub-Categories View in a 2-Column Grid Layout */}
          {selectedCategory && !selectedSubCategory && (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              <Text style={[styles.welcomeTitle, { color: colors.text }]}>Shop {selectedCategory}</Text>
              <View style={styles.categoriesGrid}>
                {/* View All is a synthetic category: it borrows the parent's
                    image so the row does not start with a blank tile. */}
                <CategoryCard
                  category={{
                    id: 'view-all',
                    name: 'View All',
                    image_url: topCategories.find((c) => c.name === selectedCategory)?.image_url ?? null,
                  }}
                  variant="grid"
                  onPress={() => setSelectedSubCategory('View All')}
                />

                {(subCategoriesByParent[selectedCategory] || []).map((subcat) => (
                  <CategoryCard
                    key={subcat.id}
                    category={subcat}
                    variant="grid"
                    onPress={() => setSelectedSubCategory(subcat.name)}
                  />
                ))}
              </View>
            </ScrollView>
          )}

          {/* Level 2: Products Grid View (also used by "Shop All") */}
          {((selectedCategory && selectedSubCategory) || showAllProducts) && (
            <View style={styles.flexOne}>
              {loading ? (
                <View style={styles.skeletonGrid}>
                  <SkeletonList count={6}><ProductCardSkeleton /></SkeletonList>
                </View>
              ) : productsError ? (
                <View style={styles.errorContainer}>
                  <View style={[styles.errorIconCircle, { backgroundColor: colors.notification + '15' }]}>
                    <IconSymbol name="exclamationmark.triangle.fill" size={32} color={colors.notification} />
                  </View>
                  <Text style={[styles.errorTitle, { color: colors.text }]}>Unable to load products</Text>
                  <Text style={[styles.errorMessage, { color: colors.secondaryText }]}>
                    We encountered an issue retrieving items from the catalog. Please try again.
                  </Text>
                  <TouchableOpacity
                    style={[styles.retryButton, { backgroundColor: colors.tint }]}
                    onPress={fetchInitialProducts}
                    accessibilityRole="button"
                    accessibilityLabel="Try loading products again"
                  >
                    <IconSymbol name="arrow.clockwise" size={16} color={colors.onTint} />
                    <Text style={[styles.retryButtonText, { color: colors.onTint }]}>Try Again</Text>
                  </TouchableOpacity>
                  {selectedCategory && (
                    <TouchableOpacity
                      style={[styles.secondaryActionButton, { borderColor: colors.border }]}
                      onPress={() => resetSelection(0)}
                      accessibilityRole="button"
                      accessibilityLabel="Browse categories"
                    >
                      <Text style={[styles.secondaryActionText, { color: colors.text }]}>Browse Categories</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <MasonryList
                  data={processedProducts}
                  renderItem={renderProductItem}
                  keyExtractor={(item) => item.id}
                  key={`grid-${columns}`}
                  numColumns={columns}
                  contentContainerStyle={styles.productList}
                  ListHeaderComponent={
                    <View style={{ backgroundColor: colors.background }}>
                      {renderGridHeader(
                        `${processedProducts.length} items found`,
                        `Sort: ${SORT_OPTIONS.find(o => o.id === selectedSort)?.label}`,
                        `Sort by ${SORT_OPTIONS.find(o => o.id === selectedSort)?.label}`,
                      )}
                      {renderQuickFilterPills()}
                    </View>
                  }
                  ListEmptyComponent={
                    <View style={styles.emptyContainer}>
                      <BrandEmptyState
                        icon="bag.fill"
                        title="No matches"
                        message={activeFiltersCount > 0
                          ? "Nothing in this category matches your filters. Try clearing a few."
                          : "No products currently available in this section."
                        }
                      />
                      {activeFiltersCount > 0 && (
                        <TouchableOpacity
                          style={[styles.clearFiltersButton, { backgroundColor: colors.tint }]}
                          onPress={clearAllFiltersDirectly}
                          accessibilityRole="button"
                          accessibilityLabel="Clear all filters"
                        >
                          <Text style={[styles.clearFiltersButtonText, { color: colors.onTint }]}>Clear All Filters</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  }
                  onEndReached={loadMoreProducts}
                  onEndReachedThreshold={0.5}
                  refreshing={refreshing}
                  onRefresh={onRefreshProducts}
                  refreshControlProps={{ tintColor: colors.tint, colors: [colors.tint] }}
                  ListFooterComponent={
                    loadingMore ? (
                      <View style={styles.loadMoreFooter}>
                        <SkeletonList count={2}><ProductCardSkeleton /></SkeletonList>
                      </View>
                    ) : null
                  }
                  stickyHeaderIndices={[0]}
                />
              )}
            </View>
          )}
        </View>
      )}


            {/* FILTER BOTTOM SHEET MODAL */}
      <BottomSheetModal
        ref={filterSheetRef}
        snapPoints={filterSnapPoints}
        backdropComponent={renderSheetBackdrop}
        backgroundStyle={{ backgroundColor: colors.background }}
        handleIndicatorStyle={{ backgroundColor: colors.border }}
        keyboardBehavior="extend"
      >
        <BottomSheetView style={{ flex: 1 }}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <Text accessibilityRole="header" style={[styles.modalTitle, { color: colors.text }]}>Refine Results</Text>
            <TouchableOpacity
              onPress={clearAllFilters}
              accessibilityRole="button"
              accessibilityLabel="Clear all filters"
            >
              <Text style={[styles.clearAllText, { color: colors.notification }]}>Clear All</Text>
            </TouchableOpacity>
          </View>

          <BottomSheetScrollView style={styles.modalScroll}>
            {/* Special Offers Section */}
            <View style={styles.filterSection}>
              <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Collections & Offers</Text>
              <View style={styles.filterOptionsRow}>
                <TouchableOpacity
                  style={[
                    styles.chipButton,
                    {
                      backgroundColor: tempNewArrivalsOnly ? colors.tint : colors.card,
                      borderColor: tempNewArrivalsOnly ? colors.tint : colors.border,
                    },
                  ]}
                  onPress={() => setTempNewArrivalsOnly(!tempNewArrivalsOnly)}
                  accessibilityRole="switch"
                  accessibilityLabel="New arrivals only"
                  accessibilityState={{ checked: tempNewArrivalsOnly }}
                >
                  <IconSymbol name="flame.fill" size={14} color={tempNewArrivalsOnly ? colors.onTint : colors.tint} style={{ marginRight: 6 }} />
                  <Text style={[styles.chipButtonText, { color: tempNewArrivalsOnly ? colors.onTint : colors.text }]}>New Arrivals</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.chipButton,
                    {
                      backgroundColor: tempSaleOnly ? colors.tint : colors.card,
                      borderColor: tempSaleOnly ? colors.tint : colors.border,
                    },
                  ]}
                  onPress={() => setTempSaleOnly(!tempSaleOnly)}
                  accessibilityRole="switch"
                  accessibilityLabel="On sale only"
                  accessibilityState={{ checked: tempSaleOnly }}
                >
                  <IconSymbol name="tag.fill" size={14} color={tempSaleOnly ? colors.onTint : colors.notification} style={{ marginRight: 6 }} />
                  <Text style={[styles.chipButtonText, { color: tempSaleOnly ? colors.onTint : colors.text }]}>On Sale</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.chipButton,
                    {
                      backgroundColor: tempArOnly ? colors.tint : colors.card,
                      borderColor: tempArOnly ? colors.tint : colors.border,
                    },
                  ]}
                  onPress={() => setTempArOnly(!tempArOnly)}
                  accessibilityRole="switch"
                  accessibilityLabel="Try in AR only"
                  accessibilityState={{ checked: tempArOnly }}
                >
                  <IconSymbol name="cube.transparent" size={14} color={tempArOnly ? colors.onTint : colors.tint} style={{ marginRight: 6 }} />
                  <Text style={[styles.chipButtonText, { color: tempArOnly ? colors.onTint : colors.text }]}>Try in AR</Text>
                </TouchableOpacity>

                {sizingReady && (
                  <TouchableOpacity
                    style={[
                      styles.chipButton,
                      {
                        backgroundColor: tempMySizeOnly ? colors.tint : colors.card,
                        borderColor: tempMySizeOnly ? colors.tint : colors.border,
                      },
                    ]}
                    onPress={() => setTempMySizeOnly(!tempMySizeOnly)}
                    accessibilityRole="switch"
                    accessibilityLabel="My size only"
                    accessibilityState={{ checked: tempMySizeOnly }}
                  >
                    <IconSymbol name="checkmark.circle.fill" size={14} color={tempMySizeOnly ? colors.onTint : colors.tint} style={{ marginRight: 6 }} />
                    <Text style={[styles.chipButtonText, { color: tempMySizeOnly ? colors.onTint : colors.text }]}>My Size</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Size Filter */}
            <View style={styles.filterSection}>
              <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Sizes</Text>
              <View style={styles.filterOptionsRow}>
                {FILTER_SIZES.map((size) => {
                  const isSelected = tempSizes.includes(size);
                  return (
                    <TouchableOpacity
                      key={size}
                      style={[
                        styles.sizeChip,
                        {
                          backgroundColor: isSelected ? colors.tint : colors.card,
                          borderColor: isSelected ? colors.tint : colors.border,
                        },
                      ]}
                      onPress={() => toggleTempSize(size)}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${size} size`}
                      accessibilityState={{ checked: isSelected }}
                    >
                      <Text style={[styles.sizeChipText, { color: isSelected ? colors.onTint : colors.text }]}>
                        {size}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Fit / Cut Filter */}
            <View style={styles.filterSection}>
              <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Fit / Cut</Text>
              <View style={styles.filterOptionsRow}>
                {FILTER_FITS.map((fit) => {
                  const isSelected = tempFits.includes(fit);
                  return (
                    <TouchableOpacity
                      key={fit}
                      style={[
                        styles.sizeChip,
                        {
                          backgroundColor: isSelected ? colors.tint : colors.card,
                          borderColor: isSelected ? colors.tint : colors.border,
                        },
                      ]}
                      onPress={() => toggleTempFit(fit)}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${fit} fit`}
                      accessibilityState={{ checked: isSelected }}
                    >
                      <Text style={[styles.sizeChipText, { color: isSelected ? colors.onTint : colors.text }]}>
                        {fit}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Material / Fabric Filter */}
            <View style={styles.filterSection}>
              <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Material / Fabric</Text>
              <View style={styles.filterOptionsRow}>
                {FILTER_MATERIALS.map((mat) => {
                  const isSelected = tempMaterials.includes(mat);
                  return (
                    <TouchableOpacity
                      key={mat}
                      style={[
                        styles.sizeChip,
                        {
                          backgroundColor: isSelected ? colors.tint : colors.card,
                          borderColor: isSelected ? colors.tint : colors.border,
                        },
                      ]}
                      onPress={() => toggleTempMaterial(mat)}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${mat} material`}
                      accessibilityState={{ checked: isSelected }}
                    >
                      <Text style={[styles.sizeChipText, { color: isSelected ? colors.onTint : colors.text }]}>
                        {mat}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Color Filter */}
            <View style={styles.filterSection}>
              <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Colors & Patterns</Text>
              <View style={styles.filterOptionsRow}>
                {colorOptions.map((color) => {
                  const isSelected = tempColors.includes(color.name);
                  return (
                    <TouchableOpacity
                      key={color.name}
                      style={[
                        styles.colorChip,
                        {
                          backgroundColor: isSelected ? colors.tint : colors.card,
                          borderColor: isSelected ? colors.tint : colors.border,
                        },
                      ]}
                      onPress={() => toggleTempColor(color.name)}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${color.name} color`}
                      accessibilityState={{ checked: isSelected }}
                    >
                      <View
                        style={[
                          styles.colorChipDot,
                          { backgroundColor: color.hex, borderColor: color.border, borderWidth: color.name === "White" ? 1 : 0 },
                        ]}
                      />
                      <Text style={[styles.colorChipText, { color: isSelected ? colors.onTint : colors.text }]}>
                        {color.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Preset Price Ranges */}
            <View style={styles.filterSection}>
              <Text style={[styles.filterSectionTitle, { color: colors.text }]}>Price Preset Ranges</Text>
              <View style={styles.pricePresetsGrid}>
                {[
                  { id: "under1000", label: "Under ₱1,000" },
                  { id: "1000to2000", label: "₱1,000 - ₱2,000" },
                  { id: "2000to4000", label: "₱2,000 - ₱4,000" },
                  { id: "over4000", label: "₱4,000+" },
                ].map((preset) => {
                  const isSelected = tempPriceRange === preset.id;
                  return (
                    <TouchableOpacity
                      key={preset.id}
                      style={[
                        styles.pricePresetCard,
                        {
                          backgroundColor: isSelected ? colors.tint : colors.card,
                          borderColor: isSelected ? colors.tint : colors.border,
                        },
                      ]}
                      onPress={() => setTempPriceRange(isSelected ? null : preset.id)}
                      accessibilityRole="radio"
                      accessibilityLabel={preset.label}
                      accessibilityState={{ checked: isSelected }}
                    >
                      <Text style={[styles.pricePresetLabel, { color: isSelected ? colors.onTint : colors.text }]}>
                        {preset.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Custom Price Inputs */}
            <View style={styles.filterSection}>
              <Text style={[styles.filterSectionSubTitle, { color: colors.secondaryText }]}>Custom Price (₱)</Text>
              <View style={styles.customPriceInputs}>
                <TextInput keyboardAppearance={theme}
                  style={[styles.customPriceInput, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
                  placeholder="Min Price"
                  placeholderTextColor={colors.secondaryText}
                  accessibilityLabel="Minimum rental price in Philippine pesos"
                  keyboardType="numeric"
                  value={tempMinPrice}
                  onChangeText={setTempMinPrice}
                />
                <Text style={{ color: colors.text, marginHorizontal: Spacing.md }}>to</Text>
                <TextInput keyboardAppearance={theme}
                  style={[styles.customPriceInput, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
                  placeholder="Max Price"
                  placeholderTextColor={colors.secondaryText}
                  accessibilityLabel="Maximum rental price in Philippine pesos"
                  keyboardType="numeric"
                  value={tempMaxPrice}
                  onChangeText={setTempMaxPrice}
                />
              </View>
            </View>

            <View style={{ height: 40 }} />
          </BottomSheetScrollView>

          {/* Bottom Actions */}
          <View style={[styles.modalFooter, { borderTopColor: colors.border, paddingBottom: Platform.OS === "ios" ? 40 : 24 }]}>
            <TouchableOpacity
              style={[styles.footerButton, { backgroundColor: colors.tint }]}
              onPress={applyFilters}
              accessibilityRole="button"
              accessibilityLabel="Apply filters"
            >
              <Text style={[styles.footerApplyButtonText, { color: colors.onTint }]}>Apply Filters</Text>
            </TouchableOpacity>
          </View>
        </BottomSheetView>
      </BottomSheetModal>

      {/* SORT OPTIONS BOTTOM SHEET MODAL */}
      <BottomSheetModal
        ref={sortSheetRef}
        snapPoints={sortSnapPoints}
        backdropComponent={renderSheetBackdrop}
        backgroundStyle={{ backgroundColor: colors.background }}
        handleIndicatorStyle={{ backgroundColor: colors.border }}
      >
        <BottomSheetView style={{ flex: 1, paddingBottom: Platform.OS === 'ios' ? 40 : 24 }}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <Text accessibilityRole="header" style={[styles.modalTitle, { color: colors.text }]}>Sort Options</Text>
            <TouchableOpacity
              onPress={() => sortSheetRef.current?.dismiss()}
              accessibilityRole="button"
              accessibilityLabel="Close sort options"
              hitSlop={12}
            >
              <IconSymbol name="xmark" size={20} color={colors.icon} />
            </TouchableOpacity>
          </View>

          {/* Sort Options List */}
          <View style={styles.sortListContainer}>
            {SORT_OPTIONS.map((option) => {
              const isSelected = selectedSort === option.id;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.sortOptionRow, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setSelectedSort(option.id);
                    sortSheetRef.current?.dismiss();
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: isSelected }}
                >
                  <Text style={[styles.sortOptionLabel, { color: isSelected ? colors.tint : colors.text, fontWeight: isSelected ? '700' : '500' }]}>
                    {option.label}
                  </Text>
                  {isSelected && (
                    <IconSymbol name="checkmark" size={18} color={colors.tint} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </BottomSheetView>
      </BottomSheetModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flexOne: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  searchBarWrapper: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderRadius: 22,
    paddingHorizontal: Spacing.lg,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: '100%',
    padding: 0,
  },
  cancelButton: {
    paddingLeft: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '500',
  },
  cartBtn: {
    marginLeft: Spacing.md,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xs,
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  cartBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '700',
  },
  breadcrumbWrapper: {
    paddingHorizontal: GRID_GUTTER,
    paddingVertical: 10,
    // The border is invisible but load-bearing: its 1pt still occupies layout,
    // so the width stays and only the dead colour declaration goes.
    borderBottomWidth: 1,
  },
  breadcrumbsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  breadcrumbText: {
    ...Type.body,
  },
  breadcrumbSeparator: {
    ...Type.body,
  },
  scrollContent: {
    // Feeds gridCardWidth via GRID_GUTTER; changing it resizes the cards to match.
    paddingHorizontal: GRID_GUTTER,
    paddingBottom: 120,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  shopAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 52,
    borderRadius: 26,
    marginTop: Spacing.lg,
  },
  shopAllButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  sectionTitle: {
    ...Type.subtitle,
    marginBottom: Spacing.lg,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    // rowGap only. A horizontal `gap` is added on top of the two 48% cards, so
    // 96% + 12px overflowed the row on narrower phones and every card wrapped
    // onto its own line -- the two-column grid silently became one column.
    rowGap: GRID_COLUMN_GAP,
  },
  suggestionsContainer: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
  },
  tagIcon: {
    marginRight: 6,
  },
  tagText: {
    fontSize: 14,
    fontWeight: '500',
  },
  gridHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  resultsCountText: {
    fontSize: 13,
    fontWeight: '500',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  filterTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  filterTriggerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  badge: {
    width: 16,
    height: 16,
    borderRadius: Radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  activeFiltersWrapper: {
    paddingBottom: 10,
  },
  activeFiltersScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  clearAllTag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  clearAllTagText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filterTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  filterTagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  filterTagClose: {
    marginLeft: 2,
  },
  productList: {
    // This and productRow together must sum to GRID_GUTTER per side, which is
    // the inset gridCardWidth assumes. Split across two containers because the
    // FlatList pads the page and the row pads between columns.
    paddingHorizontal: GRID_GUTTER - PRODUCT_ROW_INSET,
    paddingBottom: 120,
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: PRODUCT_ROW_INSET,
  },
  sizingNudge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    // Both this card's border and the Shop All button above it are drawn in
    // colors.tint; with no gap the two tinted edges meet and read as one
    // overlapping element.
    marginTop: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  sizingNudgeTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  sizingNudgeBody: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: Spacing.sm,
  },
  sizingNudgeAction: {
    fontSize: 13,
    fontWeight: '700',
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  loadMoreFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  keyboardAvoidingView: {
    width: '100%',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: SCREEN_HEIGHT * 0.85,
  },
  dragHandle: {
    width: 40,
    height: 5,
    borderRadius: 2.5,
    alignSelf: 'center',
    marginVertical: Spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  clearAllText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalScroll: {
    paddingHorizontal: Spacing.xl,
  },
  filterSection: {
    marginBottom: Spacing.xl,
  },
  filterSectionTitle: {
    ...Type.bodyLargeStrong,
    marginBottom: Spacing.md,
  },
  filterSectionSubTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: Spacing.sm,
  },
  filterOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  chipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    // 12 rather than 8 so the chip clears 44pt without hitSlop, which would
    // have overlapped the neighbouring chip across the row's 8pt gap.
    paddingVertical: Spacing.md,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sizeChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 48,
    alignItems: 'center',
  },
  sizeChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  colorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  colorChipDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  colorChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  pricePresetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  pricePresetCard: {
    width: '48%',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  pricePresetLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  customPriceInputs: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  customPriceInput: {
    flex: 1,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    fontSize: 14,
  },
  modalFooter: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    borderTopWidth: 1,
  },
  footerButton: {
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerApplyButtonText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sortListContainer: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
  },
  sortOptionLabel: {
    fontSize: 15,
  },
  quickFiltersWrapper: {
    borderBottomWidth: 1,
    paddingVertical: Spacing.sm,
  },
  quickFiltersScroll: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xs,
  },
  quickFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  quickFilterChipText: {
    fontSize: 12,
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: Spacing.xl,
  },
  errorContainerSmall: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: Spacing.sm,
  },
  errorIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: Spacing.xs,
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.lg,
    maxWidth: 300,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    marginBottom: Spacing.md,
  },
  retryButtonSmall: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryActionButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  secondaryActionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingBottom: Spacing.xl,
  },
  clearFiltersButton: {
    marginTop: Spacing.md,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  clearFiltersButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
});










