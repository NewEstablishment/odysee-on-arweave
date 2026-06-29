import { IMG_CDN_PUBLISH_URL } from 'constants/cdn_urls';

export default function uploadThumbnail(data: FormData): Promise<any> {
  return fetch(IMG_CDN_PUBLISH_URL, {
    method: 'POST',
    body: data,
  })
    .then((res) => res.text())
    .then(parseUploadResponse);
}

function parseUploadResponse(text: string) {
  try {
    return text.length ? JSON.parse(text) : {};
  } catch {
    throw new Error(text);
  }
}
