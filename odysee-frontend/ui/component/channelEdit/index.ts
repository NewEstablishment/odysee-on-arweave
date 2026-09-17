import React from 'react';
import ChannelForm from './view';
import NativeProfileEditor from './native';
import { hyperbeamNodeEnabled } from 'util/hyperbeamDevices';

export default function ChannelEdit(props: { uri?: string; onDone?: () => void; disabled?: boolean }) {
  return hyperbeamNodeEnabled() && props.uri
    ? React.createElement(NativeProfileEditor, { uri: props.uri, onDone: props.onDone })
    : React.createElement(ChannelForm, props);
}
