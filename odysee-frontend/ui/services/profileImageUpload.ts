import uploadThumbnail from './thumbnailUpload';

export async function uploadProfileImage(file: File): Promise<string> {
  if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error('Choose an image under 5 MB.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (
    !(
      (file.type === 'image/png' && png) ||
      (file.type === 'image/jpeg' && jpeg) ||
      (file.type === 'image/webp' && webp)
    )
  ) {
    throw new Error('Choose a PNG, JPEG or WebP image.');
  }
  const bitmap = await createImageBitmap(file);
  const valid = bitmap.width > 0 && bitmap.height > 0 && bitmap.width <= 8192 && bitmap.height <= 8192;
  bitmap.close();
  if (!valid) throw new Error('Image dimensions must be at most 8192 × 8192.');
  const data = new FormData();
  data.set('file-input', file);
  const result = await uploadThumbnail(data);
  const id = new URL(result.message).pathname.split('/').pop() || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error('Image upload returned an invalid ID.');
  return id;
}
