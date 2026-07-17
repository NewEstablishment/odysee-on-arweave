import { IMG_CDN_PUBLISH_URL } from 'constants/cdn_urls';
import { isHyperbeamFullMode } from 'util/hyperbeamMode';

const HYPERBEAM_THUMBNAIL_UPLOAD_URL = '/$/api/hyperbeam-thumbnail/v1/upload';

export default function uploadThumbnail(data: FormData): Promise<any> {
  if (isHyperbeamFullMode()) return uploadHyperbeamThumbnail(data);

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

async function uploadHyperbeamThumbnail(data: FormData): Promise<any> {
  const file = data.get('file-input');
  if (!(file instanceof Blob)) throw new Error('Thumbnail upload requires a file.');

  const contentBase64 = await blobToBase64(file);
  const response = await fetch(HYPERBEAM_THUMBNAIL_UPLOAD_URL, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      content_base64: contentBase64,
      content_type: file.type || 'image/jpeg',
      filename: file instanceof File ? file.name : undefined,
    }),
  });
  const text = await response.text();
  const json = parseUploadResponse(text);
  if (!response.ok && json.type !== 'error') throw new Error(text || response.statusText);
  return json;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',').pop() || '' : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Unable to read thumbnail.'));
    reader.readAsDataURL(blob);
  });
}
