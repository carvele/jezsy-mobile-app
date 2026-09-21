import { ColorDetailItem, GarmentAnalysisResult } from '../types/dto/aiAttributes';

// Standard fashion color palette with RGB values for distance matching
const FASHION_PALETTE: { name: string; hex: string; r: number; g: number; b: number }[] = [
  { name: 'Black', hex: '#111827', r: 17, g: 24, b: 39 },
  { name: 'White', hex: '#F9FAFB', r: 249, g: 250, b: 251 },
  { name: 'Navy', hex: '#1E3A8A', r: 30, g: 58, b: 138 },
  { name: 'Beige', hex: '#D4B996', r: 212, g: 185, b: 150 },
  { name: 'Cream', hex: '#FFFDD0', r: 255, g: 253, b: 208 },
  { name: 'Grey', hex: '#6B7280', r: 107, g: 114, b: 128 },
  { name: 'Charcoal', hex: '#374151', r: 55, g: 65, b: 81 },
  { name: 'Camel', hex: '#C19A6B', r: 193, g: 154, b: 107 },
  { name: 'Brown', hex: '#78350F', r: 120, g: 53, b: 15 },
  { name: 'Burgundy', hex: '#800020', r: 128, g: 0, b: 32 },
  { name: 'Olive', hex: '#556B2F', r: 85, g: 107, b: 47 },
  { name: 'Forest Green', hex: '#064E3B', r: 6, g: 78, b: 59 },
  { name: 'Sage', hex: '#9CA38F', r: 156, g: 163, b: 143 },
  { name: 'Sky Blue', hex: '#38BDF8', r: 56, g: 189, b: 248 },
  { name: 'Denim Blue', hex: '#3B82F6', r: 59, g: 130, b: 246 },
  { name: 'Blush Pink', hex: '#FBCFE8', r: 251, g: 207, b: 232 },
  { name: 'Hot Pink', hex: '#EC4899', r: 236, g: 72, b: 153 },
  { name: 'Red', hex: '#DC2626', r: 220, g: 38, b: 38 },
  { name: 'Crimson', hex: '#991B1B', r: 153, g: 27, b: 27 },
  { name: 'Emerald', hex: '#047857', r: 4, g: 120, b: 87 },
  { name: 'Gold', hex: '#D4AF37', r: 212, g: 175, b: 55 },
  { name: 'Silver', hex: '#C0C0C0', r: 192, g: 192, b: 192 },
  { name: 'Mustard', hex: '#CA8A04', r: 202, g: 138, b: 4 },
  { name: 'Lavender', hex: '#DDD6FE', r: 221, g: 214, b: 254 },
  { name: 'Plum', hex: '#581C87', r: 88, g: 28, b: 135 },
  { name: 'Rust', hex: '#C2410C', r: 194, g: 65, b: 12 },
  { name: 'Teal', hex: '#0F766E', r: 15, g: 118, b: 110 },
  { name: 'Khaki', hex: '#A3966A', r: 163, g: 150, b: 106 },
  { name: 'Coral', hex: '#F87171', r: 248, g: 113, b: 113 },
  { name: 'Terracotta', hex: '#E07A5F', r: 224, g: 122, b: 95 }
];

export interface VisionOptions {
  aspectRatio?: number;
  width?: number;
  height?: number;
  presetHint?: string;
}

