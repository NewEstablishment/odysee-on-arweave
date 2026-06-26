import React from 'react';
import Yrbl from 'component/yrbl';
import Button from 'component/button';
import analytics from 'analytics';
import I18nMessage from 'component/i18nMessage';
// import Native from 'native';
// import Lbry from 'lbry';
type Props = {
  children: React.ReactNode;
};
type State = {
  hasError: boolean;
  errorMessage: string | null | undefined;
  errorStack: string | null | undefined;
  sentryEventId: string | null | undefined;
};

class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: undefined,
      errorStack: undefined,
      sentryEventId: undefined,
    };
  }

  static getDerivedStateFromError() {
    return {
      hasError: true,
    };
  }

  componentWillUnmount() {
    clearTimeout(this.retryTimer);
  }

  private retryTimer: any;
  private retryCount = 0;
  private reloading = false;

  scheduleRetry() {
    this.retryCount++;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.setState({ hasError: false, errorMessage: undefined, errorStack: undefined, sentryEventId: undefined });
    }, 200);
  }

  componentDidCatch(error, errorInfo) {
    const errorMessage = error?.message || error?.toString?.() || 'Unknown error';
    const errorStack = error?.stack || '';
    console.error('[ErrorBoundary] Caught:', error?.message, error?.stack); // eslint-disable-line no-console
    this.setState({ errorMessage, errorStack });

    if (error?.name === 'NotFoundError' || error?.message?.includes('object can not be found')) {
      this.setState({ hasError: false, errorMessage: undefined, errorStack: undefined });
      return;
    }
    if (
      error?.message &&
      /[._]result\.default|reading 'default'|_result is undefined|evaluating.*_result|Lazy element type must resolve|Received a promise that resolves to: undefined|Minified React error #306|undefined is not an object \(evaluating '\$?\w+\.(use[A-Z]|jsxs?|jsxDEV|Fragment|createElement|cloneElement|forwardRef|memo)/.test(
        error.message
      )
    ) {
      clearTimeout(this.retryTimer);
      const key = `__staleChunkReload:${window.location.pathname}`;
      let reloadAllowed = false;
      try {
        const prev = sessionStorage.getItem(key);
        const now = Date.now();
        if (!prev || now - Number(prev) > 30000) {
          sessionStorage.setItem(key, String(now));
          reloadAllowed = true;
        }
      } catch {}

      if (reloadAllowed) {
        this.reloading = true;
        this.retryCount = 999;
        window.location.reload();
        return;
      }

      this.reloading = false;
      this.retryCount = 5;
      this.setState({ hasError: true, errorMessage, errorStack, sentryEventId: null });
      return;
    }

    if (this.retryCount < 5) {
      this.scheduleRetry();
      return;
    }

    try {
      sessionStorage.setItem(
        '__errorBoundary',
        JSON.stringify({ message: error?.message, stack: error?.stack?.substring(0, 500) })
      );
    } catch {} // eslint-disable-line no-console
    analytics.sentryError(error, errorInfo).then((sentryEventId) => {
      this.setState({
        sentryEventId,
      });
    });
  }

  refresh = () => {
    // Use replace so the user can't click back to the errored page.
    window.location.replace(window.location.href);
    this.setState({
      hasError: false,
    });
  };

  render() {
    const { hasError } = this.state;
    const { sentryEventId } = this.state;
    const { errorMessage } = this.state;
    const { errorStack } = this.state;
    const errorWasReported = Boolean(sentryEventId);
    const errorDebugAttrs =
      process.env.NODE_ENV !== 'production'
        ? {
            'data-error-boundary-message': errorMessage || '',
            'data-error-boundary-stack': errorStack || '',
          }
        : {};

    if (hasError && (this.retryCount < 5 || this.reloading)) {
      return (
        <div
          className="main--empty"
          {...errorDebugAttrs}
          data-error-boundary-retry-count={this.retryCount}
          data-error-boundary-reloading={this.reloading ? 'true' : 'false'}
        >
          {__('Loading...')}
        </div>
      );
    }

    if (hasError) {
      return (
        <div className="main main--full-width main--empty" {...errorDebugAttrs}>
          <Yrbl
            type="sad"
            title={__('Aw shucks!')}
            subtitle={
              <I18nMessage
                tokens={{
                  refreshing_the_app_link: (
                    <Button
                      button="link"
                      className="load-screen__button"
                      label={__('refreshing the app')}
                      onClick={this.refresh}
                    />
                  ),
                }}
              >
                There was an error. Try %refreshing_the_app_link% to fix it. If that doesn't work, try pressing
                Ctrl+R/Cmd+R.
              </I18nMessage>
            }
          />
          {!errorWasReported && (
            <div className="error__wrapper">
              <span className="error__text">
                {__('You are not currently sharing diagnostic data so this error was not reported.')}
              </span>
            </div>
          )}

          {errorWasReported && (
            <div className="error__wrapper">
              <span className="error__text">
                {__('Error ID: %sentryEventId%', {
                  sentryEventId,
                })}
              </span>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
export default ErrorBoundary;
