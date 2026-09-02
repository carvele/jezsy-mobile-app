import { supabase } from '@/src/lib/supabase';

export async function fetchProductDetails(id: string, categorySelect: string) {
  return await supabase.from('products').select('*' + (categorySelect ? ', ' + categorySelect : '')).eq('id', id).single();
}

export async function fetchProductInventory(productId: string) {
  return await supabase.from('inventory').select('*').eq('product_doc_id', productId);
}

export async function fetchUserProfileAndMeasurements(userId: string) {
  const [profileRes, measurementsRes] = await Promise.all([
    supabase.from('profiles').select('fit_preference').eq('id', userId).single(),
    supabase.from('user_measurements').select('measurements').eq('user_id', userId).maybeSingle(),
  ]);
  return { profileRes, measurementsRes };
}

export async function updateFitPreference(userId: string, fitPreference: string) {
  return await supabase.from('profiles').update({ fit_preference: fitPreference }).eq('id', userId);
}

export async function upsertUserMeasurements(payload: any) {
  return await supabase.from('user_measurements').upsert(payload, { onConflict: 'user_id' });
}

