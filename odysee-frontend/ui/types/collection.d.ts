/**
 * Collection / playlist types.
 */

type Collection = {
  id: string;
  items: Array<string>;
  name: string;
  type: string;
  updatedAt?: number;
  createdAt?: number;
  sourceId?: string;
  key?: string;
  itemCount?: number;
  visibility?: PlaylistVisibility;
  [key: string]: any;
};

type CollectionEditParams = {
  uris?: Array<string>;
  remove?: boolean;
  replace?: boolean;
  order?: { from: number; to: number };
  type?: string;
  name?: string;
  description?: string;
  thumbnail?: { url: string };
  visibility?: PlaylistVisibility;
  [key: string]: any;
};

type CollectionSaveParams = {
  name: string;
  bid?: string;
  claims: Array<string>;
  title?: string;
  description?: string;
  thumbnail_url?: string;
  tags?: Array<string>;
  languages?: Array<string>;
  channel_id?: string;
  visibility?: PlaylistVisibility;
  [key: string]: any;
};

type CollectionLocalCreateParams = {
  name: string;
  items: Array<string>;
  type: string;
  sourceId?: string;
  visibility?: PlaylistVisibility;
};

type PlaylistVisibility = 'private' | 'public';
type CollectionType = string;
type CollectionState = {
  [key: string]: any;
};
