-- pose_guides had zero rows: the admin-dashboard's ARAssets.jsx pose-guide
-- CRUD screen was built, but nothing ever populated the table, and nothing
-- in the mobile app consumed it. This seeds the same 4 example poses that
-- screen's own fallback UI already treats as its defaults, using matching
-- IDs so staff adding the same rows through that screen won't collide.
-- Data-only, idempotent -- no schema change.

INSERT INTO public.pose_guides (id, name, category) VALUES
  ('P-001', 'Front T-Pose', 'Calibration'),
  ('P-002', 'Side Profile', 'Preview'),
  ('P-003', 'Walking Stride', 'Dynamic'),
  ('P-004', 'Over-the-shoulder', 'Turn')
ON CONFLICT (id) DO NOTHING;
