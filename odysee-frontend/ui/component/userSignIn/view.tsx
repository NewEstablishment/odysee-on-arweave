import React from 'react';
import UserEmailReturning from 'component/userEmailReturning';
import UserSignInPassword from 'component/userSignInPassword';
import Spinner from 'component/spinner';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from 'redux/hooks';
import { selectUser, selectUserIsPending, selectEmailToVerify, selectPasswordExists } from 'redux/selectors/user';
import { doUserSignIn } from 'redux/actions/user';
import Button from 'component/button';
import Card from 'component/common/card';
import { recoverHyperbeamAccount } from 'util/hyperbeamAccount';
import { hyperbeamNodeEnabled } from 'util/hyperbeamDevices';

function HyperbeamSignIn() {
  const location = useLocation();
  const navigate = useNavigate();
  const redirect = new URLSearchParams(location.search).get('redirect') || '/';
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    setIsPending(true);
    try {
      const account = await recoverHyperbeamAccount();
      if (!account) {
        setError(__('No account is associated with this browser session.'));
        return;
      }
      navigate(redirect, { replace: true });
      window.location.reload();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : __('Unable to log in.'));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="main--contained">
      <Card
        title={__('Log In')}
        actions={
          <div>
            {error && <p className="error__text">{error}</p>}
            <div className="section__actions">
              <Button
                button="primary"
                label={isPending ? __('Logging In...') : __('Log In')}
                disabled={isPending}
                onClick={handleLogin}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}

function LegacySignIn() {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectUser);
  const userFetchPending = useAppSelector(selectUserIsPending);
  const emailToVerify = useAppSelector(selectEmailToVerify);
  const passwordExists = useAppSelector(selectPasswordExists);
  const { search } = location;
  const urlParams = new URLSearchParams(search);
  const [emailOnlyLogin, setEmailOnlyLogin] = React.useState(false);
  const hasVerifiedEmail = user && user.has_verified_email;
  const redirect = urlParams.get('redirect');
  const showLoading = userFetchPending;
  const showEmail = !passwordExists || emailOnlyLogin;
  const showPassword = !showEmail && emailToVerify && passwordExists;
  React.useEffect(() => {
    if (hasVerifiedEmail || (!showEmail && !showPassword && !showLoading)) {
      navigate(redirect || '/', { replace: true });
    } // eslint-disable-next-line react-hooks/exhaustive-deps -- @see TODO_NEED_VERIFICATION
  }, [hasVerifiedEmail, navigate, redirect, showEmail, showLoading, showPassword]);
  React.useEffect(() => {
    if (emailToVerify && emailOnlyLogin) {
      dispatch(doUserSignIn(emailToVerify, undefined));
    }
  }, [emailToVerify, emailOnlyLogin, dispatch]);
  return (
    <section>
      {(showEmail || showPassword) && (
        <div>
          {showEmail && <UserEmailReturning />}
          {showPassword && <UserSignInPassword onHandleEmailOnly={() => setEmailOnlyLogin(true)} />}
        </div>
      )}
      {!showEmail && !showPassword && showLoading && (
        <div className="main--empty">
          <Spinner delayed />
        </div>
      )}
    </section>
  );
}

function UserSignIn() {
  const [useBrowserSession, setUseBrowserSession] = React.useState(false);

  if (!hyperbeamNodeEnabled()) return <LegacySignIn />;

  return (
    <>
      {useBrowserSession ? <HyperbeamSignIn /> : <LegacySignIn />}
      <div className="section__actions section__actions--centered">
        <Button
          button="link"
          label={useBrowserSession ? __('Use email and password') : __('Use HyperBEAM browser session')}
          onClick={() => setUseBrowserSession((current) => !current)}
        />
      </div>
    </>
  );
}

export default UserSignIn;
