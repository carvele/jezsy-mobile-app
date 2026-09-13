import { evaluateBodyAlignment, evaluatePoseOrientation } from '../bodyAlignmentEvaluator';
import { LANDMARK_INDEX, type Landmark } from '../poseDetector';

describe('bodyAlignmentEvaluator', () => {
  const createMockPose = (scale: number = 1.0, dy: number = 0): Landmark[] => {
    const lms = new Array(33).fill({ x: 0, y: 0, z: 0, visibility: 0 });
    const setLm = (idx: number, x: number, y: number) => {
      // Center at 0.5, 0.5 for scaling
      const sx = 0.5 + (x - 0.5) * scale;
      const sy = 0.5 + (y - 0.5) * scale + dy;
      lms[idx] = { x: sx, y: sy, z: 0, visibility: 0.95 };
    };

    // Construct a perfectly valid synthetic pose.
    // Nose at 0.5, 0.2
    setLm(LANDMARK_INDEX.nose, 0.5, 0.2);
    // Shoulders level
    setLm(LANDMARK_INDEX.leftShoulder, 0.4, 0.3);
    setLm(LANDMARK_INDEX.rightShoulder, 0.6, 0.3);
    // Hips level
    setLm(LANDMARK_INDEX.leftHip, 0.45, 0.55);
    setLm(LANDMARK_INDEX.rightHip, 0.55, 0.55);
    // Knees
    setLm(LANDMARK_INDEX.leftKnee, 0.45, 0.75);
    setLm(LANDMARK_INDEX.rightKnee, 0.55, 0.75);
    // Ankles matching FOOT_TARGETS (cx: 0.43, cx: 0.57) at scale 1
    // Left target is 0.43, Right is 0.57
    setLm(LANDMARK_INDEX.leftAnkle, 0.43, 0.88);
    setLm(LANDMARK_INDEX.rightAnkle, 0.57, 0.88);
    // Heels and foot indices
    setLm(29, 0.43, 0.88);
    setLm(30, 0.57, 0.88);
    setLm(31, 0.43, 0.88);
    setLm(32, 0.57, 0.88);

    return lms;
  };

  it('verifies scale invariance of slope and stance ratio', () => {
    const scales = [0.5, 0.65, 0.8, 0.9];
    let baseStanceRatio = 0;
    
    scales.forEach((scale, i) => {
      // We also tilt the shoulder slightly to ensure non-zero slope
      const lms = createMockPose(scale);
      // add a fixed proportional slope
      lms[LANDMARK_INDEX.rightShoulder].y += 0.02 * scale;

      const evalResult = evaluateBodyAlignment(lms, true);
      
      expect(evalResult.shoulderSlope).toBeCloseTo(0.1, 4); // dy/dx = 0.02/0.2 = 0.1

      if (i === 0) {
        baseStanceRatio = evalResult.stanceRatio;
      } else {
        expect(evalResult.stanceRatio).toBeCloseTo(baseStanceRatio, 4);
      }
    });
  });

  it('calculates stance using 3-point foot centers', () => {
    const lms = createMockPose(1.0);
    // Move just the ankle way outside the target, but keep heel and footIndex inside.
    lms[LANDMARK_INDEX.leftAnkle].x -= 0.15; 
    const evalResult = evaluateBodyAlignment(lms, true);
    
    // Average x = (0.43 - 0.15 + 0.43 + 0.43) / 3 = 0.38
    // Target is 0.43 with rx 0.08. 0.38 is within rx!
    // If it only used ankle (0.28), it would be outside (0.43 - 0.08 = 0.35).
    expect(evalResult.footStatus.left).toBe(true);
  });

  it('enforces deterministic priority order for violations', () => {
    // 1. NO_PERSON
    let lms = createMockPose(1.0);
    lms[LANDMARK_INDEX.nose].visibility = 0;
    lms[LANDMARK_INDEX.leftShoulder].visibility = 0;
    lms[LANDMARK_INDEX.rightShoulder].visibility = 0;
    let evalResult = evaluateBodyAlignment(lms, true);
    expect(evalResult.violations).toContain('NO_PERSON');
    expect(evalResult.instruction).toBe('Position yourself in front of the camera');

    // 2. BODY_CLIPPED overrides DISTANCE
    lms = createMockPose(1.4); // Too large -> body clipped
    evalResult = evaluateBodyAlignment(lms, true);
    expect(evalResult.violations).toContain('BODY_CLIPPED');
    expect(evalResult.violations).toContain('TOO_CLOSE'); // It might also trigger this
    expect(evalResult.instruction).toBe('Step back so your whole body is visible'); // Priority 2

    // 3. CENTERING overrides POSTURE
    lms = createMockPose(0.8, -0.05); // valid size
    // Shift right
    lms[LANDMARK_INDEX.leftHip].x = 0.7;
    lms[LANDMARK_INDEX.rightHip].x = 0.8;
    // Bad posture
    lms[LANDMARK_INDEX.rightShoulder].y = lms[LANDMARK_INDEX.leftShoulder].y + 0.2;
    evalResult = evaluateBodyAlignment(lms, true);
    expect(evalResult.violations).toContain('OFF_CENTER_RIGHT');
    expect(evalResult.violations).toContain('POSTURE');
    expect(evalResult.instruction).toBe('Move slightly left');

    // 4. POSTURE overrides FEET_PLACEMENT
    lms = createMockPose(0.8, 0); 
    // Bad posture
    lms[LANDMARK_INDEX.rightShoulder].y = lms[LANDMARK_INDEX.leftShoulder].y + 0.2;
    // Bad feet
    lms[LANDMARK_INDEX.leftAnkle].x = 0.1;
    lms[29].x = 0.1;
    lms[31].x = 0.1;
    evalResult = evaluateBodyAlignment(lms, true);
    expect(evalResult.violations).toContain('POSTURE');
    expect(evalResult.violations).toContain('FEET_PLACEMENT');
    expect(evalResult.instruction).toBe('Stand upright');
  });

  it('decouples person presence from lower body visibility (upper body in frame)', () => {
    const lms = createMockPose(1.0);
    // Upper body clearly visible
    lms[LANDMARK_INDEX.nose].visibility = 0.95;
    lms[LANDMARK_INDEX.leftShoulder].visibility = 0.95;
    lms[LANDMARK_INDEX.rightShoulder].visibility = 0.95;
    // Lower body clipped (knees and ankles out of frame)
    lms[LANDMARK_INDEX.leftKnee].visibility = 0;
    lms[LANDMARK_INDEX.rightKnee].visibility = 0;
    lms[LANDMARK_INDEX.leftAnkle].visibility = 0;
    lms[LANDMARK_INDEX.rightAnkle].visibility = 0;

    const result = evaluateBodyAlignment(lms, true);
    expect(result.personDetected).toBe(true);
    expect(result.violations).not.toContain('NO_PERSON');
    expect(result.violations).toContain('BODY_CLIPPED');
    expect(result.instruction).toBe('Step back so your whole body is visible');
  });

  describe('evaluatePoseOrientation', () => {
    it('correctly classifies front, side, and ambiguous poses', () => {
      // Front pose: broad shoulders (span 0.2) relative to torso (height 0.25) -> ratio 0.8
      const frontPose = createMockPose(1.0);
      const frontOrientation = evaluatePoseOrientation(frontPose);
      expect(frontOrientation.label).toBe('front');
      expect(frontOrientation.confidence).toBeGreaterThanOrEqual(0.70);

      // Side pose: collapsed shoulder span (e.g. 0.02) and hip span (e.g. 0.02)
      const sidePose = createMockPose(1.0);
      sidePose[LANDMARK_INDEX.leftShoulder].x = 0.49;
      sidePose[LANDMARK_INDEX.rightShoulder].x = 0.51; // span = 0.02
      sidePose[LANDMARK_INDEX.leftHip].x = 0.49;
      sidePose[LANDMARK_INDEX.rightHip].x = 0.51; // span = 0.02
      const sideOrientation = evaluatePoseOrientation(sidePose);
      expect(sideOrientation.label).toBe('side');
      expect(sideOrientation.confidence).toBeGreaterThanOrEqual(0.70);

      // Ambiguous pose: intermediate shoulder ratio (e.g. 0.40)
      const ambiguousPose = createMockPose(1.0);
      ambiguousPose[LANDMARK_INDEX.leftShoulder].x = 0.45;
      ambiguousPose[LANDMARK_INDEX.rightShoulder].x = 0.55; // span = 0.10, torso = 0.25 -> ratio = 0.40
      const ambiguousOrientation = evaluatePoseOrientation(ambiguousPose);
      expect(ambiguousOrientation.label).toBe('ambiguous');
    });
  });

  it('evaluates requestedPose side and validates forgiving central foot target', () => {
    // 1. Front pose when side is requested -> WRONG_ORIENTATION ("Turn sideways")
    const frontPose = createMockPose(1.0);
    const frontEval = evaluateBodyAlignment(frontPose, true, 'side');
    expect(frontEval.violations).toContain('WRONG_ORIENTATION');
    expect(frontEval.instruction).toBe('Turn sideways');

    // 2. Side pose when side is requested -> no WRONG_ORIENTATION
    const sidePose = createMockPose(1.0);
    sidePose[LANDMARK_INDEX.leftShoulder].x = 0.49;
    sidePose[LANDMARK_INDEX.rightShoulder].x = 0.51;
    sidePose[LANDMARK_INDEX.leftHip].x = 0.49;
    sidePose[LANDMARK_INDEX.rightHip].x = 0.51;
    // Central feet placement (cx: 0.50, cy: 0.88)
    sidePose[LANDMARK_INDEX.leftAnkle].x = 0.50;
    sidePose[LANDMARK_INDEX.rightAnkle].x = 0.50;
    sidePose[29].x = 0.50;
    sidePose[30].x = 0.50;
    sidePose[31].x = 0.50;
    sidePose[32].x = 0.50;

    const sideEval = evaluateBodyAlignment(sidePose, true, 'side');
    expect(sideEval.violations).not.toContain('WRONG_ORIENTATION');
    expect(sideEval.footStatus.left).toBe(true);
    expect(sideEval.footStatus.right).toBe(true);
    expect(sideEval.violations).not.toContain('FEET_PLACEMENT');
  });

  it('validates precise containment for foot targets', () => {
    const lms = createMockPose(1.0);
    // Target is cx: 0.43, rx: 0.08 -> boundaries 0.35 to 0.51
    // Left edge
    lms[LANDMARK_INDEX.leftAnkle].x = 0.35;
    lms[29].x = 0.35;
    lms[31].x = 0.35;
    expect(evaluateBodyAlignment(lms, true).footStatus.left).toBe(true);

    // Just outside left edge
    lms[LANDMARK_INDEX.leftAnkle].x = 0.34;
    lms[29].x = 0.34;
    lms[31].x = 0.34;
    expect(evaluateBodyAlignment(lms, true).footStatus.left).toBe(false);
  });
});
