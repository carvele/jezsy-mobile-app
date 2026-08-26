/**
 * webPoseDetection.ts
 *
 * In-browser real-time body tracking via Google MediaPipe Tasks Vision (WASM + GPU/CPU).
 * Dynamically loads the vision bundle from CDN for web clients without bundling native dependencies.
 */

import type { Landmark } from './poseDetector';

export class WebPoseTracker {
  private poseLandmarker: any = null;
  private initPromise: Promise<boolean> | null = null;
  private isReady = false;
  private isDisposed = false;
  private lastVideoTime = -1;

  async init(): Promise<boolean> {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    if (this.isReady) return true;
    if (this.initPromise) return this.initPromise;

    this.isDisposed = false;

    this.initPromise = (async () => {
      try {
        const importDynamic = new Function('modulePath', 'return import(modulePath)');
        const visionModule = await importDynamic(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
        );

        if (this.isDisposed) return false;

        const { FilesetResolver, PoseLandmarker } = visionModule;
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );

        if (this.isDisposed) return false;

        try {
          this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.35,
            minPosePresenceConfidence: 0.35,
            minTrackingConfidence: 0.35,
            outputSegmentationMasks: true,
          });
        } catch (gpuErr) {
          console.warn('GPU delegate failed, attempting CPU fallback:', gpuErr);
          if (this.isDisposed) return false;
          this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.35,
            minPosePresenceConfidence: 0.35,
            minTrackingConfidence: 0.35,
            outputSegmentationMasks: true,
          });
        }

        if (this.isDisposed) {
          this.close();
          return false;
        }

        this.isReady = true;
        return true;
      } catch (err) {
        console.error('Failed to initialize Web MediaPipe PoseLandmarker:', err);
        return false;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  detect(videoElement: HTMLVideoElement, timestampMs: number): { landmarks: Landmark[], worldLandmarks: Landmark[], segmentation?: import('../types/pose').SegmentationFrame } | null {
    if (!this.isReady || !this.poseLandmarker || !videoElement || this.isDisposed) return null;
    if (videoElement.readyState < 2) return null; // HAVE_CURRENT_DATA

    try {
      if (videoElement.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = videoElement.currentTime;
        const results = this.poseLandmarker.detectForVideo(videoElement, timestampMs);

        if (results && results.landmarks && results.landmarks.length > 0) {
          const rawLandmarks = results.landmarks[0];
          const rawWorldLandmarks = results.worldLandmarks?.[0] || [];
          const mask = results.segmentationMasks?.[0];
          
          let segmentation: import('../types/pose').SegmentationFrame | undefined = undefined;
          if (mask) {
            segmentation = {
              width: mask.width || videoElement.videoWidth,
              height: mask.height || videoElement.videoHeight,
              timestamp: timestampMs,
              source: 'web-gpu-texture', // Treating MPMask as web-gpu-texture equivalent for now
              data: mask
            };
          }
          
          return {
            landmarks: rawLandmarks.map((pt: any) => ({
              x: pt.x,
              y: pt.y,
              z: pt.z || 0,
              visibility: pt.visibility !== undefined ? pt.visibility : (pt.presence ?? 0),
            })),
            worldLandmarks: rawWorldLandmarks.map((pt: any) => ({
              x: pt.x,
              y: pt.y,
              z: pt.z || 0,
              visibility: pt.visibility !== undefined ? pt.visibility : (pt.presence ?? 0),
            })),
            segmentation
          };
        }
      }
    } catch (e) {
      console.warn('Pose detection frame error:', e);
    }
    return null;
  }

  close() {
    this.isDisposed = true;
    if (this.poseLandmarker) {
      try {
        this.poseLandmarker.close();
      } catch (_) {}
      this.poseLandmarker = null;
    }
    this.isReady = false;
    this.initPromise = null;
  }
}
