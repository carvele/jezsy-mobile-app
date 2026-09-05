ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text UNIQUE;

CREATE INDEX profiles_username_idx ON public.profiles(username);
