import { ColorDetailItem } from '../types/dto/aiAttributes';

export interface VisualRepresentation {
  embedding?: number[];
  dominantColors: ColorDetailItem[];
  aspectRatio?: number;
  isRealMl: boolean;
  modelName: string;
}

export interface IFashionMlService {
  extractVisualRepresentation(imageUri: string): Promise<VisualRepresentation>;
  computeVisualSimilarity(embeddingA: number[], embeddingB: number[]): number;
}

// Lazy-loaded singleton for zero-shot feature extraction
let featureExtractorPromise: Promise<any> | null = null;

async function getFeatureExtractor(): Promise<any> {
  if (featureExtractorPromise) return featureExtractorPromise;
  featureExtractorPromise = (async () => {
    try {
      if (typeof window === 'undefined') return null;
      // @ts-ignore
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      return await pipeline('feature-extraction', 'Xenova/clip-vit-base-patch32', {
        quantized: true,
      });
    } catch {
      return null;
    }
  })();
  return featureExtractorPromise;
}

/**
 * Extracts a normalized color-histogram visual embedding from an image canvas
 */
function extractCanvasColorHistogram(imageUri: string): Promise<{ histogram: number[]; colors: ColorDetailItem[] } | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const img = new (window as any).Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 64;
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

          // 32-bin color histogram (8 bins each for R, G, B + lightness)
          const histogram = new Array(32).fill(0);
          let fgPixels = 0;

          for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a < 32) continue;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (r > 248 && g > 248 && b > 248) continue;

            const rBin = Math.min(7, Math.floor(r / 32));
            const gBin = Math.min(7, Math.floor(g / 32));
            const bBin = Math.min(7, Math.floor(b / 32));
            const lum = Math.min(7, Math.floor((0.299 * r + 0.587 * g + 0.114 * b) / 32));

            histogram[rBin] += 1;
            histogram[8 + gBin] += 1;
            histogram[16 + bBin] += 1;
            histogram[24 + lum] += 1;
            fgPixels++;
          }

          if (fgPixels === 0) {
            resolve(null);
            return;
          }

          let norm = 0;
          for (let i = 0; i < histogram.length; i++) {
            histogram[i] /= fgPixels;
            norm += histogram[i] * histogram[i];
          }
          norm = Math.sqrt(norm) || 1;
          for (let i = 0; i < histogram.length; i++) {
            histogram[i] /= norm;
          }

          resolve({ histogram, colors: [] });
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

class FashionMlServiceImpl implements IFashionMlService {
  private cache = new Map<string, VisualRepresentation>();

  public async extractVisualRepresentation(imageUri: string): Promise<VisualRepresentation> {
    if (!imageUri) {
      return {
        dominantColors: [],
        isRealMl: false,
        modelName: 'None',
      };
    }

    if (this.cache.has(imageUri)) {
      return this.cache.get(imageUri)!;
    }

    try {
      const extractor = await getFeatureExtractor();
      if (extractor) {
        const output = await extractor(imageUri);
        const rawData = Array.from(output?.data || []);
        if (rawData.length > 0) {
          let sumSq = 0;
          for (const v of rawData as number[]) sumSq += v * v;
          const mag = Math.sqrt(sumSq) || 1;
          const normalized = (rawData as number[]).map((v) => Math.round((v / mag) * 10000) / 10000);

          const result: VisualRepresentation = {
            embedding: normalized.slice(0, 128),
            dominantColors: [],
            isRealMl: true,
            modelName: 'Xenova/clip-vit-base-patch32',
          };
          this.cache.set(imageUri, result);
          return result;
        }
      }
    } catch {
      // Degrade safely to canvas histogram
    }

    try {
      const histData = await extractCanvasColorHistogram(imageUri);
      if (histData?.histogram) {
        const result: VisualRepresentation = {
          embedding: histData.histogram,
          dominantColors: histData.colors,
          isRealMl: false,
          modelName: 'JeZsy-Visual-Histogram-Fallback',
        };
        this.cache.set(imageUri, result);
        return result;
      }
    } catch {
      // Fall through
    }

    const fallback: VisualRepresentation = {
      dominantColors: [],
      isRealMl: false,
      modelName: 'JeZsy-Visual-Fallback',
    };
    return fallback;
  }

  public computeVisualSimilarity(embeddingA: number[], embeddingB: number[]): number {
    if (!embeddingA || !embeddingB || embeddingA.length === 0 || embeddingB.length === 0) {
      return 0.5;
    }
    const len = Math.min(embeddingA.length, embeddingB.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      dot += embeddingA[i] * embeddingB[i];
      normA += embeddingA[i] * embeddingA[i];
      normB += embeddingB[i] * embeddingB[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0.5;
    return Math.max(0, Math.min(1, dot / denom));
  }
}

export const fashionMlService: IFashionMlService = new FashionMlServiceImpl();
