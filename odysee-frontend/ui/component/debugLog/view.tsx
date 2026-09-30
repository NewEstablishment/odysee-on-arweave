import React from 'react';
import classnames from 'classnames';
import Button from 'component/button';
import { useAppSelector, useAppDispatch } from 'redux/hooks';
import { doClearDebugLog } from 'redux/actions/notifications';
import { selectDebugLog } from 'redux/selectors/notifications';

const DEBUG_PRE_CLASS = 'tw:ml-app-l tw:whitespace-pre-wrap tw:text-app-small tw:text-app-text-subtitle';

function getMessageElem(info: string | Error) {
  return info instanceof Error || typeof info === 'object' ? <p>{info.message}</p> : <p>{info}</p>;
}

function getDataElem(info: string | Error) {
  let cause;

  if (info instanceof Error && info.cause) {
    if (info.cause instanceof Error) {
      cause = info.cause.toString();
    } else {
      try {
        cause = JSON.stringify(info.cause, null, 2);
      } catch {}
    }
  }

  return cause ? <pre className={DEBUG_PRE_CLASS}>{cause}</pre> : null;
}

function getStackTraceElem(info: string | Error) {
  if (info instanceof Error && info.stack) {
    const allLines: Array<string> = info.stack.split('\n');
    const lines: Array<string> = allLines.filter((x) => {
      return (
        !x.startsWith('Error: ') &&
        !x.includes('ui/asserts.js') &&
        !x.includes('at doAssert') &&
        !x.includes('at assert') &&
        !x.includes('at eval') &&
        !x.includes('/node_modules/') &&
        !x.includes('bindActionCreators.js')
      );
    });
    return <pre className={DEBUG_PRE_CLASS}>{lines.slice(0, 3).join('\n')}</pre>;
  }
}

function DebugLog() {
  const dispatch = useAppDispatch();
  const debugLog = useAppSelector(selectDebugLog);

  const [show, setShow] = React.useState(false);
  const [count, setCount] = React.useState(0);

  React.useEffect(() => {
    if (count !== debugLog.length) {
      setCount(debugLog.length);
      setShow(true);
    }
  }, [count, debugLog]);
  return (
    <div
      className={classnames(
        {
          'tw:bottom-0': show,
          'tw:bottom-[-50%]': !show,
        },
        'tw:fixed tw:right-0 tw:left-0 tw:z-[888] tw:mx-app-l tw:h-[40%] tw:overflow-y-auto tw:rounded-app tw:bg-app-card-highlighted tw:px-app-l tw:py-app-m tw:text-app-body tw:[box-shadow:0_0_var(--spacing-m)_rgba(var(--color-text-base),0.3)] tw:[transition:bottom_0.5s_ease-in-out]'
      )}
    >
      {debugLog.map((x, index) => (
        <div className="tw:my-app-s tw:border-t tw:border-t-[var(--color-border)] tw:pt-app-xs" key={index}>
          {getMessageElem(x)}
          {getDataElem(x)}
          {getStackTraceElem(x)}
        </div>
      ))}
      <div className="tw:absolute tw:top-app-m tw:right-app-m tw:bg-app-card-highlighted tw:pb-app-m tw:pl-app-m">
        <Button className="tw:ml-app-m" button="link" label={'Clear'} onClick={() => dispatch(doClearDebugLog())} />
        <Button className="tw:ml-app-m" button="secondary" label={'X'} onClick={() => setShow(false)} />
      </div>
    </div>
  );
}

export default DebugLog;
