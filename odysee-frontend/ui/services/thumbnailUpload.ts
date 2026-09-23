import { hyperbeamNodeBase } from 'util/hyperbeamDevices';
import { uploadNativeImage } from 'util/nativeImageUpload';

// A thumbnail is just bytes. Store it through the same committed-write endpoint
// as a video (a stage-0 committed POST /id) and reference the node-served image by its id. The
// legacy /$/api/hyperbeam-thumbnail endpoint does not exist on a HyperBEAM node.
export default async function uploadThumbnail(data: FormData): Promise<{ type: 'success'; message: string }> {
  const file = data.get('file-input');
  if (!(file instanceof Blob)) throw new Error('Thumbnail upload requires a file.');

  // The thumbnail picker already supports GIF; profiles deliberately do not.
  const { url } = await uploadNativeImage(file, hyperbeamNodeBase(), true);
  return { type: 'success', message: url };
}