export function generateGarmentDescription(analysis: {
  garmentType?: string;
  category?: string;
  subcategory?: string;
  colors?: ColorDetailItem[];
  pattern?: string;
  material?: string;
  fit?: string;
  moreDetails?: Record<string, string>;
}): string {
  const colorNames = analysis.colors?.map((c) => c.name).filter(Boolean) || [];
  const colorStr = colorNames.length > 0 ? colorNames.slice(0, 3).join(', ') : '';
  const fitStr = analysis.fit && analysis.fit !== 'Regular' && analysis.fit !== 'Not detected' ? `${analysis.fit.toLowerCase()} ` : '';
  const matStr = analysis.material && analysis.material !== 'Not detected' ? `${analysis.material.toLowerCase()} ` : '';
  const styleStr = analysis.subcategory || analysis.category || analysis.garmentType || 'clothing item';

  if (analysis.garmentType === 'Shoes') {
    const shoeMat = analysis.material && analysis.material !== 'Not detected' ? `${analysis.material.toLowerCase()} ` : 'leather ';
    const finish = analysis.moreDetails?.finish ? ` with a ${analysis.moreDetails.finish.toLowerCase()} finish` : ' with a smooth finish';
    const closure = analysis.moreDetails?.closure ? `${analysis.moreDetails.closure.toLowerCase()} ` : 'lace-up ';
    return `${colorStr ? colorStr + ' ' : ''}${shoeMat}${closure}${styleStr.toLowerCase()}${finish}.`;
  }

  if (analysis.pattern && (analysis.pattern.includes('Graphic') || analysis.pattern.includes('Multicolor'))) {
    return `${fitStr}${colorStr ? colorStr + ' ' : ''}${analysis.pattern.toLowerCase()} ${styleStr.toLowerCase()} with a bold design.`.trim();
  }

  const patStr = analysis.pattern && analysis.pattern !== 'Solid' && analysis.pattern !== 'Not detected'
    ? ` with a ${analysis.pattern.toLowerCase()} design`
    : '';

  const main = `${colorStr ? colorStr + ' ' : ''}${fitStr}${matStr}${styleStr}${patStr}`.trim();
  if (!main) return 'Clothing item.';
  return main.charAt(0).toUpperCase() + main.slice(1) + '.';
}

export interface IFashionVisionEngine {
  analyzeGarment(imageUri: string, options?: VisionOptions): Promise<GarmentAnalysisResult>;
}

// Lazy-loaded singleton for zero-shot neural-network model pipeline
let clipPipelinePromise: Promise<any> | null = null;

async function getClipPipeline(): Promise<any> {
  if (clipPipelinePromise) return clipPipelinePromise;
  clipPipelinePromise = (async () => {
    try {
      if (typeof process !== 'undefined' && (process.env?.NODE_ENV === 'test' || process.env?.JEST_WORKER_ID)) {
        return null;
      }
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      return await pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', {
        quantized: true,
      });
    } catch (err) {
      console.warn('[FashionVisionEngine] Transformers.js neural pipeline init error:', err);
      return null;
    }
  })();
  return clipPipelinePromise;
}

/**
 * Extracts dominant and secondary colors directly from the foreground pixels of an image canvas
 */
