import { hyperbeamNodeBase } from 'util/hyperbeamDevices';
import { uploadNativeImage } from 'util/nativeImageUpload';

export async function uploadProfileImage(file: File): Promise<string> {
  const { id } = await uploadNativeImage(file, hyperbeamNodeBase());
  return id;
}
