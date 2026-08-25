/**
 * Safely resolves the content type (MIME) and file extension for an image URI across Web and Mobile.
 * Handles blob URIs (blob:https://domain.com/uuid), data URIs, and local file paths.
 */
export function resolveImageFileInfo(
  uri: string,
  hintContentType?: string | null
): { contentType: string; ext: string } {
  // 1. If explicit valid image MIME type is provided (e.g. from fetch response header or blob.type)
  if (hintContentType && hintContentType.startsWith('image/')) {
    const mime = hintContentType.split(';')[0].trim().toLowerCase();
    let ext = mime.split('/')[1] || 'jpg';
    if (ext === 'jpeg') ext = 'jpg';
    return { contentType: mime, ext };
  }

  // 2. If data URI (e.g. data:image/png;base64,...)
  if (uri.startsWith('data:image/')) {
    const mime = uri.substring(5, uri.indexOf(';')).toLowerCase();
    let ext = mime.split('/')[1] || 'jpg';
    if (ext === 'jpeg') ext = 'jpg';
    return { contentType: mime, ext };
  }

  // 3. If file path has a standard image extension at the very end
  const cleanPath = uri.split('?')[0].split('#')[0];
  const lastDot = cleanPath.lastIndexOf('.');
  const lastSlash = cleanPath.lastIndexOf('/');

  // Ensure dot is in the filename part, not in the domain (e.g. not blob:https://jezsy-app.pages.dev/...)
  if (lastDot > lastSlash && lastDot !== -1) {
    const rawExt = cleanPath.substring(lastDot + 1).toLowerCase();
    const validExts: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      heic: 'image/heic',
    };
    if (validExts[rawExt]) {
      return {
        contentType: validExts[rawExt],
        ext: rawExt === 'jpeg' ? 'jpg' : rawExt,
      };
    }
  }

  // 4. Default fallback
  return { contentType: 'image/jpeg', ext: 'jpg' };
}
