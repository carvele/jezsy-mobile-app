import { supabase } from '@/src/lib/supabase';

export async function saveOutfit(payload: any) {
  return await supabase.from('saved_outfits').insert(payload);
}

export async function fetchCapsule(id: string) {
  return await supabase.from('capsules').select('*').eq('id', id).single();
}

export async function addCapsuleItem(payload: any) {
  return await supabase.from('capsule_items').insert(payload);
}

export async function deleteCapsule(id: string) {
  return await supabase.from('capsules').delete().eq('id', id);
}

export async function addWardrobeItem(payload: any) {
  return await supabase.from('wardrobe_items').insert(payload);
}

