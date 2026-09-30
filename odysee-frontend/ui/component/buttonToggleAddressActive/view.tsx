import React from 'react';
import ButtonToggle from '../buttonToggle';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectArAccountUpdating, selectArweaveAccountForAddress } from 'redux/selectors/payments';
import { doUpdateArweaveAddressStatus } from 'redux/actions/payments';

type Props = {
  address: string;
  className?: string;
};

function ButtonToggleAddressActive(props: Props) {
  const { address, className } = props;

  const dispatch = useAppDispatch();
  const account = useAppSelector((state) => selectArweaveAccountForAddress(state, address));
  const accountUpdating = useAppSelector(selectArAccountUpdating);

  if (account) {
    const handleClick = () => {
      dispatch(doUpdateArweaveAddressStatus(account.id, account.status === 'active' ? 'inactive' : 'active'));
    };

    return (
      <ButtonToggle
        status={account.status === 'active'}
        setStatus={handleClick}
        busy={accountUpdating}
        className={className}
        tone="address"
      />
    );
  }

  return null;
}

export default ButtonToggleAddressActive;
