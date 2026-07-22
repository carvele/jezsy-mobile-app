import { supabase } from '@/src/lib/supabase';

// A selectable color swatch, sourced from the DB-managed `color_options` table.
export type ColorOption = { name: string; hex: string; border: string };

// Fallback palette mirroring the seeded `color_options` rows, used when the
// fetch fails or returns nothing so color pickers still render offline.
export const DEFAULT_COLOR_OPTIONS: ColorOption[] = [
  { name: 'Red', hex: '#DC2626', border: 'transparent' },
  { name: 'Blue', hex: '#2563EB', border: 'transparent' },
  { name: 'Black', hex: '#000000', border: 'transparent' },
  { name: 'White', hex: '#FFFFFF', border: '#D1D5DB' },
  { name: 'Gold', hex: '#D4AF37', border: 'transparent' },
  { name: 'Silver', hex: '#C0C0C0', border: 'transparent' },
  { name: 'Pink', hex: '#EC4899', border: 'transparent' },
  { name: 'Emerald', hex: '#047857', border: 'transparent' },
];

// Fetches the managed color palette; falls back to DEFAULT_COLOR_OPTIONS.
export async function fetchColorOptions(): Promise<ColorOption[]> {
  try {
    const { data, error } = await supabase
      .from('color_options')
      .select('name, hex, border')
      .order('sort_order', { ascending: true });
    if (error || !data || data.length === 0) return DEFAULT_COLOR_OPTIONS;
    return data.map((c) => ({
      name: c.name,
      hex: c.hex,
      border: c.border || 'transparent',
    }));
  } catch {
    return DEFAULT_COLOR_OPTIONS;
  }
}
