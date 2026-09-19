import { useRef, useState, useCallback, useEffect } from 'react';
import type { Landmark } from '../utils/poseDetector';
import { evaluateBodyAlignment, type AlignmentViolation, type RequestedPose } from '../utils/bodyAlignmentEvaluator';
import { normalizeAlignmentLandmarks, type AlignmentCoordinateContext } from '../utils/alignmentCoordinates';

export type AlignmentState = 'SEARCHING' | 'POSITIONING' | 'STABILIZING' | 'LOCKED';

export interface UseBodyAlignmentOptions {
  onCaptureReady: () => void;
  onLock?: () => void;
  context: AlignmentCoordinateContext;
  requestedPose?: RequestedPose;
}

export interface BodyAlignmentResult {
  state: AlignmentState;
  instruction: string | null;
  footStatus: { left: boolean; right: boolean };
  bounds: { topY: number; bottomY: number };
  violations: AlignmentViolation[];
}

const HISTORY_SIZE = 5;
const STILLNESS_THRESHOLD = 0.015; // Max allowed RMS velocity
const DEBOUNCE_MS = 200;
const LOCK_DWELL_MS = 1000; // Stillness dwell required in STABILIZING to reach LOCKED
const LOCK_CONFIRMATION_MS = 350; // Perceptual confirmation delay after LOCKED before triggering capture

