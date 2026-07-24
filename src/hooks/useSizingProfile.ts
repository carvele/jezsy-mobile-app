import { useEffect, useState } from 'react';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import type { UserMeasurements } from '@/src/utils/sizeRecommender';

// Loads the signed-in user's stored measurements and fit preference once, so
// catalog screens can run recommendSize() per product without each re-querying.
// `ready` is true only when there is at least one primary measurement to match
// on; callers should hide fit UI (never guess) when it is false.
export function useSizingProfile() {
  const { user } = useAuth();
  const [measurements, setMeasurements] = useState<UserMeasurements | null>(null);
  const [fitPreference, setFitPreference] = useState<string>('regular');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!user?.id) {
        setMeasurements(null);
        setFitPreference('regular');
        setReady(false);
        return;
      }
      try {
        const [{ data: profile }, { data: metrics }] = await Promise.all([
          supabase.from('profiles').select('fit_preference').eq('id', user.id).single(),
          supabase.from('user_measurements').select('measurements').eq('user_id', user.id).maybeSingle(),
        ]);
        if (cancelled) return;

        setFitPreference(profile?.fit_preference || 'regular');

        const m = (metrics?.measurements as UserMeasurements) || null;
        // recommendSize needs at least one of bust/waist/hips to return a size.
        const hasPrimary = !!(m && (m.bust || m.waist || m.hips));
        setMeasurements(hasPrimary ? m : null);
        setReady(hasPrimary);
      } catch (err) {
        if (cancelled) return;
        console.error('Error loading sizing profile:', err);
        setMeasurements(null);
        setReady(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return { measurements, fitPreference, ready };
}
