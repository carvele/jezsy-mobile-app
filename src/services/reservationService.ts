import { supabase } from '@/src/lib/supabase';

export async function fetchReservation(id: string) {
  return await supabase.from('reservations').select('*').eq('id', id).single();
}

