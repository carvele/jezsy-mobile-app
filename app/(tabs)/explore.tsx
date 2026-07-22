import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Image } from 'expo-image';
import { Link, useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/src/lib/supabase';
import { Database } from '@/src/types/database.types';
import { useCart } from '@/src/context/CartContext';
import { CATEGORY_SELECT, getCategoryLabel, WithCategoryEmbed } from '@/src/utils/categoryDisplay';

type Product = Database['public']['Tables']['products']['Row'] & WithCategoryEmbed;
const PRODUCT_SELECT = `*, ${CATEGORY_SELECT}`;

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
const FILTER_COLORS = [
  { name: 'Black', hex: '#000000', border: 'transparent' },
  { name: 'White', hex: '#FFFFFF', border: '#D1D5DB' },
  { name: 'Blue', hex: '#2563EB', border: 'transparent' },
  { name: 'Red', hex: '#DC2626', border: 'transparent' },
  { name: 'Grey', hex: '#4B5563', border: 'transparent' },
];
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

export default function ExploreScreen() {
  const theme = useColorScheme() ?? 'dark';
  const colors = Colors[theme];
  const { itemCount } = useCart();
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

  // Products Loading State
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchCategories = async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('sort_order', { ascending: true });
      if (data && !error) {
        const tops = data.filter(c => !c.parent_id);
        setTopCategories(tops);
        const hierarchy: Record<string, Category[]> = {};
        tops.forEach(top => {
          hierarchy[top.name] = data.filter(c => c.parent_id === top.id);
        });
        setSubCategoriesByParent(hierarchy);
      }
    };
    fetchCategories();
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
  const [selectedFits, setSelectedFits] = useState<string[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);

  // Sorting State
  const [selectedSort, setSelectedSort] = useState<string>('recommended');
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);

  // Temp Filter States (Within Modal)
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [tempSizes, setTempSizes] = useState<string[]>([]);
  const [tempColors, setTempColors] = useState<string[]>([]);
  const [tempPriceRange, setTempPriceRange] = useState<string | null>(null);
  const [tempMinPrice, setTempMinPrice] = useState('');
  const [tempMaxPrice, setTempMaxPrice] = useState('');
  const [tempNewArrivalsOnly, setTempNewArrivalsOnly] = useState(false);
  const [tempSaleOnly, setTempSaleOnly] = useState(false);
  const [tempArOnly, setTempArOnly] = useState(false);
  const [tempFits, setTempFits] = useState<string[]>([]);
  const [tempMaterials, setTempMaterials] = useState<string[]>([]);

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

  // Fetch search results from Supabase
  const fetchSearchResults = async (text: string) => {
    if (!text.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      // Matches by product name directly, or by category/subcategory name
      // via the FK (a match on a main category, e.g. "dress", expands to
      // every subcategory under it — broader and more useful than the old
      // text-column match, which only ever compared against products'
      // own denormalized copy of the category name).
      const matchingCategoryIds = subCategoryIdsMatching(text);
      let orClause = `name.ilike.%${text}%`;
      if (matchingCategoryIds.length > 0) {
        orClause += `,category_id.in.(${matchingCategoryIds.join(',')})`;
      }

      const { data, error } = await supabase
        .from('products')
        .select(PRODUCT_SELECT)
        .eq('deleted', false)
        .eq('visibility', 'public')
        .or(orClause);

      if (error) {
        console.error('Error fetching search results:', error);
      } else if (data) {
        setSearchResults(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Trigger search on query change
  useEffect(() => {
    if (isSearchActive) {
      fetchSearchResults(searchQuery);
    }
  }, [searchQuery, isSearchActive]);

  // Fetch products when subcategory is selected
  useEffect(() => {
    const fetchProductsForCategory = async () => {
      if (!selectedCategory || !selectedSubCategory) return;
      setLoading(true);
      try {
        let query = supabase
          .from('products')
          .select(PRODUCT_SELECT)
          .eq('deleted', false)
          .eq('visibility', 'public');

        if (selectedSubCategory === 'View All') {
          // category_id always points at a subcategory row, so "every
          // product in this main category" means "in any of its subs".
          const subIds = (subCategoriesByParent[selectedCategory] || []).map((s) => s.id);
          query = query.in('category_id', subIds);
        } else {
          const subId = subCategoryIdByName[selectedSubCategory];
          if (!subId) { setProducts([]); setLoading(false); return; }
          query = query.eq('category_id', subId);
        }

        const { data, error } = await query;
        if (error) {
          console.error('Error fetching products:', error);
        } else if (data) {
          setProducts(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchProductsForCategory();
  }, [selectedCategory, selectedSubCategory]);

  // Fetch every active product for "Shop All" mode.
  useEffect(() => {
    if (!showAllProducts) return;
    const fetchAllProducts = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('products')
          .select(PRODUCT_SELECT)
          .eq('deleted', false)
          .eq('visibility', 'public')
          .order('created_at', { ascending: false });
        if (error) {
          console.error('Error fetching all products:', error);
        } else if (data) {
          setProducts(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchAllProducts();
  }, [showAllProducts]);

  // Real-Time Client-Side Filtering
  const filteredProducts = useMemo(() => {
    const listToFilter = isSearchActive ? searchResults : products;

    return listToFilter.filter((product) => {
      // 1. Size filter
      if (selectedSizes.length > 0) {
        const productSizes = product.sizes || [];
        const hasSize = selectedSizes.some((size) => productSizes.includes(size));
        if (!hasSize) return false;
      }

      // 2. Color filter
      if (selectedColors.length > 0) {
        const productColor = (product.color || '').trim().toLowerCase();
        const hasColor = selectedColors.some((color) => color.toLowerCase() === productColor);
        if (!hasColor) return false;
      }

      // 3. Price Filter (Effective Price)
      const price = product.on_sale && product.sale_price ? product.sale_price : (product.price || 0);

      // Preset Price Range
      if (selectedPriceRange) {
        if (selectedPriceRange === 'under1000' && price >= 1000) return false;
        if (selectedPriceRange === '1000to2000' && (price < 1000 || price > 2000)) return false;
        if (selectedPriceRange === '2000to4000' && (price < 2000 || price > 4000)) return false;
        if (selectedPriceRange === 'over4000' && price <= 4000) return false;
      }

      // Custom Price Range
      if (customMinPrice) {
        const minPrice = parseFloat(customMinPrice);
        if (!isNaN(minPrice) && price < minPrice) return false;
      }
      if (customMaxPrice) {
        const maxPrice = parseFloat(customMaxPrice);
        if (!isNaN(maxPrice) && price > maxPrice) return false;
      }

      // 4. New Arrivals Filter
      if (selectedNewArrivalsOnly && !product.is_new_arrival) {
        return false;
      }

      // 5. On Sale Filter
      if (selectedSaleOnly && !product.on_sale) {
        return false;
      }

      // 5.5 AR Filter
      if (selectedArOnly && !product.model_3d_url) {
        return false;
      }

      // 6. Fit / Cut Filter
      if (selectedFits.length > 0) {
        const productFit = (product.fit_and_sizing || '').trim().toLowerCase();
        const hasFit = selectedFits.some((fit) => productFit.includes(fit.toLowerCase()));
        if (!hasFit) return false;
      }

      // 7. Material Filter
      if (selectedMaterials.length > 0) {
        const productMat = (product.material || '').trim().toLowerCase();
        const hasMat = selectedMaterials.some((mat) => productMat.includes(mat.toLowerCase()));
        if (!hasMat) return false;
      }

      return true;
    });
  }, [
    products,
    searchResults,
    isSearchActive,
    selectedSizes,
    selectedColors,
    selectedPriceRange,
    customMinPrice,
    customMaxPrice,
    selectedNewArrivalsOnly,
    selectedSaleOnly,
    selectedArOnly,
    selectedFits,
    selectedMaterials,
  ]);

  // Real-Time Client-Side Sorting
  const processedProducts = useMemo(() => {
    const result = [...filteredProducts];

    if (selectedSort === 'newest') {
      result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (selectedSort === 'priceAsc') {
      const getPrice = (p: Product) => p.on_sale && p.sale_price ? p.sale_price : (p.price || 0);
      result.sort((a, b) => getPrice(a) - getPrice(b));
    } else if (selectedSort === 'priceDesc') {
      const getPrice = (p: Product) => p.on_sale && p.sale_price ? p.sale_price : (p.price || 0);
      result.sort((a, b) => getPrice(b) - getPrice(a));
    } else if (selectedSort === 'rating') {
      result.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (selectedSort === 'popular') {
      result.sort((a, b) => (b.review_count || 0) - (a.review_count || 0));
    }

    return result;
  }, [filteredProducts, selectedSort]);

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
    setTempFits(selectedFits);
    setTempMaterials(selectedMaterials);
    setIsFilterModalOpen(true);
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
    setSelectedFits(tempFits);
    setSelectedMaterials(tempMaterials);
    setIsFilterModalOpen(false);
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
    setTempFits([]);
    setTempMaterials([]);
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
    setSelectedFits([]);
    setSelectedMaterials([]);
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

  const removeSizeFilter = (size: string) => {
    setSelectedSizes((prev) => prev.filter((s) => s !== size));
  };

  const removeColorFilter = (color: string) => {
    setSelectedColors((prev) => prev.filter((c) => c !== color));
  };

  const removeFitFilter = (fit: string) => {
    setSelectedFits((prev) => prev.filter((f) => f !== fit));
  };

  const removeMaterialFilter = (material: string) => {
    setSelectedMaterials((prev) => prev.filter((m) => m !== material));
  };

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

  // Render Single Product Item (minimalist catalog card)
  const renderProductItem = useCallback(({ item }: { item: Product }) => (
    <Link href={`/product/${item.id}`} asChild>
      <TouchableOpacity
        style={styles.productCard}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ₱${(item.on_sale && item.sale_price ? item.sale_price : item.price || 0).toLocaleString()}${item.is_new_arrival ? ', new arrival' : ''}${item.on_sale ? ', on sale' : ''}${item.model_3d_url ? ', available in AR' : ''}`}
        accessibilityHint="Opens product details"
      >
        <View style={styles.imageContainer}>
          <Image
            source={item.image_url ? { uri: item.image_url } : require('@/assets/images/partial-react-logo.png')}
            style={styles.productImage}
            contentFit="cover"
          />
          {item.is_new_arrival && (
            <View style={[styles.productBadge, { backgroundColor: colors.tint, left: 8, top: 8 }]}>
              <Text style={styles.productBadgeText}>NEW</Text>
            </View>
          )}
          {item.model_3d_url && (
            <View style={[styles.productBadge, { backgroundColor: 'rgba(201,169,110,0.9)', left: 8, top: item.is_new_arrival ? 32 : 8, flexDirection: 'row', alignItems: 'center', gap: 2 }]}>
              <IconSymbol name="cube.transparent" size={10} color="#0D0D0D" />
              <Text style={styles.productBadgeText}>AR</Text>
            </View>
          )}
          {item.on_sale && (
            <View style={[styles.productBadge, { backgroundColor: colors.notification, right: 8, top: 8 }]}>
              <Text style={styles.productBadgeText}>SALE</Text>
            </View>
          )}
        </View>
        <View style={styles.productInfo}>
          <Text style={[styles.productCategory, { color: colors.secondaryText }]}>
            {getCategoryLabel(item, 'COLLECTION').toUpperCase()}
          </Text>
          <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          {item.on_sale && item.sale_price ? (
            <View style={styles.priceRow}>
              <Text style={[styles.productPrice, { color: colors.notification }]}>
                ₱{item.sale_price.toLocaleString()}
              </Text>
              <Text style={[styles.originalPriceText, { color: colors.secondaryText }]}>
                ₱{(item.price || 0).toLocaleString()}
              </Text>
            </View>
          ) : (
            <Text style={[styles.productPrice, { color: colors.text }]}>
              ₱{(item.price || 0).toLocaleString()}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    </Link>
  ), [colors]);

  const activeFiltersCount =
    selectedSizes.length +
    selectedColors.length +
    (selectedPriceRange ? 1 : 0) +
    (customMinPrice || customMaxPrice ? 1 : 0) +
    (selectedNewArrivalsOnly ? 1 : 0) +
    (selectedSaleOnly ? 1 : 0) +
    (selectedArOnly ? 1 : 0) +
    selectedFits.length +
    selectedMaterials.length;

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
            <TextInput
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
              <Text style={[styles.sectionTitle, { color: colors.text, marginTop: 12 }]}>Suggested Searches</Text>
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
              <FlatList
                data={processedProducts}
                renderItem={renderProductItem}
                keyExtractor={(item) => item.id}
                numColumns={2}
                contentContainerStyle={styles.productList}
                columnWrapperStyle={styles.productRow}
                initialNumToRender={6}
                maxToRenderPerBatch={4}
                windowSize={5}
                removeClippedSubviews={true}
                ListHeaderComponent={
                  <View style={{ backgroundColor: colors.background }}>
                    {/* Sticky Controls Panel */}
                    <View style={[styles.gridHeader, { backgroundColor: colors.background, borderBottomWidth: activeFiltersCount > 0 ? 0 : 1, borderBottomColor: colors.border }]}>
                      <Text style={[styles.resultsCountText, { color: colors.secondaryText }]}>
                        {processedProducts.length} results found for &quot;{searchQuery}&quot;
                      </Text>
                      <View style={styles.controlsRow}>
                        <TouchableOpacity
                          style={[styles.filterTrigger, { backgroundColor: colors.card, borderColor: colors.border }]}
                          onPress={openFilterModal}
                          accessibilityRole="button"
                          accessibilityLabel={activeFiltersCount > 0 ? `Filters, ${activeFiltersCount} active` : 'Open filters'}
                        >
                          <IconSymbol name="slider.horizontal.3" size={14} color={colors.tint} />
                          <Text style={[styles.filterTriggerText, { color: colors.text }]}>Filter</Text>
                          {activeFiltersCount > 0 && (
                            <View style={[styles.badge, { backgroundColor: colors.tint }]}>
                              <Text style={styles.badgeText}>{activeFiltersCount}</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.filterTrigger, { backgroundColor: colors.card, borderColor: colors.border }]}
                          onPress={() => setIsSortModalOpen(true)}
                          accessibilityRole="button"
                          accessibilityLabel="Open sort options"
                        >
                          <IconSymbol name="arrow.up.arrow.down" size={14} color={colors.tint} />
                          <Text style={[styles.filterTriggerText, { color: colors.text }]}>Sort</Text>
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
                          {selectedNewArrivalsOnly && (
                            <View style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.filterTagText, { color: colors.text }]}>New Arrivals</Text>
                              <TouchableOpacity onPress={() => setSelectedNewArrivalsOnly(false)} accessibilityRole="button" accessibilityLabel="Remove New Arrivals filter">
                                <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                              </TouchableOpacity>
                            </View>
                          )}
                          {selectedSaleOnly && (
                            <View style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.filterTagText, { color: colors.text }]}>On Sale</Text>
                              <TouchableOpacity onPress={() => setSelectedSaleOnly(false)} accessibilityRole="button" accessibilityLabel="Remove On Sale filter">
                                <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                              </TouchableOpacity>
                            </View>
                          )}
                          {selectedArOnly && (
                            <View style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.filterTagText, { color: colors.text }]}>Try in AR</Text>
                              <TouchableOpacity onPress={() => setSelectedArOnly(false)} accessibilityRole="button" accessibilityLabel="Remove Try in AR filter">
                                <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                              </TouchableOpacity>
                            </View>
                          )}
                          {selectedSizes.map(size => (
                            <View key={`size-${size}`} style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.filterTagText, { color: colors.text }]}>Size: {size}</Text>
                              <TouchableOpacity onPress={() => removeSizeFilter(size)} accessibilityRole="button" accessibilityLabel={`Remove Size ${size} filter`}>
                                <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                              </TouchableOpacity>
                            </View>
                          ))}
                          {selectedColors.map(color => (
                            <View key={`color-${color}`} style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.filterTagText, { color: colors.text }]}>Color: {color}</Text>
                              <TouchableOpacity onPress={() => removeColorFilter(color)} accessibilityRole="button" accessibilityLabel={`Remove Color ${color} filter`}>
                                <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                              </TouchableOpacity>
                            </View>
                          ))}
                          {selectedFits.map(fit => (
                            <View key={`fit-${fit}`} style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.filterTagText, { color: colors.text }]}>Fit: {fit}</Text>
                              <TouchableOpacity onPress={() => removeFitFilter(fit)} accessibilityRole="button" accessibilityLabel={`Remove Fit ${fit} filter`}>
                                <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                              </TouchableOpacity>
                            </View>
                          ))}
                          {selectedMaterials.map(mat => (
                            <View key={`material-${mat}`} style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.filterTagText, { color: colors.text }]}>Material: {mat}</Text>
                              <TouchableOpacity onPress={() => removeMaterialFilter(mat)} accessibilityRole="button" accessibilityLabel={`Remove Material ${mat} filter`}>
                                <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                              </TouchableOpacity>
                            </View>
                          ))}
                          {selectedPriceRange && (
                            <View style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.filterTagText, { color: colors.text }]}>
                                Price: {selectedPriceRange === 'under1000' ? 'Under ₱1k' : selectedPriceRange === '1000to2000' ? '₱1k - ₱2k' : selectedPriceRange === '2000to4000' ? '₱2k - ₱4k' : '₱4k+'}
                              </Text>
                              <TouchableOpacity onPress={() => setSelectedPriceRange(null)} accessibilityRole="button" accessibilityLabel="Remove price range filter">
                                <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                              </TouchableOpacity>
                            </View>
                          )}
                          {(customMinPrice || customMaxPrice) && (
                            <View style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                              <Text style={[styles.filterTagText, { color: colors.text }]}>
                                Price: ₱{customMinPrice || '0'}-₱{customMaxPrice || '∞'}
                              </Text>
                              <TouchableOpacity onPress={() => { setCustomMinPrice(''); setCustomMaxPrice(''); }} accessibilityRole="button" accessibilityLabel="Remove custom price filter">
                                <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                              </TouchableOpacity>
                            </View>
                          )}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                }
                ListEmptyComponent={
                  <View style={styles.centerContainer}>
                    <IconSymbol name="bag.fill" size={48} color={colors.icon} />
                    <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No products match your search or filters.</Text>
                  </View>
                }
                stickyHeaderIndices={[0]}
              />
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
                <IconSymbol name="bag.fill" size={18} color="#0D0D0D" />
                <Text style={styles.shopAllButtonText}>Shop All Products</Text>
              </TouchableOpacity>

              <Text style={[styles.welcomeTitle, { color: colors.text }]}>Categories</Text>
              <View style={styles.categoriesGrid}>
                {topCategories.map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.categoryCard, { backgroundColor: colors.card }]}
                    onPress={() => setSelectedCategory(cat.name)}
                    accessibilityRole="button"
                    accessibilityLabel={`Browse ${cat.name}`}
                  >
                    <Image
                      source={cat.image_url ? { uri: cat.image_url } : require('@/assets/images/partial-react-logo.png')}
                      style={styles.categoryImage}
                      contentFit="cover"
                    />
                    <View style={[styles.categoryOverlay, { backgroundColor: 'rgba(0,0,0,0.35)' }]}>
                      <Text style={[styles.categoryName, { color: '#E8D5B7' }]}>{cat.name}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}

          {/* Level 1: Sub-Categories View in a 2-Column Grid Layout */}
          {selectedCategory && !selectedSubCategory && (
            <ScrollView contentContainerStyle={styles.scrollContent}>
              <Text style={[styles.welcomeTitle, { color: colors.text }]}>Shop {selectedCategory}</Text>
              <View style={styles.categoriesGrid}>
                {/* View All option */}
                <TouchableOpacity
                  style={[styles.categoryCard, { backgroundColor: colors.card }]}
                  onPress={() => setSelectedSubCategory('View All')}
                  accessibilityRole="button"
                  accessibilityLabel={`Browse all ${selectedCategory}`}
                >
                  <Image
                    source={
                      topCategories.find((c) => c.name === selectedCategory)?.image_url
                        ? { uri: topCategories.find((c) => c.name === selectedCategory)!.image_url! }
                        : require('@/assets/images/partial-react-logo.png')
                    }
                    style={styles.categoryImage}
                    contentFit="cover"
                  />
                  <View style={[styles.categoryOverlay, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                    <Text style={[styles.categoryName, { color: '#E8D5B7' }]}>View All</Text>
                  </View>
                </TouchableOpacity>

                {/* Specific Subcategories */}
                {(subCategoriesByParent[selectedCategory] || []).map((subcat) => (
                  <TouchableOpacity
                    key={subcat.id}
                    style={[styles.categoryCard, { backgroundColor: colors.card }]}
                    onPress={() => setSelectedSubCategory(subcat.name)}
                    accessibilityRole="button"
                    accessibilityLabel={`Browse ${subcat.name}`}
                  >
                    <Image
                      source={subcat.image_url ? { uri: subcat.image_url } : require('@/assets/images/partial-react-logo.png')}
                      style={styles.categoryImage}
                      contentFit="cover"
                    />
                    <View style={[styles.categoryOverlay, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                      <Text style={[styles.categoryName, { color: '#E8D5B7', fontSize: 14, textAlign: 'center', paddingHorizontal: 8 }]}>{subcat.name}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )}

          {/* Level 2: Products Grid View (also used by "Shop All") */}
          {((selectedCategory && selectedSubCategory) || showAllProducts) && (
            <View style={styles.flexOne}>
              {loading ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : (
                <FlatList
                  data={processedProducts}
                  renderItem={renderProductItem}
                  keyExtractor={(item) => item.id}
                  numColumns={2}
                  contentContainerStyle={styles.productList}
                  columnWrapperStyle={styles.productRow}
                  initialNumToRender={6}
                  maxToRenderPerBatch={4}
                  windowSize={5}
                  removeClippedSubviews={true}
                  ListHeaderComponent={
                    <View style={{ backgroundColor: colors.background }}>
                      {/* Sticky Controls Panel */}
                      <View style={[styles.gridHeader, { backgroundColor: colors.background, borderBottomWidth: activeFiltersCount > 0 ? 0 : 1, borderBottomColor: colors.border }]}>
                        <Text style={[styles.resultsCountText, { color: colors.secondaryText }]}>
                          {processedProducts.length} items found
                        </Text>
                        <View style={styles.controlsRow}>
                          <TouchableOpacity
                            style={[styles.filterTrigger, { backgroundColor: colors.card, borderColor: colors.border }]}
                            onPress={openFilterModal}
                            accessibilityRole="button"
                            accessibilityLabel={activeFiltersCount > 0 ? `Filters, ${activeFiltersCount} active` : 'Open filters'}
                          >
                            <IconSymbol name="slider.horizontal.3" size={14} color={colors.tint} />
                            <Text style={[styles.filterTriggerText, { color: colors.text }]}>Filter</Text>
                            {activeFiltersCount > 0 && (
                              <View style={[styles.badge, { backgroundColor: colors.tint }]}>
                                <Text style={styles.badgeText}>{activeFiltersCount}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.filterTrigger, { backgroundColor: colors.card, borderColor: colors.border }]}
                            onPress={() => setIsSortModalOpen(true)}
                            accessibilityRole="button"
                            accessibilityLabel={`Sort by ${SORT_OPTIONS.find(o => o.id === selectedSort)?.label}`}
                          >
                            <IconSymbol name="arrow.up.arrow.down" size={14} color={colors.tint} />
                            <Text style={[styles.filterTriggerText, { color: colors.text }]}>
                              Sort: {SORT_OPTIONS.find(o => o.id === selectedSort)?.label}
                            </Text>
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
                            {selectedNewArrivalsOnly && (
                              <View style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[styles.filterTagText, { color: colors.text }]}>New Arrivals</Text>
                                <TouchableOpacity onPress={() => setSelectedNewArrivalsOnly(false)} accessibilityRole="button" accessibilityLabel="Remove New Arrivals filter">
                                  <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                                </TouchableOpacity>
                              </View>
                            )}
                            {selectedSaleOnly && (
                              <View style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[styles.filterTagText, { color: colors.text }]}>On Sale</Text>
                                <TouchableOpacity onPress={() => setSelectedSaleOnly(false)} accessibilityRole="button" accessibilityLabel="Remove On Sale filter">
                                  <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                                </TouchableOpacity>
                              </View>
                            )}
                            {selectedArOnly && (
                              <View style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[styles.filterTagText, { color: colors.text }]}>Try in AR</Text>
                                <TouchableOpacity onPress={() => setSelectedArOnly(false)} accessibilityRole="button" accessibilityLabel="Remove Try in AR filter">
                                  <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                                </TouchableOpacity>
                              </View>
                            )}
                            {selectedSizes.map(size => (
                              <View key={`size-${size}`} style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[styles.filterTagText, { color: colors.text }]}>Size: {size}</Text>
                                <TouchableOpacity onPress={() => removeSizeFilter(size)} accessibilityRole="button" accessibilityLabel={`Remove Size ${size} filter`}>
                                  <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                                </TouchableOpacity>
                              </View>
                            ))}
                            {selectedColors.map(color => (
                              <View key={`color-${color}`} style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[styles.filterTagText, { color: colors.text }]}>Color: {color}</Text>
                                <TouchableOpacity onPress={() => removeColorFilter(color)} accessibilityRole="button" accessibilityLabel={`Remove Color ${color} filter`}>
                                  <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                                </TouchableOpacity>
                              </View>
                            ))}
                            {selectedFits.map(fit => (
                              <View key={`fit-${fit}`} style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[styles.filterTagText, { color: colors.text }]}>Fit: {fit}</Text>
                                <TouchableOpacity onPress={() => removeFitFilter(fit)} accessibilityRole="button" accessibilityLabel={`Remove Fit ${fit} filter`}>
                                  <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                                </TouchableOpacity>
                              </View>
                            ))}
                            {selectedMaterials.map(mat => (
                              <View key={`material-${mat}`} style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[styles.filterTagText, { color: colors.text }]}>Material: {mat}</Text>
                                <TouchableOpacity onPress={() => removeMaterialFilter(mat)} accessibilityRole="button" accessibilityLabel={`Remove Material ${mat} filter`}>
                                  <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                                </TouchableOpacity>
                              </View>
                            ))}
                            {selectedPriceRange && (
                              <View style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[styles.filterTagText, { color: colors.text }]}>
                                  Price: {selectedPriceRange === 'under1000' ? 'Under ₱1k' : selectedPriceRange === '1000to2000' ? '₱1k - ₱2k' : selectedPriceRange === '2000to4000' ? '₱2k - ₱4k' : '₱4k+'}
                                </Text>
                                <TouchableOpacity onPress={() => setSelectedPriceRange(null)} accessibilityRole="button" accessibilityLabel="Remove price range filter">
                                  <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                                </TouchableOpacity>
                              </View>
                            )}
                            {(customMinPrice || customMaxPrice) && (
                              <View style={[styles.filterTag, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Text style={[styles.filterTagText, { color: colors.text }]}>
                                  Price: ₱{customMinPrice || '0'}-₱{customMaxPrice || '∞'}
                                </Text>
                                <TouchableOpacity onPress={() => { setCustomMinPrice(''); setCustomMaxPrice(''); }} accessibilityRole="button" accessibilityLabel="Remove custom price filter">
                                  <IconSymbol name="xmark" size={12} color={colors.secondaryText} style={styles.filterTagClose} />
                                </TouchableOpacity>
                              </View>
                            )}
                          </ScrollView>
                        </View>
                      )}
                    </View>
                  }
                  ListEmptyComponent={
                    <View style={styles.centerContainer}>
                      <IconSymbol name="bag.fill" size={48} color={colors.icon} />
                      <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No products found matching filters.</Text>
                    </View>
                  }
                  stickyHeaderIndices={[0]}
                />
              )}
            </View>
          )}
        </View>
      )}


      {/* FILTER BOTTOM SHEET MODAL */}
      <Modal
        visible={isFilterModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsFilterModalOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsFilterModalOpen(false)}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.keyboardAvoidingView}
          >
            <Pressable style={[styles.modalContent, { backgroundColor: colors.background }]} onPress={(e) => e.stopPropagation()}>
              {/* Drag Handle */}
              <View style={[styles.dragHandle, { backgroundColor: colors.border }]} />

              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Refine Results</Text>
                <TouchableOpacity onPress={clearAllFilters}>
                  <Text style={[styles.clearAllText, { color: colors.notification }]}>Clear All</Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalScroll}>
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
                    >
                      <IconSymbol name="flame.fill" size={14} color={tempNewArrivalsOnly ? '#0D0D0D' : colors.tint} style={{ marginRight: 6 }} />
                      <Text style={[styles.chipButtonText, { color: tempNewArrivalsOnly ? '#0D0D0D' : colors.text }]}>New Arrivals</Text>
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
                    >
                      <IconSymbol name="tag.fill" size={14} color={tempSaleOnly ? '#0D0D0D' : colors.notification} style={{ marginRight: 6 }} />
                      <Text style={[styles.chipButtonText, { color: tempSaleOnly ? '#0D0D0D' : colors.text }]}>On Sale</Text>
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
                    >
                      <IconSymbol name="cube.transparent" size={14} color={tempArOnly ? '#0D0D0D' : colors.tint} style={{ marginRight: 6 }} />
                      <Text style={[styles.chipButtonText, { color: tempArOnly ? '#0D0D0D' : colors.text }]}>Try in AR</Text>
                    </TouchableOpacity>
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
                        >
                          <Text style={[styles.sizeChipText, { color: isSelected ? '#0D0D0D' : colors.text }]}>
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
                        >
                          <Text style={[styles.sizeChipText, { color: isSelected ? '#0D0D0D' : colors.text }]}>
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
                        >
                          <Text style={[styles.sizeChipText, { color: isSelected ? '#0D0D0D' : colors.text }]}>
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
                    {FILTER_COLORS.map((color) => {
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
                        >
                          <View
                            style={[
                              styles.colorChipDot,
                              { backgroundColor: color.hex, borderColor: color.border, borderWidth: color.name === 'White' ? 1 : 0 },
                            ]}
                          />
                          <Text style={[styles.colorChipText, { color: isSelected ? '#0D0D0D' : colors.text }]}>
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
                      { id: 'under1000', label: 'Under ₱1,000' },
                      { id: '1000to2000', label: '₱1,000 - ₱2,000' },
                      { id: '2000to4000', label: '₱2,000 - ₱4,000' },
                      { id: 'over4000', label: '₱4,000+' },
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
                        >
                          <Text style={[styles.pricePresetLabel, { color: isSelected ? '#0D0D0D' : colors.text }]}>
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
                    <TextInput
                      style={[styles.customPriceInput, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
                      placeholder="Min Price"
                      placeholderTextColor={colors.secondaryText}
                      keyboardType="numeric"
                      value={tempMinPrice}
                      onChangeText={setTempMinPrice}
                    />
                    <Text style={{ color: colors.text, marginHorizontal: 12 }}>to</Text>
                    <TextInput
                      style={[styles.customPriceInput, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
                      placeholder="Max Price"
                      placeholderTextColor={colors.secondaryText}
                      keyboardType="numeric"
                      value={tempMaxPrice}
                      onChangeText={setTempMaxPrice}
                    />
                  </View>
                </View>

                <View style={{ height: 40 }} />
              </ScrollView>

              {/* Bottom Actions */}
              <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
                <TouchableOpacity
                  style={[styles.footerButton, { backgroundColor: colors.tint }]}
                  onPress={applyFilters}
                >
                  <Text style={styles.footerApplyButtonText}>Apply Filters</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      {/* SORT OPTIONS BOTTOM SHEET MODAL */}
      <Modal
        visible={isSortModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsSortModalOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsSortModalOpen(false)}>
          <View style={[styles.modalContent, { backgroundColor: colors.background, paddingBottom: Platform.OS === 'ios' ? 40 : 24 }]}>
            {/* Drag Handle */}
            <View style={[styles.dragHandle, { backgroundColor: colors.border }]} />

            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Sort Options</Text>
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
                      setIsSortModalOpen(false);
                    }}
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
          </View>
        </Pressable>
      </Modal>
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
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
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
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: '100%',
    padding: 0,
  },
  cancelButton: {
    paddingLeft: 8,
    paddingVertical: 8,
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '500',
  },
  cartBtn: {
    marginLeft: 12,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 4,
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
    paddingHorizontal: 4,
  },
  cartBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  breadcrumbWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent',
  },
  breadcrumbsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  breadcrumbText: {
    fontSize: 14,
    letterSpacing: 0.2,
  },
  breadcrumbSeparator: {
    fontSize: 14,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 20,
  },
  shopAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: 26,
    marginTop: 16,
  },
  shopAllButtonText: {
    color: '#0D0D0D',
    fontSize: 15,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  categoryCard: {
    width: '48%',
    height: 160,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 12,
  },
  categoryImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  categoryOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryName: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  subCategoriesList: {
    gap: 12,
  },
  subCategoryRowImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  suggestionsContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  resultsCountText: {
    fontSize: 13,
    fontWeight: '500',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
  },
  filterTriggerText: {
    fontSize: 12,
    fontWeight: '600',
  },
  badge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0D0D0D',
  },
  activeFiltersWrapper: {
    paddingBottom: 10,
  },
  activeFiltersScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  clearAllTag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  clearAllTagText: {
    fontSize: 11,
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
    fontSize: 11,
    fontWeight: '600',
  },
  filterTagClose: {
    marginLeft: 2,
  },
  productList: {
    paddingHorizontal: 12,
    paddingBottom: 100,
  },
  productRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  productCard: {
    width: '48%',
    maxWidth: '48%',
    marginBottom: 20,
  },
  imageContainer: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 8,
    backgroundColor: '#2A2A2A',
    position: 'relative',
    overflow: 'hidden',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  productBadge: {
    position: 'absolute',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    zIndex: 1,
  },
  productBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0D0D0D',
  },
  productInfo: {
    paddingTop: 8,
    paddingHorizontal: 2,
    gap: 3,
  },
  productCategory: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  productName: {
    fontSize: 13,
    fontWeight: '500',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  productPrice: {
    fontSize: 13,
    fontWeight: '700',
  },
  originalPriceText: {
    fontSize: 11,
    textDecorationLine: 'line-through',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 40,
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
    marginVertical: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
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
    paddingHorizontal: 20,
  },
  filterSection: {
    marginBottom: 20,
  },
  filterSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  filterSectionSubTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  filterOptionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sizeChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
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
    paddingHorizontal: 12,
    paddingVertical: 8,
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
    gap: 8,
  },
  pricePresetCard: {
    width: '48%',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
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
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 14,
  },
  modalFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
  },
  footerButton: {
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerApplyButtonText: {
    color: '#0D0D0D',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sortListContainer: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  sortOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  sortOptionLabel: {
    fontSize: 15,
  },
});
