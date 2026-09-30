import React, { useEffect } from 'react';
import Button from 'component/button';
import * as PAGES from 'constants/pages';
import { useLocation } from 'react-router-dom';
import classnames from 'classnames';
import { FOOTER_CLASSES, PORTAL_FOOTER_CLASS, SHORTS_FOOTER_CLASS } from 'component/footerClasses';

export default function Footer() {
  useEffect(() => {
    const maxTimeout = 2000;
    let elapsedTime = 0;

    function checkForOneTrust() {
      elapsedTime = elapsedTime + 500;
      if (elapsedTime > maxTimeout) return;

      if (!window.Optanon) {
        window.setTimeout(checkForOneTrust, 500);
      } else {
        const privacyFooterButton = document.getElementById('gdprPrivacyFooter');
        if (privacyFooterButton) privacyFooterButton.style.display = 'block';
      }
    }

    checkForOneTrust();
  }, []);
  const { pathname, search } = useLocation();
  const urlParams = new URLSearchParams(search);
  const isShorts = urlParams.get('view') === 'shorts';
  const isPortal = pathname.startsWith(`/$/${PAGES.PORTAL}/`);

  return (
    <footer
      className={classnames(FOOTER_CLASSES.root, {
        [SHORTS_FOOTER_CLASS]: isShorts,
        [PORTAL_FOOTER_CLASS]: isPortal,
      })}
    >
      <ul className={`${FOOTER_CLASSES.links} tw:mt-app-m`}>
        <li className={FOOTER_CLASSES.link}>
          <Button
            label={__('Community Guidelines')}
            href="https://help.odysee.tv/communityguidelines/"
            target="_blank"
          />
        </li>
        <li className={FOOTER_CLASSES.link}>
          <Button label={__('FAQ')} href="https://help.odysee.tv/" target="_blank" />
        </li>
        <li className={FOOTER_CLASSES.link}>
          <Button label={__('Support --[used in footer; general help/support]--')} href="https://help.odysee.tv/" />
        </li>
        <li className={FOOTER_CLASSES.link}>
          <Button label={__('Contribute')} navigate={`/$/${PAGES.CONTRIBUTE}`} />
        </li>
        <li className={FOOTER_CLASSES.link}>
          <Button label={__('Terms')} href="https://odysee.com/$/tos" />
        </li>
        <li className={FOOTER_CLASSES.link}>
          <Button label={__('Privacy Policy')} href="https://odysee.com/$/privacypolicy" />
        </li>
        <li className={FOOTER_CLASSES.link}>
          <Button label={__('IP Geolocation by DB-IP')} href="https://db-ip.com" target="_blank" />
        </li>
        <li className={FOOTER_CLASSES.link} id="gdprPrivacyFooter">
          <Button label={__('Cookie Settings')} onClick={() => window.Optanon && window.Optanon.ToggleInfoDisplay()} />
        </li>
      </ul>
    </footer>
  );
}
