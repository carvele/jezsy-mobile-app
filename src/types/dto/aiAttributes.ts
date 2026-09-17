export type ColorRole = 'dominant' | 'secondary' | 'accent';

export interface ColorDetailItem {
  name: string;
  hex: string;
  role: ColorRole;
  confidence: number;
}

export interface GarmentAnalysisResult {
  garmentType: string;
  category: string;
  subcategory?: string;
  colors: ColorDetailItem[];
  pattern?: string;
  material?: string;
  fit?: string;
  lengthType?: string;
  sleeveType?: string;
  neckline?: string;
  silhouette?: string;
  occasions: string[];
  seasons: string[];
  description?: string;
  confidence: number;
  moreDetails?: Record<string, string>;
  modelMetadata: {
    name: string;
    version: string;
    timestamp: string;
  };
  needsReview: boolean;
  isRealMl?: boolean;
  embedding?: number[];
}

export interface UserCorrections {
  original: {
    garmentType?: string;
    category?: string;
    subcategory?: string;
    colors?: string[];
    pattern?: string;
    material?: string;
    fit?: string;
    occasions?: string[];
  };
  corrected: {
    garmentType?: string;
    category?: string;
    subcategory?: string;
    colors?: string[];
    pattern?: string;
    material?: string;
    fit?: string;
    occasions?: string[];
  };
  correctedAt: string;
}
