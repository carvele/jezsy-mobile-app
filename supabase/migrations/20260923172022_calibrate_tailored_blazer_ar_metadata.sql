-- Calibrate Tailored Blazer AR Metadata
-- Sets AR_READY, T_POSE, proper bone_map, rest_pose_metric_width, and shoulder anchor offset

UPDATE public.products
SET garment_metadata = jsonb_build_object(
  'id', 'b0000008-0000-4000-8000-000000000002',
  'category', 'jacket',
  'calibration_version', '2.0.0',
  'ingestion_status', 'AR_READY',
  'anatomical_anchor_offset', jsonb_build_object('x', 0, 'y', 1.35, 'z', 0),
  'anchor_confidence', 'HIGH',
  'anchor_type', 'SHOULDER_CENTER',
  'rest_pose_metric_width', 0.357,
  'bone_map', jsonb_build_object(
    'mixamorigSpine', 'Spine',
    'mixamorigSpine1', 'Spine1',
    'mixamorigSpine2', 'Spine2',
    'mixamorigLeftShoulder', 'LeftShoulder',
    'mixamorigLeftArm', 'LeftArm',
    'mixamorigLeftForeArm', 'LeftForeArm',
    'mixamorigRightShoulder', 'RightShoulder',
    'mixamorigRightArm', 'RightArm',
    'mixamorigRightForeArm', 'RightForeArm'
  ),
  'rest_pose', 'T_POSE',
  'auto_rigged', false,
  'fabric_stretch', COALESCE(garment_metadata->>'fabric_stretch', 'Moderate')
)
WHERE id = 'b0000008-0000-4000-8000-000000000002';
