/**
 * Client-side transparent background extractor for web / local preview.
 * Floodfills or samples corner background pixels and converts uniform / near-white background pixels to transparent alpha.
 */
export async function removeBackgroundWeb(imageUri: string, tolerance: number = 32): Promise<string> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return imageUri;
  }

  return new Promise((resolve) => {
    const img = new (window as any).Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(imageUri);
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const width = canvas.width;
        const height = canvas.height;

        // Sample 4 corner pixels to determine background reference color
        const corners = [
          [0, 0],
          [width - 1, 0],
          [0, height - 1],
          [width - 1, height - 1],
        ];

        let bgR = 0, bgG = 0, bgB = 0, sampleCount = 0;
        corners.forEach(([cx, cy]) => {
          const idx = (cy * width + cx) * 4;
          if (data[idx + 3] > 10) { // not already transparent
            bgR += data[idx];
            bgG += data[idx + 1];
            bgB += data[idx + 2];
            sampleCount++;
          }
        });

        if (sampleCount === 0) {
          resolve(canvas.toDataURL('image/png'));
          return;
        }

        bgR = Math.round(bgR / sampleCount);
        bgG = Math.round(bgG / sampleCount);
        bgB = Math.round(bgB / sampleCount);

        // Remove background color with smooth alpha falloff
        const tolSq = tolerance * tolerance;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const distSq = (r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2;

          if (distSq < tolSq) {
            // Fully transparent
            data[i + 3] = 0;
          } else if (distSq < tolSq * 2.2) {
            // Soft anti-aliased edge
            const factor = (distSq - tolSq) / (tolSq * 1.2);
            data[i + 3] = Math.round(data[i + 3] * factor);
          }
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Web background removal error, falling back to original image:', err);
        resolve(imageUri);
      }
    };

    img.onerror = () => {
      resolve(imageUri);
    };

    img.src = imageUri;
  });
}
