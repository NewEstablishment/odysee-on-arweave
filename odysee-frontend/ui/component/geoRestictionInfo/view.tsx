import React from 'react';
import Card from 'component/common/card';
import Icon from 'component/common/icon';
import Tooltip from 'component/common/tooltip';
import * as ICONS from 'constants/icons';
import * as MODALS from 'constants/modal_types';
import { parseURI } from 'util/lbryURI';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { selectGeoRestrictionForUri } from 'redux/selectors/claims';
import { doOpenModal } from 'redux/actions/app';

type Props = {
  uri: string;
};
export default function GeoRestrictionInfo(props: Props) {
  const { uri } = props;

  const dispatch = useAppDispatch();
  const geoRestriction = useAppSelector((state) => selectGeoRestrictionForUri(state, uri));

  if (!geoRestriction) {
    return null;
  }

  const { isChannel } = parseURI(uri);

  const title = __(isChannel ? 'Channel unavailable' : 'Content unavailable');

  const msg = <Card title={title} subtitle={__(geoRestriction.message || '')} />;

  function showMsg() {
    dispatch(
      doOpenModal(MODALS.CONFIRM, {
        title: title,
        subtitle: __(geoRestriction.message || ''),
        onConfirm: (closeModal) => closeModal(),
        hideCancel: true,
      })
    );
  }

  return (
    <Tooltip title={msg} followCursor>
      <div
        className="tw:my-app-m tw:flex tw:flex-col tw:items-center tw:rounded-app tw:bg-app-card tw:text-[#e2495e]"
        onClick={showMsg}
      >
        <div className="tw:my-app-l tw:flex tw:items-center">
          <Icon icon={ICONS.EYE_OFF} size={24} />
          <span className="tw:ml-app-s tw:text-app-large tw:italic">{title}</span>
        </div>
      </div>
    </Tooltip>
  );
}
