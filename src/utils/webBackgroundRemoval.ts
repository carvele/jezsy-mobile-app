/**
 * Client-side transparent background extractor for web / local preview.
 * Removes edge-connected background pixels using a colour tolerance inferred from the image border.
 */
export async function removeBackgroundWeb(imageUri: string): Promise<string> {
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

        const edgePixels: number[] = [];
        for (let x = 0; x < width; x++) {
          edgePixels.push(x, (height - 1) * width + x);
        }
        for (let y = 1; y < height - 1; y++) {
          edgePixels.push(y * width, y * width + width - 1);
        }

        let bgR = 0, bgG = 0, bgB = 0, sampleCount = 0;
        edgePixels.forEach((pixel) => {
          const idx = pixel * 4;
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

        const distances = edgePixels.map((pixel) => {
          const index = pixel * 4;
          return Math.hypot(data[index] - bgR, data[index + 1] - bgG, data[index + 2] - bgB);
        }).sort((a, b) => a - b);
        const tolerance = Math.min(105, Math.max(42, distances[Math.floor(distances.length * 0.9)] + 24));
        const visited = new Uint8Array(width * height);
        const pending = [...edgePixels];

        while (pending.length > 0) {
          const pixel = pending.pop()!;
          if (visited[pixel]) continue;
          visited[pixel] = 1;
          const index = pixel * 4;
          const distance = Math.hypot(data[index] - bgR, data[index + 1] - bgG, data[index + 2] - bgB);
          if (data[index + 3] <= 10 || distance > tolerance) continue;

          data[index + 3] = 0;
          const x = pixel % width;
          const y = Math.floor(pixel / width);
          if (x > 0) pending.push(pixel - 1);
          if (x < width - 1) pending.push(pixel + 1);
          if (y > 0) pending.push(pixel - width);
          if (y < height - 1) pending.push(pixel + width);
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
