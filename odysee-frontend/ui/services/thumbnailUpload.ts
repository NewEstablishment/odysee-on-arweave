import { HYPERBEAM_COMMITTED_WRITE_PATH, committedWriteId, hyperbeamNodeBase } from 'util/hyperbeamDevices';

// A thumbnail is just bytes. Store it through the same committed-write endpoint
// as a video and reference the node-served image by its id. The
// legacy /$/api/hyperbeam-thumbnail endpoint does not exist on a HyperBEAM node.
export default async function uploadThumbnail(data: FormData): Promise<any> {
  const file = data.get('file-input');
  if (!(file instanceof Blob)) throw new Error('Thumbnail upload requires a file.');

  const base = hyperbeamNodeBase();
  if (!base) throw new Error('No HyperBEAM node configured for thumbnail upload.');

  const response = await fetch(`${base}/${HYPERBEAM_COMMITTED_WRITE_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': file.type || 'image/jpeg',
    },
    body: file,
  });

  let id = '';
  if (response.ok) {
    try {
      id = committedWriteId(await response.json());
    } catch (e) {}
  }
  if (!response.ok || !id) {
    throw new Error(`Thumbnail upload failed (${response.status}).`);
  }

  return { type: 'success', message: `${base}/${id}` };
}
