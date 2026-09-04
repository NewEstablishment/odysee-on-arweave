import React from 'react';
import { SITE_NAME, LOGIN_IMG_URL } from 'config';
import { getThumbnailCdnUrl } from 'util/thumbnail';

function LoginGraphic(props: any) {
  const alt = __('%SITE_NAME% login', {
    SITE_NAME,
  });

  return (
    <div className="signup-image">
      <img alt={alt} src={getThumbnailCdnUrl({ thumbnail: LOGIN_IMG_URL }) || undefined} />
    </div>
  );
}

export default LoginGraphic;
