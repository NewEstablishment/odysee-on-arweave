import React from 'react';
import classnames from 'classnames';
import { QRCodeSVG } from 'qrcode.react';
import { QR_CODE_CLASSES } from './qr-code-classes';
type Props = {
  value: string;
  paddingRight?: boolean;
  paddingTop?: boolean;
  className?: string;
};

function QRCode({ value, paddingRight = false, paddingTop = false, className }: Props) {
  return (
    <div
      data-qr-code
      className={classnames(
        QR_CODE_CLASSES.root,
        {
          [QR_CODE_CLASSES.rightPadding]: paddingRight,
          [QR_CODE_CLASSES.topPadding]: paddingTop,
        },
        className
      )}
    >
      <QRCodeSVG value={value} />
    </div>
  );
}

export default QRCode;