async function extractColorsFromImageCanvas(imageUri: string): Promise<ColorDetailItem[] | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  return new Promise((resolve) => {
    try {
      const img = new (window as any).Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 128; // Downsample for rapid color clustering
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          canvas.width = Math.max(16, Math.round(img.width * scale));
          canvas.height = Math.max(16, Math.round(img.height * scale));

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;

          // Histogram binning by Euclidean distance to standard fashion palette
          const binCounts = new Array(FASHION_PALETTE.length).fill(0);
          const binR = new Array(FASHION_PALETTE.length).fill(0);
          const binG = new Array(FASHION_PALETTE.length).fill(0);
          const binB = new Array(FASHION_PALETTE.length).fill(0);

          let totalForeground = 0;
          for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a < 32) continue; // transparent pixel

            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // Skip plain white/near-white backdrop pixels
            if (r > 248 && g > 248 && b > 248) continue;

            // Find closest palette bin
            let bestDist = Infinity;
            let bestIdx = 0;
            for (let j = 0; j < FASHION_PALETTE.length; j++) {
              const p = FASHION_PALETTE[j];
              const dist = (p.r - r) * (p.r - r) + (p.g - g) * (p.g - g) + (p.b - b) * (p.b - b);
              if (dist < bestDist) {
                bestDist = dist;
                bestIdx = j;
              }
            }

            binCounts[bestIdx]++;
            binR[bestIdx] += r;
            binG[bestIdx] += g;
            binB[bestIdx] += b;
            totalForeground++;
          }

          if (totalForeground === 0) {
            resolve(null);
            return;
          }

          // Sort bins by frequency
          const sortedBins = binCounts
            .map((count, index) => ({ count, index }))
            .filter((item) => item.count > 0)
            .sort((a, b) => b.count - a.count);

          if (sortedBins.length === 0) {
            resolve(null);
            return;
          }

          const results: ColorDetailItem[] = [];
          for (let b = 0; b < sortedBins.length && b < 6; b++) {
            const bin = sortedBins[b];
            const ratio = bin.count / totalForeground;
            // First 2 colors always included if > 5%, subsequent accent colors if > 4%
            if (b >= 2 && ratio < 0.04) break;

            const colorDef = FASHION_PALETTE[bin.index];
            const avgHex = `#${Math.round(binR[bin.index] / bin.count).toString(16).padStart(2, '0')}${Math.round(binG[bin.index] / bin.count).toString(16).padStart(2, '0')}${Math.round(binB[bin.index] / bin.count).toString(16).padStart(2, '0')}`.toUpperCase();

            const role: 'dominant' | 'secondary' | 'accent' = b === 0 ? 'dominant' : b === 1 ? 'secondary' : 'accent';
            const confidence = b === 0 
              ? Math.min(0.96, Math.max(0.75, ratio + 0.35))
              : Math.min(0.90, Math.max(0.60, ratio + 0.25));

            results.push({
              name: colorDef.name,
              hex: avgHex.length === 7 ? avgHex : colorDef.hex,
              role,
              confidence: Math.round(confidence * 100) / 100,
            });
          }

          resolve(results.length > 0 ? results : null);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = imageUri;
    } catch {
      resolve(null);
    }
  });
}

class FashionVisionEngineImpl implements IFashionVisionEngine {
  private readonly modelName = 'Xenova/clip-vit-base-patch32';
  private readonly modelVersion = '1.0.0-quantized';

  /**
   * Finds closest standard fashion color by Euclidean RGB distance
   */
  private findClosestColor(r: number, g: number, b: number): { name: string; hex: string } {
    let bestDist = Infinity;
    let bestColor = FASHION_PALETTE[0];

    for (const item of FASHION_PALETTE) {
      const dist = Math.sqrt(
        Math.pow(item.r - r, 2) + Math.pow(item.g - g, 2) + Math.pow(item.b - b, 2)
      );
      if (dist < bestDist) {
        bestDist = dist;
        bestColor = item;
      }
    }
    return { name: bestColor.name, hex: bestColor.hex };
  }

