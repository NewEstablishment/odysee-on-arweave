import React from 'react';
import { formatBytes } from 'util/format-bytes';
import { useAppSelector } from 'redux/hooks';
import { makeSelectMetadataForUri, selectClaimForUri } from 'redux/selectors/claims';
import { makeSelectFileInfoForUri } from 'redux/selectors/file_info';
import { FILE_DETAIL_CLASS } from './classes';
import { EMPTY_CLASS } from 'component/common/empty-classes';

type Props = {
  uri: string;
};

const FileDetails = React.memo(function FileDetails({ uri }: Props) {
  const claim = useAppSelector((state) => selectClaimForUri(state, uri));
  const fileInfo = useAppSelector((state) => makeSelectFileInfoForUri(uri)(state));
  const metadata = useAppSelector((state) => makeSelectMetadataForUri(uri)(state));

  if (!claim || !metadata) {
    return <span className={EMPTY_CLASS}>{__('Empty claim or metadata info.')}</span>;
  }

  const { license, license_url } = metadata;
  const fileSize =
    metadata.source && metadata.source.size
      ? formatBytes(metadata.source.size)
      : fileInfo && fileInfo.download_path && formatBytes(fileInfo.written_bytes);

  return (
    <>
      {license !== 'None' && (
        <div className={FILE_DETAIL_CLASS} data-file-detail>
          <span className="tw:text-app-text">{__('License')}</span>
          <span className="tw:text-app-text-subtitle">{license}</span>
          {license_url && <span className="tw:text-app-text-subtitle">{license_url}</span>}
        </div>
      )}

      {fileSize && (
        <div className={FILE_DETAIL_CLASS} data-file-detail>
          <span className="tw:text-app-text">{__('File size')}</span>
          <span className="tw:text-app-text-subtitle">{fileSize}</span>
        </div>
      )}
    </>
  );
});

export default FileDetails;
