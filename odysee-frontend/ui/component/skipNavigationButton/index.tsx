import React from 'react';
import Button from 'component/button'; // Allow screen reader users ( or keyboard navigation )
// to jump to main content

const skipNavigation = (e) => {
  // Match any focusable element
  const focusableElementQuery = `
    #main-content [tabindex]:not([tabindex="-1"]):not(:disabled),
    #main-content a:not([aria-hidden]):not([tabindex="-1"]):not(:disabled),
    #main-content button:not([aria-hidden]):not([tabindex="-1"]):not(:disabled)
  `;
  // Find first focusable element
  const element = document.querySelector(focusableElementQuery);

  // Trigger focus to skip navigation
  if (element && (element as HTMLElement).focus) {
    (element as HTMLElement).focus();
  }
};

export default function SkipNavigationButton() {
  return (
    <Button
      className="tw:absolute tw:top-0 tw:left-0 tw:mr-app-l tw:h-0 tw:w-0 tw:overflow-hidden tw:opacity-0 tw:focus:relative tw:focus:h-auto tw:focus:w-auto tw:focus:overflow-visible tw:focus:opacity-100"
      onClick={skipNavigation}
      label={__('Skip Navigation')}
      button="link"
    />
  );
}
