// Shared browser preflight for public image bytes. This is a UX safeguard, not
// node-side upload enforcement. Never rewrite the uploaded bytes behind an ID.
export const NATIVE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const NATIVE_IMAGE_MAX_DIMENSION = 8192;

export async function validateNativeImage(file: Blob, allowGif = false): Promise<void> {
  if (file.size === 0 || file.size > NATIVE_IMAGE_MAX_BYTES) throw new Error('Choose an image under 5 MB.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  const gif = ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.slice(0, 6)));
  if (
    !(
      (file.type === 'image/png' && png) ||
      (file.type === 'image/jpeg' && jpeg) ||
      (file.type === 'image/webp' && webp) ||
      (allowGif && file.type === 'image/gif' && gif)
    )
  ) {
    throw new Error(allowGif ? 'Choose a PNG, JPEG, WebP or GIF image.' : 'Choose a PNG, JPEG or WebP image.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (cause) {
    throw new Error('This image could not be decoded. Choose another image.', { cause });
  }
  try {
    if (
      bitmap.width <= 0 ||
      bitmap.height <= 0 ||
      bitmap.width > NATIVE_IMAGE_MAX_DIMENSION ||
      bitmap.height > NATIVE_IMAGE_MAX_DIMENSION
    ) {
      throw new Error('Image dimensions must be at most 8192 × 8192.');
    }
  } finally {
    bitmap.close();
  }
}

export async function uploadNativeImage(
  file: Blob,
  baseUrl: string,
  allowGif = false
): Promise<{ id: string; url: string }> {
  if (!baseUrl) throw new Error('No HyperBEAM node configured for image upload.');
  await validateNativeImage(file, allowGif);
  const base = baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${base}/id?0.%21=true&committers=all`, {
    method: 'POST',
    credentials: 'include',
    redirect: 'error',
    headers: { accept: 'application/json', 'content-type': file.type },
    body: file,
  });
  if (!response.ok) throw new Error(`Image upload failed (${response.status}).`);
  let id: unknown = response.headers.get('message-id');
  if (!id) {
    try {
      id = (await response.json())['message-id'];
    } catch (_) {
      // Missing or malformed acknowledgement is not a successful upload.
    }
  }
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) {
    throw new Error('Image upload returned an invalid ID.');
  }
  return { id, url: `${base}/${id}` };
}
