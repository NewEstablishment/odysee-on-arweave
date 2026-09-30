import React from 'react';
import Button from 'component/button';
import Card from 'component/common/card';
import Spinner from 'component/spinner';
import { Modal } from 'modal/modal';
import { useAppDispatch } from 'redux/hooks';
import { doHideModal } from 'redux/actions/app';
import { SECTION_CLASSES } from 'component/common/section-classes';
type Props = {
  pendingActions: Array<string>;
  onConfirm: () => void;
};
export default function ModalSignOut(props: Props) {
  const { pendingActions, onConfirm } = props;
  const dispatch = useAppDispatch();
  const hideModal = () => dispatch(doHideModal());
  const [isBusy, setIsBusy] = React.useState(false);

  function handleOnClick() {
    if (onConfirm) {
      setIsBusy(true);
      onConfirm();
    }
  }

  return (
    <Modal isOpen type="custom">
      <Card
        title={__('Sign Out')}
        body={
          <div>
            <p className={SECTION_CLASSES.subtitle}>{__('There are pending actions.')}</p>
            <div className="section tw:rounded-[var(--card-radius)] tw:border tw:border-app-border tw:p-app-s">
              <ul>
                {pendingActions.map((x) => (
                  <li className="tw:relative tw:my-app-xs tw:mr-app-m tw:ml-app-l tw:list-outside" key={x}>
                    {x}
                  </li>
                ))}
              </ul>
            </div>
            <p className={SECTION_CLASSES.subtitle}>{__('Do you want to proceed with signing out?')}</p>
          </div>
        }
        actions={
          <div className={SECTION_CLASSES.actions}>
            <Button
              button="primary"
              label={isBusy ? <Spinner type="small" /> : __('Sign Out')}
              disabled={isBusy}
              onClick={handleOnClick}
            />

            <Button button="link" label={__('Cancel')} disabled={isBusy} onClick={hideModal} />
          </div>
        }
      />
    </Modal>
  );
}
