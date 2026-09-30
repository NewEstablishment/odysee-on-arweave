import React from 'react';
import * as ICONS from 'constants/icons';
import Button from 'component/button';
import { useAppDispatch } from 'redux/hooks';
import { doMembershipClearData } from 'redux/actions/memberships';

const isDev = process.env.NODE_ENV !== 'production';
const MEMBERSHIP_BUTTON_CLASS = String.raw`tw:mt-[10px] tw:mb-[18px] tw:block tw:[.my-membership\_\_div_&]:max-w-[279px]`;
type Props = {
  purchasedMemberships?: any | null | undefined;
};

const ClearMembershipDataButton = (props: Props) => {
  const { purchasedMemberships } = props;
  const dispatch = useAppDispatch();

  return (
    isDev &&
    (!purchasedMemberships || purchasedMemberships?.length > 0) && (
      <>
        <h1
          style={{
            marginTop: '30px',
            fontSize: '20px',
          }}
        >
          Clear Membership Data (Only Available On Dev)
        </h1>
        <div>
          <Button
            button="primary"
            label="Clear Membership Data"
            icon={ICONS.SETTINGS}
            className={MEMBERSHIP_BUTTON_CLASS}
            onClick={() => dispatch(doMembershipClearData())}
          />
        </div>
      </>
    )
  );
};

export default ClearMembershipDataButton;
