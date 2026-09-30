import React from 'react';
import QRCode from 'component/common/qr-code';
import CopyableText from 'component/copyableText';

type Props = {
  address: string;
  children: React.ReactNode;
};

export default function ReceiveAddressLayout({ address, children }: Props) {
  return (
    <div className="tw:flex tw:items-[unset]">
      <div className="tw:mr-app-m tw:rounded-app tw:bg-app-background tw:p-app-s">
        <QRCode className="tw:!size-[206px] tw:[&_canvas]:!size-full" value={address} />
        <div className="tw:mt-app-s tw:flex tw:w-full tw:justify-center tw:text-app-xxxsmall tw:[&_fieldset-section]:w-full tw:[&_fieldset-section_button]:h-[16px] tw:[&_fieldset-section_button]:bg-[var(--color-header-button)] tw:[&_fieldset-section_button]:px-app-xxxs tw:[&_fieldset-section_button]:py-app-s tw:[&_fieldset-section_input]:h-[16px] tw:[&_fieldset-section_input]:bg-[var(--color-header-button)] tw:[&_fieldset-section_input]:px-app-xxxs tw:[&_fieldset-section_input]:py-app-s">
          <CopyableText copyable={address} />
        </div>
      </div>
      {children}
    </div>
  );
}
