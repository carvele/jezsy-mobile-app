import type { GarmentMetadata } from '../types/garment';

export interface MaterialColorOverride {
  materialName: string;
  materialIndex?: number;
  baseColorFactor: [number, number, number, number]; // [r, g, b, a] in 0.0 - 1.0 range
  hexColor: string;
  isFabricMaterial: boolean;
  preservedAttributes: string[];
}

export interface GlbMaterialDescriptor {
  name: string;
  index: number;
}

const EXCLUDED_NON_FABRIC_KEYWORDS = [
  'button',
  'zipper',
  'hardware',
  'metal',
  'chrome',
  'gold',
  'silver',
  'steel',
  'brass',
  'logo',
  'tag',
  'label',
  'trim',
  'buckle',
  'lining',
  'eyelet',
  'cord',
  'string',
  'thread',
  'stitch',
];

const FABRIC_KEYWORDS = [
  'fabric',
  'cloth',
  'body',
  'main',
  'garment',
  'shirt',
  'dress',
  'jacket',
  'pants',
  'cotton',
  'denim',
  'wool',
  'silk',
  'polyester',
  'linen',
  'base',
];

/**
 * Parses a standard 6-digit hex color string "#RRGGBB" into normalized [r, g, b, 1.0].
 */
export function hexToNormalizedRgba(
  hex: string
): [number, number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b, 1.0];
}

/**
 * Evaluates whether a material name represents the primary recolorable garment fabric.
 */
export function isFabricMaterialName(name: string): boolean {
  const lower = name.toLowerCase();

  // If it explicitly contains non-fabric keywords (e.g. "button_plastic", "metal_zipper"), exclude it
  for (const excluded of EXCLUDED_NON_FABRIC_KEYWORDS) {
    if (lower.includes(excluded)) {
      return false;
    }
  }

  // If it contains known fabric keywords, accept it
  for (const fabric of FABRIC_KEYWORDS) {
    if (lower.includes(fabric)) {
      return true;
    }
  }

  return false;
}

/**
 * Identifies the garment fabric MaterialInstance for variant recoloring.
 * Respects priority:
 * 1. Explicit metadata mapping
 * 2. Authored material name matching
 * 3. Verified single-material fallback
 */
export function resolveFabricMaterialRecoloring(
  hexColor: string | null | undefined,
  metadata?: GarmentMetadata,
  availableMaterials: GlbMaterialDescriptor[] = []
): MaterialColorOverride | null {
  if (!hexColor) return null;

  const rgba = hexToNormalizedRgba(hexColor);
  if (!rgba) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[MaterialRecolorer] Invalid hex color format: ${hexColor}`);
    }
    return null;
  }

  const preservedAttributes = [
    'roughnessFactor',
    'metallicFactor',
    'normalTexture',
    'occlusionTexture',
    'metallicRoughnessTexture',
  ];

  // Priority 1: Explicit metadata material mapping if available
  const explicitFabricName =
    (metadata as any)?.fabricMaterialName ||
    (metadata as any)?.materialMap?.fabric;

  if (explicitFabricName) {
    return {
      materialName: explicitFabricName,
      baseColorFactor: rgba,
      hexColor,
      isFabricMaterial: true,
      preservedAttributes,
    };
  }

  // Priority 2: Authored material name matching against available materials
  if (availableMaterials.length > 0) {
    const matched = availableMaterials.find((m) => isFabricMaterialName(m.name));
    if (matched) {
      return {
        materialName: matched.name,
        materialIndex: matched.index,
        baseColorFactor: rgba,
        hexColor,
        isFabricMaterial: true,
        preservedAttributes,
      };
    }

    // Single-material asset: safe to recolor the only material
    if (availableMaterials.length === 1) {
      return {
        materialName: availableMaterials[0].name,
        materialIndex: 0,
        baseColorFactor: rgba,
        hexColor,
        isFabricMaterial: true,
        preservedAttributes,
      };
    }

    // Multi-material without clear match: DO NOT recolor indiscriminately
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(
        `[MaterialRecolorer] Multiple materials found [${availableMaterials
          .map((m) => m.name)
          .join(', ')}] without an explicit fabric match. Preserving authored GLB colors.`
      );
    }
    return null;
  }

  // Fallback when available materials list is not yet loaded: use default fabric identifier
  return {
    materialName: 'fabric_material',
    baseColorFactor: rgba,
    hexColor,
    isFabricMaterial: true,
    preservedAttributes,
  };
}
