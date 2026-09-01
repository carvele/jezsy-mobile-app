import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/src/lib/supabase';
import { useAuth } from '@/src/context/AuthContext';
import type { UserMeasurements } from '@/src/utils/sizeRecommender';

// Loads the signed-in user's stored measurements and fit preference once, so
// catalog screens and mannequin can run sizing without re-querying every time.
export function useSizingProfile() {
  const { user } = useAuth();
  const [measurements, setMeasurements] = useState<UserMeasurements | null>(null);
  const [fitPreference, setFitPreference] = useState<string>('regular');
  const [heightCm, setHeightCm] = useState<number | null>(null);
  const [gender, setGender] = useState<string>('female');
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    cancelledRef.current = false;
    if (!user?.id) {
      setMeasurements(null);
      setFitPreference('regular');
      setHeightCm(null);
      setReady(false);
      setLoaded(true);
      return;
    }
    try {
      const [{ data: profile }, { data: metrics }] = await Promise.all([
        supabase.from('profiles').select('fit_preference, gender').eq('id', user.id).single(),
        supabase.from('user_measurements').select('measurements, height').eq('user_id', user.id).maybeSingle(),
      ]);

      if (cancelledRef.current) return;

      setFitPreference(profile?.fit_preference || 'regular');
      if (profile?.gender) setGender(profile.gender);
      if (metrics?.height) setHeightCm(metrics.height);

      let m: UserMeasurements | null = null;
      if (metrics?.measurements) {
        const raw = metrics.measurements as Record<string, any>;
        const extractVal = (entry: any): number | null => {
          if (entry === null || entry === undefined) return null;
          if (typeof entry === 'number') return entry;
          if (typeof entry === 'object' && typeof entry.valueCm === 'number') return entry.valueCm;
          const parsed = parseFloat(entry);
          return isNaN(parsed) ? null : parsed;
        };

        m = {
          bust: extractVal(raw.bust),
          waist: extractVal(raw.waist),
          hips: extractVal(raw.hips),
          inseam: extractVal(raw.inseam),
          shoulderWidth: extractVal(raw.shoulderWidth),
          armLength: extractVal(raw.armLength),
          torsoLength: extractVal(raw.torsoLength),
          legLength: extractVal(raw.legLength),
        };
      }
      
      // Ready if at least one primary measurement exists
      const hasPrimary = !!(m && (m.bust || m.waist || m.hips || m.shoulderWidth));
      setMeasurements(hasPrimary ? m : null);
      setReady(hasPrimary);
    } catch (err) {
      console.error('Error loading sizing profile:', err);
      if (cancelledRef.current) return;
      setMeasurements(null);
      setReady(false);
    } finally {
      if (!cancelledRef.current) setLoaded(true);
    }
  }, [user?.id]);

  useEffect(() => {
    cancelledRef.current = false;
    setLoaded(false);
    load();
    return () => {
      cancelledRef.current = true;
    };
  }, [load]);

  const needsSetup = loaded && !!user?.id && !ready;

  return { measurements, fitPreference, heightCm, gender, ready, loaded, needsSetup, refetch: load };
}
