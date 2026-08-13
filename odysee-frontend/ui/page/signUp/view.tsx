import React from 'react';
import UserSignUp from 'component/userSignUp';
import HyperbeamSignUp from 'component/hyperbeamSignUp';
import Page from 'component/page';
import { hyperbeamUploadEnabled } from 'util/hyperbeamDevices';
export default function SignUpPage() {
  return (
    <Page authPage noFooter>
      {hyperbeamUploadEnabled() ? <HyperbeamSignUp /> : <UserSignUp />}
    </Page>
  );
}
