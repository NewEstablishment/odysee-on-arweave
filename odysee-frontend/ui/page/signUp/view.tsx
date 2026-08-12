import React from 'react';
import UserSignUp from 'component/userSignUp';
import HyperbeamSignUp from 'component/hyperbeamSignUp';
import Page from 'component/page';
import { hyperbeamNodeEnabled } from 'util/hyperbeamDevices';
export default function SignUpPage() {
  return (
    <Page authPage noFooter>
      {hyperbeamNodeEnabled() ? <HyperbeamSignUp /> : <UserSignUp />}
    </Page>
  );
}
