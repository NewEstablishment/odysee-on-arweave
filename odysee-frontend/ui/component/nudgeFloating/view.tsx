import * as ICONS from 'constants/icons';
import React from 'react';
import usePersistedState from 'effects/use-persisted-state';
import Button from 'component/button';
import { useAppSelector } from 'redux/hooks';
import { selectUser } from 'redux/selectors/user';
import { NUDGE_CLASSES as C } from './classes';
type Props = {
  name: string;
  text: string;
};
export default function NudgeFloating(props: Props) {
  const { name, text } = props;
  const user = useAppSelector(selectUser);
  const [showNudge, setShowNudge] = React.useState(false);
  const [nudgeAcknowledged, setNudgeAcknowledged] = usePersistedState(name, false);
  const emailVerified = user && user.has_verified_email;
  React.useEffect(() => {
    if (!emailVerified && !nudgeAcknowledged) {
      setShowNudge(true);
    }
  }, [emailVerified, nudgeAcknowledged]);
  return (
    showNudge && (
      <div className={C.root}>
        <div className={C.wrapper}>
          <span className={C.text}>{text}</span>
          <Button
            className="nudge__close"
            button="close"
            icon={ICONS.REMOVE}
            onClick={() => {
              setNudgeAcknowledged(true);
              setShowNudge(false);
            }}
          />
        </div>
      </div>
    )
  );
}
