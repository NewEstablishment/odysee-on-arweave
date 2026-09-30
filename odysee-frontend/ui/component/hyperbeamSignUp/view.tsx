// HyperBEAM-native sign up: a name creates a cookie identity on the node. No
// email, password, or web2 backend. See util/hyperbeamAccount.
import { ERROR_TEXT_CLASS } from 'component/common/error-classes';
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FormField, Form } from 'component/common/form';
import Button from 'component/button';
import Card from 'component/common/card';
import { signUpHyperbeam } from 'util/hyperbeamAccount';
import { SECTION_CLASSES } from 'component/common/section-classes';
import { PAGE_MAIN_CONTAINED_CLASS } from 'component/page/classes';

export default function HyperbeamSignUp() {
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const redirectTo = new URLSearchParams(location.search).get('redirect') || '/';

  async function onSubmit() {
    setError(null);
    setPending(true);
    try {
      await signUpHyperbeam(name);
      navigate(redirectTo);
      window.location.reload();
    } catch (e: any) {
      setError(e?.message || __('Something went wrong. Please try again.'));
      setPending(false);
    }
  }

  return (
    <div className={PAGE_MAIN_CONTAINED_CLASS}>
      <Card
        title={__('Create your account')}
        subtitle={__(
          'Pick a name. Your identity lives on this HyperBEAM node as a signed cookie, no email, no password.'
        )}
        actions={
          <Form onSubmit={onSubmit}>
            <FormField
              type="text"
              name="hyperbeam_name"
              label={__('Name')}
              placeholder={__('yourname')}
              value={name}
              disabled={pending}
              onChange={(e) => setName(e.target.value)}
            />
            {error && <p className={ERROR_TEXT_CLASS}>{error}</p>}
            <div className={SECTION_CLASSES.actions}>
              <Button
                button="primary"
                type="submit"
                disabled={pending || !name.trim()}
                label={pending ? __('Creating…') : __('Create account')}
              />
            </div>
          </Form>
        }
      />
    </div>
  );
}
