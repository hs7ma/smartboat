-- Tigris eye / smartboat — captured camera images + storage bucket
-- Applied to Supabase; kept in-repo for reference and re-runs.

CREATE TABLE IF NOT EXISTS public.captured_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  storage_path text NOT NULL,
  public_url text NOT NULL,
  water_quality text,
  pollution_level integer,
  risk_level text,
  description text,
  gps_lat double precision,
  gps_lng double precision,
  analyzed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS captured_images_created_at_idx
  ON public.captured_images (created_at DESC);

ALTER TABLE public.captured_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read captured_images" ON public.captured_images;
CREATE POLICY "Public read captured_images"
  ON public.captured_images
  FOR SELECT
  TO anon, authenticated
  USING (true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'boat-images',
  'boat-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read boat-images" ON storage.objects;
CREATE POLICY "Public read boat-images"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'boat-images');

DROP POLICY IF EXISTS "Authenticated upload boat-images" ON storage.objects;
CREATE POLICY "Authenticated upload boat-images"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'boat-images');
