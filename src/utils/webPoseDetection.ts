/**
 * webPoseDetection.ts
 *
 * In-browser real-time body tracking via Google MediaPipe Tasks Vision (WASM + GPU/CPU).
 * Dynamically loads the vision bundle from CDN for web clients without bundling native dependencies.
 */

import type { Landmark } from './poseDetector';

export class WebPoseTracker {
  private poseLandmarker: any = null;
  private isInitializing = false;
  private isReady = false;
  private lastVideoTime = -1;

  async init(): Promise<boolean> {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (this.isReady) return true;
    if (this.isInitializing) return false;

    this.isInitializing = true;

    try {
      // Dynamic import from CDN ESM module via runtime loader
      const importDynamic = new Function('modulePath', 'return import(modulePath)');
      const visionModule = await importDynamic(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
      );

      const { FilesetResolver, PoseLandmarker } = visionModule;

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );

      this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      this.isReady = true;
      this.isInitializing = false;
      return true;
    } catch (err) {
      console.warn('GPU delegate failed or WASM initialization failed, trying CPU fallback:', err);
      try {
        const importDynamic = new Function('modulePath', 'return import(modulePath)');
        const visionModule = await importDynamic(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
        );
        const { FilesetResolver, PoseLandmarker } = visionModule;
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );

        this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });

        this.isReady = true;
        this.isInitializing = false;
        return true;
      } catch (fallbackErr) {
        console.error('Failed to initialize Web MediaPipe PoseLandmarker:', fallbackErr);
        this.isInitializing = false;
        return false;
      }
    }
  }

  detect(videoElement: HTMLVideoElement, timestampMs: number): Landmark[] | null {
    if (!this.isReady || !this.poseLandmarker || !videoElement) return null;
    if (videoElement.readyState < 2) return null; // HAVE_CURRENT_DATA

    try {
      if (videoElement.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = videoElement.currentTime;
        const results = this.poseLandmarker.detectForVideo(videoElement, timestampMs);

        if (results && results.landmarks && results.landmarks.length > 0) {
          const rawLandmarks = results.landmarks[0];
          // Map to standard BlazePose 33-point Landmark structure
          return rawLandmarks.map((pt: any) => ({
            x: pt.x,
            y: pt.y,
            z: pt.z || 0,
            visibility: pt.visibility !== undefined ? pt.visibility : (pt.presence ?? 0.9),
          }));
        }
      }
    } catch (e) {
      console.warn('Pose detection frame error:', e);
    }
    return null;
  }

  close() {
    if (this.poseLandmarker) {
      try {
        this.poseLandmarker.close();
      } catch (_) {}
      this.poseLandmarker = null;
    }
    this.isReady = false;
    this.isInitializing = false;
  }
}