function computeRMSVelocity(history: Landmark[][]): number {
  if (history.length < 2) return 0;
  
  // Indices to track for stillness: shoulders(11,12), hips(23,24), knees(25,26), ankles(27,28)
  const trackedIndices = [11, 12, 23, 24, 25, 26, 27, 28];
  
  let sumSq = 0;
  let count = 0;

  for (let i = 1; i < history.length; i++) {
    const curr = history[i];
    const prev = history[i - 1];
    
    for (const idx of trackedIndices) {
      if (curr.length > idx && prev.length > idx) {
        const dx = curr[idx].x - prev[idx].x;
        const dy = curr[idx].y - prev[idx].y;
        sumSq += dx * dx + dy * dy;
        count++;
      }
    }
  }

  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

export function useBodyAlignment({ onCaptureReady, onLock, context, requestedPose = 'front' }: UseBodyAlignmentOptions) {
  const [result, setResult] = useState<BodyAlignmentResult>({
    state: 'SEARCHING',
    instruction: requestedPose === 'front' ? 'Face the camera' : 'Turn sideways',
    footStatus: { left: false, right: false },
    bounds: { topY: 0, bottomY: 0 },
    violations: ['NO_PERSON']
  });

  const stateRef = useRef<AlignmentState>('SEARCHING');
  const historyRef = useRef<Landmark[][]>([]);
  const prevPoseRef = useRef<RequestedPose>(requestedPose);
  
  // Timers for hysteresis/debounce
  const instructionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const stabilizingStartRef = useRef<number | null>(null);
  const lockConfirmationTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Store pending UI updates to debounce
  const pendingUpdateRef = useRef<BodyAlignmentResult | null>(null);

  // Clean reset when switching requested pose (e.g. front -> side)
  useEffect(() => {
    if (prevPoseRef.current !== requestedPose) {
      prevPoseRef.current = requestedPose;
      historyRef.current = [];
      stabilizingStartRef.current = null;
      if (instructionTimeoutRef.current) {
        clearTimeout(instructionTimeoutRef.current);
        instructionTimeoutRef.current = null;
      }
      if (lockConfirmationTimerRef.current) {
        clearTimeout(lockConfirmationTimerRef.current);
        lockConfirmationTimerRef.current = null;
      }
      stateRef.current = 'SEARCHING';
      setResult({
        state: 'SEARCHING',
        instruction: requestedPose === 'front' ? 'Face the camera' : 'Turn sideways',
        footStatus: { left: false, right: false },
        bounds: { topY: 0, bottomY: 0 },
        violations: ['NO_PERSON']
      });
    }
  }, [requestedPose]);

  const processFrame = useCallback((rawLandmarks: Landmark[], isPhoneTiltValid: boolean) => {
    // 1. Normalize
    const landmarks = normalizeAlignmentLandmarks(rawLandmarks, context);

    // 2. Update history buffer
    historyRef.current.push(landmarks);
    if (historyRef.current.length > HISTORY_SIZE) {
      historyRef.current.shift();
    }

    // 3. Pure evaluation with requested pose
    const evaluation = evaluateBodyAlignment(landmarks, isPhoneTiltValid, requestedPose);

    // 4. Calculate stillness
    const rmsVelocity = computeRMSVelocity(historyRef.current);
    const stillnessValid = rmsVelocity < STILLNESS_THRESHOLD;

    // 5. State transitions
    let nextState = stateRef.current;
    
    if (!evaluation.personDetected) {
      nextState = 'SEARCHING';
      stabilizingStartRef.current = null;
      if (lockConfirmationTimerRef.current) {
        clearTimeout(lockConfirmationTimerRef.current);
        lockConfirmationTimerRef.current = null;
      }
    } else if (evaluation.violations.length > 0) {
      nextState = 'POSITIONING';
      stabilizingStartRef.current = null;
      if (lockConfirmationTimerRef.current) {
        clearTimeout(lockConfirmationTimerRef.current);
        lockConfirmationTimerRef.current = null;
      }
    } else {
      // Valid geometry!
      if (nextState === 'SEARCHING' || nextState === 'POSITIONING') {
        nextState = 'STABILIZING';
      }

      if (nextState === 'STABILIZING') {
        if (!stillnessValid) {
          // Reset dwell if moving
          stabilizingStartRef.current = null;
        } else {
          // Stillness is valid. Start or continue dwell timer.
          if (stabilizingStartRef.current === null) {
            stabilizingStartRef.current = Date.now();
          } else if (Date.now() - stabilizingStartRef.current >= LOCK_DWELL_MS) {
            nextState = 'LOCKED';
            stabilizingStartRef.current = null;
          }
        }
      }
    }

    // Prepare new UI state
    let nextInstruction = evaluation.instruction;
    if (nextState === 'SEARCHING' && !nextInstruction) nextInstruction = requestedPose === 'front' ? 'Face the camera' : 'Turn sideways';
    if (nextState === 'STABILIZING') nextInstruction = 'Hold still';
    if (nextState === 'LOCKED') nextInstruction = ' Perfect — hold still';

    const nextResult: BodyAlignmentResult = {
      state: nextState,
      instruction: nextInstruction,
      footStatus: evaluation.footStatus,
      bounds: evaluation.bounds,
      violations: evaluation.violations,
    };

    // If state newly reached LOCKED, trigger onLock immediately and schedule capture after confirmation window
    if (nextState === 'LOCKED' && stateRef.current !== 'LOCKED') {
      onLock?.();
      if (lockConfirmationTimerRef.current) clearTimeout(lockConfirmationTimerRef.current);
      lockConfirmationTimerRef.current = setTimeout(() => {
        if (stateRef.current === 'LOCKED') {
          onCaptureReady();
        }
        lockConfirmationTimerRef.current = null;
      }, LOCK_CONFIRMATION_MS);
    }

    stateRef.current = nextState;

    // Debounce the React state update by DEBOUNCE_MS, unless it's a critical state transition
    if (nextState === 'LOCKED') {
      if (instructionTimeoutRef.current) clearTimeout(instructionTimeoutRef.current);
      setResult(nextResult);
    } else {
      pendingUpdateRef.current = nextResult;
      if (!instructionTimeoutRef.current) {
        instructionTimeoutRef.current = setTimeout(() => {
          if (pendingUpdateRef.current) {
            setResult(pendingUpdateRef.current);
          }
          instructionTimeoutRef.current = null;
        }, DEBOUNCE_MS);
      }
    }
  }, [context, onCaptureReady, onLock, requestedPose]);

  // Clean up
  useCallback(() => {
    if (instructionTimeoutRef.current) clearTimeout(instructionTimeoutRef.current);
    if (lockConfirmationTimerRef.current) clearTimeout(lockConfirmationTimerRef.current);
  }, []);

  return { result, processFrame };
}
