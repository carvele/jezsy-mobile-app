-- Color Recommendation Phase 1: per-user color personalization signals.
-- Separate, optional table (not on profiles) so a user with no color
-- personalization data leaves no row at all, rather than a wide row of nulls.

CREATE TABLE IF NOT EXISTS public.user_color_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  undertone TEXT NOT NULL CHECK (undertone IN ('warm', 'cool', 'neutral', 'unknown')) DEFAULT 'unknown',
  undertone_source TEXT NOT NULL CHECK (undertone_source IN ('self_selected', 'camera_estimate', 'none')) DEFAULT 'none',
  undertone_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.00
    CHECK (undertone_confidence >= 0.00 AND undertone_confidence <= 1.00),
  preferred_colors TEXT[] NOT NULL DEFAULT '{}',
  avoided_colors TEXT[] NOT NULL DEFAULT '{}',
  personalization_consented_at TIMESTAMPTZ, -- explicit opt-in tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Domain Consistency Contract (see implementation plan): both invariants
  -- were stated as prose in the plan but not actually enforced -- encoded
  -- here as CHECK constraints so the DB, not app code, guarantees them.
  CONSTRAINT chk_undertone_none_implies_unknown_zero CHECK (
    undertone_source <> 'none' OR (undertone = 'unknown' AND undertone_confidence = 0.00)
  ),
  CONSTRAINT chk_camera_estimate_requires_consent CHECK (
    undertone_source <> 'camera_estimate' OR personalization_consented_at IS NOT NULL
  )
);

CREATE OR REPLACE FUNCTION public.trg_user_color_profiles_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_user_color_profiles_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS before_update_user_color_profiles ON public.user_color_profiles;
CREATE TRIGGER before_update_user_color_profiles
BEFORE UPDATE ON public.user_color_profiles
FOR EACH ROW EXECUTE FUNCTION public.trg_user_color_profiles_updated_at();

-- RLS: users manage only their own profile (InitPlan-safe: select auth.uid())
ALTER TABLE public.user_color_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own color profile" ON public.user_color_profiles;
CREATE POLICY "Users manage own color profile" ON public.user_color_profiles
  FOR ALL TO authenticated
  USING (((select auth.uid()) = user_id))
  WITH CHECK (((select auth.uid()) = user_id));