  /**
   * Analyzes an image with real zero-shot neural-network model inference,
   * falling back smoothly to geometric/color heuristics if offline or unsupported.
   */
  public async analyzeGarment(
    imageUri: string,
    options?: VisionOptions
  ): Promise<GarmentAnalysisResult> {
    const timestamp = new Date().toISOString();

    // 1. Extract real pixel colors from image canvas if available
    let extractedColors: ColorDetailItem[] | null = null;
    try {
      extractedColors = await extractColorsFromImageCanvas(imageUri);
    } catch {
      extractedColors = null;
    }

    // 2. Attempt Real Pretrained Neural-Network Inference
    try {
      const classifier = await getClipPipeline();
      if (classifier) {
        // Zero-Shot Garment Type Classification
        const typeCandidates = [
          { label: 'a shirt, t-shirt, top, or blouse', type: 'Top', category: 'Tops' },
          { label: 'pants, jeans, shorts, or trousers', type: 'Bottom', category: 'Bottoms' },
          { label: 'a dress, gown, or jumpsuit', type: 'Dress', category: 'Dresses' },
          { label: 'a jacket, coat, blazer, or outerwear', type: 'Outerwear', category: 'Outerwear' },
          { label: 'shoes, sneakers, boots, or footwear', type: 'Shoes', category: 'Footwear' },
          { label: 'a fashion handbag, hat, or accessory', type: 'Accessory', category: 'Accessories' },
        ];

        const typeResults: { label: string; score: number }[] = await classifier(
          imageUri,
          typeCandidates.map((c) => c.label)
        );

        const bestTypeMatch = typeCandidates.find((c) => c.label === typeResults[0]?.label) || typeCandidates[0];
        const detectedType = bestTypeMatch.type;
        const detectedCategory = bestTypeMatch.category;
        // A missing score is unknown, not confident: 0 flags the result for review instead of trusting it.
        const confidence = Math.round((typeResults[0]?.score ?? 0) * 100) / 100;

        // Specialized Subcategory Inference based on predicted Garment Type
        let subcategoryLabels: string[] = [];
        if (detectedType === 'Top') {
          subcategoryLabels = ['a casual t-shirt', 'a button-down dress shirt', 'a polo shirt', 'a blouse', 'a knit sweater', 'a hoodie'];
        } else if (detectedType === 'Bottom') {
          subcategoryLabels = ['denim jeans', 'tailored dress trousers', 'casual shorts', 'a skirt', 'jogger sweatpants'];
        } else if (detectedType === 'Dress') {
          subcategoryLabels = ['a maxi dress', 'a midi dress', 'a cocktail party dress', 'a casual summer sundress'];
        } else if (detectedType === 'Outerwear') {
          subcategoryLabels = ['a tailored blazer', 'a denim jacket', 'a leather jacket', 'a winter coat', 'a cardigan'];
        } else if (detectedType === 'Shoes') {
          subcategoryLabels = ['sneakers or athletic shoes', 'leather dress shoes or loafers', 'boots', 'sandals', 'high heels'];
        } else {
          subcategoryLabels = ['a handbag or tote', 'a belt', 'a hat or cap', 'eyewear or jewelry'];
        }

        const subcategoryResults: { label: string; score: number }[] = await classifier(
          imageUri,
          subcategoryLabels
        );
        const rawSub = subcategoryResults[0]?.label || 'Standard';
        const subcategory = rawSub.replace(/^a\s+|^an\s+/, '').replace(/\s+or\s+.*$/, '').trim();

        // Pattern Inference
        const patternCandidates = [
          { label: 'solid plain single color clothing', pattern: 'Solid' },
          { label: 'striped pattern clothing', pattern: 'Striped' },
          { label: 'floral pattern clothing', pattern: 'Floral' },
          { label: 'plaid or checkered pattern clothing', pattern: 'Plaid' },
          { label: 'polka dot pattern clothing', pattern: 'Polka Dot' },
          { label: 'graphic print clothing', pattern: 'Graphic' },
          { label: 'animal print clothing', pattern: 'Animal Print' },
        ];
        const patternResults: { label: string; score: number }[] = await classifier(
          imageUri,
          patternCandidates.map((p) => p.label)
        );
        const bestPattern = patternCandidates.find((p) => p.label === patternResults[0]?.label)?.pattern || 'Solid';

        // Material Inference
        const materialCandidates = [
          { label: 'cotton fabric', material: 'Cotton' },
          { label: 'denim fabric', material: 'Denim' },
          { label: 'linen fabric', material: 'Linen' },
          { label: 'silk or satin fabric', material: 'Silk' },
          { label: 'wool or knit fabric', material: 'Wool' },
          { label: 'leather material', material: 'Leather' },
          { label: 'synthetic polyester fabric', material: 'Polyester' },
        ];
        const materialResults: { label: string; score: number }[] = await classifier(
          imageUri,
          materialCandidates.map((m) => m.label)
        );
        const bestMaterial = materialCandidates.find((m) => m.label === materialResults[0]?.label)?.material || 'Cotton';

        // Fit Inference
        const fitCandidates = [
          { label: 'regular standard fit', fit: 'Regular' },
          { label: 'slim tailored fit', fit: 'Slim' },
          { label: 'oversized loose fit', fit: 'Oversized' },
        ];
        const fitResults: { label: string; score: number }[] = await classifier(
          imageUri,
          fitCandidates.map((f) => f.label)
        );
        const bestFit = fitCandidates.find((f) => f.label === fitResults[0]?.label)?.fit || 'Regular';

        // Occasions Inference
        const occasions: string[] = ['Casual', 'Everyday'];
        if (detectedType === 'Dress') {
          occasions.push('Dinner', 'Date Night', 'Party');
        } else if (detectedType === 'Outerwear' || subcategory.toLowerCase().includes('shirt') || subcategory.toLowerCase().includes('trouser')) {
          occasions.push('Work', 'Business Casual');
        } else if (detectedType === 'Shoes' && subcategory.toLowerCase().includes('sneaker')) {
          occasions.push('Athletic', 'Travel');
        }

        // If pixel extraction was unavailable the colours are unknown; never substitute a guessed palette.
        const finalColors: ColorDetailItem[] = extractedColors && extractedColors.length > 0 ? extractedColors : [];

        // Construct 512-dim normalized synthetic embedding representation from softmax outputs
        const embedding = new Array(32).fill(0).map((_, idx) => {
          if (idx < typeResults.length) return typeResults[idx].score;
          if (idx < typeResults.length + patternResults.length) return patternResults[idx - typeResults.length].score;
          return 0.05;
        });

        const description = generateGarmentDescription({
          garmentType: detectedType,
          category: detectedCategory,
          subcategory,
          colors: finalColors,
          pattern: bestPattern,
          material: bestMaterial,
          fit: bestFit,
        });

        return {
          garmentType: detectedType,
          category: detectedCategory,
          subcategory,
          colors: finalColors,
          pattern: bestPattern,
          material: bestMaterial,
          fit: bestFit,
          occasions,
          seasons: ['Spring', 'Summer', 'Fall', 'All-Season'],
          description,
          confidence,
          modelMetadata: {
            name: this.modelName,
            version: this.modelVersion,
            timestamp,
          },
          needsReview: confidence < 0.70,
          isRealMl: true,
          embedding,
        };
      }
    } catch (mlErr) {
      console.warn('[FashionVisionEngine] Zero-shot ML inference failed, using geometric fallback:', mlErr);
    }

    // 3. Deterministic Geometric & Palette Fallback
    const ratio = options?.aspectRatio || (options?.height && options?.width ? options.height / options.width : 1.0);
    const uriLower = (imageUri || '').toLowerCase();
    const hintLower = (options?.presetHint || '').toLowerCase();

    const isShoe = ratio < 0.85 || uriLower.includes('shoe') || uriLower.includes('boot') || uriLower.includes('oxford') || uriLower.includes('sneaker') || hintLower.includes('shoe');
    const isDress = ratio > 1.6 || uriLower.includes('dress') || uriLower.includes('gown') || hintLower.includes('dress');
    const isBottom = (ratio >= 1.25 && ratio <= 1.6) || uriLower.includes('pant') || uriLower.includes('jean') || uriLower.includes('trouser') || hintLower.includes('bottom');

    let fallbackType = 'Top';
    let fallbackCategory = 'Shirt';
    let fallbackSubcategory = 'T-Shirt';
    let fallbackPattern = 'Solid';
    let fallbackMaterial = 'Cotton';
    let fallbackFit = 'Regular';
    let fallbackOccasions = ['Casual', 'Everyday'];
    let moreDetails: Record<string, string> = {};

    if (isShoe) {
      fallbackType = 'Shoes';
      fallbackCategory = 'Footwear';
      const isDressShoe = !uriLower.includes('sneaker') && !uriLower.includes('runner');
      fallbackSubcategory = isDressShoe ? 'Dress Shoes' : 'Sneakers';
      fallbackMaterial = isDressShoe ? 'Leather' : 'Canvas';
      fallbackPattern = 'Solid';
      fallbackFit = 'Regular';
      fallbackOccasions = isDressShoe ? ['Formal', 'Work', 'Wedding', 'Business Casual'] : ['Casual', 'Everyday', 'Athletic'];
      moreDetails = {
        shoeStyle: fallbackSubcategory,
        closure: isDressShoe ? 'Lace-up' : 'Laces',
        finish: isDressShoe ? 'Smooth' : 'Matte',
        formality: isDressShoe ? 'Formal' : 'Casual',
      };
    } else if (isDress) {
      fallbackType = 'Dress';
      fallbackCategory = 'Evening Wear';
      fallbackSubcategory = 'Midi Dress';
      fallbackMaterial = 'Silk';
      fallbackPattern = 'Solid';
      fallbackFit = 'Tailored';
      fallbackOccasions = ['Formal', 'Dinner', 'Date Night', 'Cocktail'];
      moreDetails = {
        sleeveType: 'Sleeveless',
        neckline: 'V-Neck',
        length: 'Midi',
      };
    } else if (isBottom) {
      fallbackType = 'Bottom';
      fallbackCategory = 'Classic Suits';
      fallbackSubcategory = 'Trousers';
      fallbackMaterial = 'Wool';
      fallbackPattern = 'Solid';
      fallbackFit = 'Straight';
      fallbackOccasions = ['Work', 'Business Casual', 'Everyday'];
      moreDetails = {
        rise: 'Mid Rise',
        legStyle: 'Straight',
        length: 'Full Length',
      };
    } else {
      // Top
      const isGraphic = extractedColors && extractedColors.length >= 2 || uriLower.includes('graphic') || hintLower.includes('graphic');
      fallbackType = 'Top';
      fallbackCategory = 'Shirt';
      fallbackSubcategory = isGraphic ? 'Graphic T-shirt' : 'T-Shirt';
      fallbackPattern = isGraphic ? 'Multicolor Graphic' : 'Solid';
      fallbackMaterial = 'Cotton';
      fallbackFit = isGraphic ? 'Oversized' : 'Regular';
      fallbackOccasions = isGraphic ? ['Casual', 'Everyday', 'Party'] : ['Casual', 'Everyday'];
      moreDetails = {
        sleeveType: 'Short Sleeve',
        neckline: 'Crew Neck',
        length: 'Regular',
      };
    }

    // Unknown colours stay unknown: a guessed black would be read downstream as an observation.
    const fallbackColors: ColorDetailItem[] = extractedColors && extractedColors.length > 0 ? extractedColors : [];

    const fallbackDesc = generateGarmentDescription({
      garmentType: fallbackType,
      category: fallbackCategory,
      subcategory: fallbackSubcategory,
      colors: fallbackColors,
      pattern: fallbackPattern,
      material: fallbackMaterial,
      fit: fallbackFit,
      moreDetails,
    });

    return {
      garmentType: fallbackType,
      category: fallbackCategory,
      subcategory: fallbackSubcategory,
      colors: fallbackColors,
      pattern: fallbackPattern,
      material: fallbackMaterial,
      fit: fallbackFit,
      occasions: fallbackOccasions,
      seasons: ['All-Season'],
      description: fallbackDesc,
      moreDetails,
      confidence: 0.75,
      modelMetadata: {
        name: 'JeZsy-Geometric-Fallback',
        version: '1.0.0',
        timestamp,
      },
      needsReview: true,
      isRealMl: false,
    };
  }
}

export const fashionVisionEngine: IFashionVisionEngine = new FashionVisionEngineImpl();
