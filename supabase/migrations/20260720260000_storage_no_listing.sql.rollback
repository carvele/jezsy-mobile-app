CREATE POLICY "AR Models are publicly readable"
  ON storage.objects FOR SELECT USING (bucket_id = 'ar-models');

CREATE POLICY "Avatars are publicly readable"
  ON storage.objects FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "Public read access to chat-images"
  ON storage.objects FOR SELECT USING (bucket_id = 'chat-images');

CREATE POLICY "Public read access to wardrobe-images"
  ON storage.objects FOR SELECT USING (bucket_id = 'wardrobe-images');
