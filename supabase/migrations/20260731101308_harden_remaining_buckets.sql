-- 20260730140311 capped size and restricted MIME types on chat-images,
-- payment_receipts, review-images and wardrobe-images but skipped ar-models
-- and avatars, which were left public with no size limit and no MIME
-- allowlist -- an unbounded upload vector on a free-tier project.
-- Both stay public (ar-models is fetched by the model-viewer WebView and
-- avatars render without a session), only the limits are added.

update storage.buckets
set file_size_limit = 26214400, -- 25 MB: GLB models run large
    allowed_mime_types = array[
      'model/gltf-binary',
      'model/gltf+json',
      'model/vnd.usdz+zip',
      'application/octet-stream'
    ]
where id = 'ar-models';

update storage.buckets
set file_size_limit = 5242880, -- 5 MB, matching the other image buckets
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic'
    ]
where id = 'avatars';
