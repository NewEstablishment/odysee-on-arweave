import {
  HYPERBEAM_BASE_URL,
  IMAGE_PROXY_URL,
  ODYSEE_HYPERBEAM_NODE_API,
  THUMBNAIL_CDN_URL,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
  THUMBNAIL_QUALITY,
} from 'config';
import { directImageUrl } from 'util/thumbnailProxy';
type Props = {
  thumbnail: string | null | undefined;
  height?: number;
  width?: number;
  quality?: number;
  isShorts?: boolean;
};
export function getThumbnailCdnUrl(props: Props) {
  const {
    thumbnail,
    height = THUMBNAIL_HEIGHT,
    width = THUMBNAIL_WIDTH,
    quality = THUMBNAIL_QUALITY,
    isShorts = false,
  } = props;

  if (!thumbnail || typeof thumbnail !== 'string') {
    return typeof thumbnail === 'string' ? thumbnail : null;
  }

  const directUrl = directImageUrl(thumbnail, trustedImageBases(), hyperbeamImagesDirect());
  if (directUrl) return directUrl;
  if (!THUMBNAIL_CDN_URL) return thumbnail;

  if (thumbnail.includes(THUMBNAIL_CDN_URL)) {
    return thumbnail;
  }

  if (thumbnail.includes('static.odycdn.com/emoticons/')) {
    return thumbnail;
  }

  if (thumbnail) {
    if (isShorts) {
      return `${THUMBNAIL_CDN_URL}s:900:0/quality:${quality}/plain/${thumbnail}`;
    }

    return `${THUMBNAIL_CDN_URL}s:${width}:${height}/quality:${quality}/plain/${thumbnail}`;
  }
}
export function getImageProxyUrl(thumbnail: string | null | undefined) {
  const directUrl =
    typeof thumbnail === 'string' ? directImageUrl(thumbnail, trustedImageBases(), hyperbeamImagesDirect()) : null;
  if (directUrl) return directUrl;
  if (
    IMAGE_PROXY_URL &&
    thumbnail &&
    typeof thumbnail === 'string' &&
    !thumbnail.startsWith(THUMBNAIL_CDN_URL) &&
    !thumbnail.startsWith(IMAGE_PROXY_URL)
  ) {
    return `${IMAGE_PROXY_URL}?${thumbnail}`;
  }

  return typeof thumbnail === 'string' ? thumbnail : null;
}

function hyperbeamImagesDirect() {
  return Boolean(HYPERBEAM_BASE_URL || ODYSEE_HYPERBEAM_NODE_API);
}

function trustedImageBases(): Array<string> {
  return [
    HYPERBEAM_BASE_URL,
    ODYSEE_HYPERBEAM_NODE_API,
    typeof window !== 'undefined' ? window.location.origin : '',
  ].filter(Boolean);
}
