DELETE FROM public.pose_guide_products WHERE pose_guide_id IN ('P-001', 'P-002', 'P-003', 'P-004');

UPDATE public.pose_guides SET
  name = 'Front T-Pose', category = 'Calibration', occasion = NULL,
  description = NULL, image_url = NULL, is_featured = false
WHERE id = 'P-001';

UPDATE public.pose_guides SET
  name = 'Side Profile', category = 'Preview', occasion = NULL,
  description = NULL, image_url = NULL, is_featured = false
WHERE id = 'P-002';

UPDATE public.pose_guides SET
  name = 'Walking Stride', category = 'Dynamic', occasion = NULL,
  description = NULL, image_url = NULL, is_featured = false
WHERE id = 'P-003';

UPDATE public.pose_guides SET
  name = 'Over-the-shoulder', category = 'Turn', occasion = NULL,
  description = NULL, image_url = NULL, is_featured = false
WHERE id = 'P-004';
