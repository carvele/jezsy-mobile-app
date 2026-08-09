-- Migration: Track staff member who confirmed/accepted a reservation + timestamp
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS confirmed_by_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_by_name text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS reservations_confirmed_by_idx
  ON public.reservations (confirmed_by_id)
  WHERE confirmed_by_id IS NOT NULL;
