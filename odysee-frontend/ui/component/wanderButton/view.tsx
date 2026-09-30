import React from 'react';
import classnames from 'classnames';
// @ts-ignore
import Icon from 'component/common/icon';
import * as ICONS from 'constants/icons';
import { useArStatus } from 'effects/use-ar-status';
import Tooltip from 'component/common/tooltip';
import Counter from 'component/counter';
import { useNavigate } from 'react-router-dom';
import * as PAGES from 'constants/pages';
import { useAppSelector } from 'redux/hooks';
import { selectArweaveStatus } from 'redux/selectors/arwallet';
type Props = {
  hideBalance: boolean;
};
export default function WanderButton(props: Props) {
  const { hideBalance } = props;
  const arweaveStatus = useAppSelector(selectArweaveStatus);
  const { activeArStatus } = useArStatus();
  const isConnected = !hideBalance && activeArStatus === 'connected';
  const navigate = useNavigate();
  const [backups, setBackups] = React.useState(window?.wanderInstance?.backupInfo?.backupsNeeded || 0);
  React.useEffect(() => {
    if (!window?.wanderInstance?.backupInfo) setBackups(0);
    else setBackups(window?.wanderInstance?.backupInfo?.backupsNeeded);
  }, [arweaveStatus]);

  const handleWalletClick = () => {
    if (backups > 0) window.wanderInstance.open('backup');
    else navigate(`/$/${PAGES.WALLET}`);
  };

  return (
    <Tooltip
      title={
        activeArStatus === 'authenticating'
          ? __('Authenticating...')
          : activeArStatus === 'connected'
            ? arweaveStatus.balance.ar > 0
              ? __('Immediately spendable: $%spendable_balance_usd% (%spendable_balance_ar% AR)', {
                  spendable_balance_usd: (arweaveStatus.balance.ar * arweaveStatus.exchangeRates.ar).toFixed(2),
                  spendable_balance_ar: arweaveStatus.balance.ar.toFixed(6),
                })
              : __('Your Wallet')
            : ''
      }
    >
      <div
        className={classnames(
          "tw:relative tw:flex tw:h-[var(--height-button)] tw:min-w-[var(--height-button)] tw:shrink-0 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-[50%] tw:p-0 tw:mr-app-s tw:text-app-text tw:[transition:border-radius_0.4s,padding_0.4s,max-width_0.4s] tw:before:absolute tw:before:size-full tw:before:box-border tw:before:rounded-[50%] tw:before:border-2 tw:before:border-transparent tw:before:content-[''] tw:before:[animation:wander-button-spin_1s_linear_infinite] tw:before:[mask-image:conic-gradient(from_0deg,black_150%,transparent_250%)] tw:before:[transition:border-color_0.4s] tw:hover:cursor-pointer tw:hover:bg-app-primary tw:hover:text-white",
          {
            'tw:bg-[var(--color-header-button)]': backups === 0,
            'tw:max-w-[var(--height-button)]': !isConnected,
            'tw:before:border-t-[orange]': !hideBalance && activeArStatus === 'authenticating',
            'tw:before:border-t-[green]': !hideBalance && activeArStatus === 'authenticated',
            'tw:max-w-[100px] tw:rounded-app tw:px-app-s tw:before:hidden': isConnected,
            'tw:bg-[rgba(255,0,0,0.1)] tw:[outline:1px_solid_red] tw:[outline-offset:-1px] tw:[&_svg]:ml-app-xxxs tw:[&_svg]:text-[red] tw:hover:[outline:unset] tw:hover:[&_svg]:text-white':
              backups > 0,
          }
        )}
        onClick={handleWalletClick}
      >
        $
        {!hideBalance && activeArStatus === 'connected' ? (
          <Counter
            value={
              arweaveStatus.balance.ar * arweaveStatus.exchangeRates.ar >= 0
                ? arweaveStatus.balance.ar * arweaveStatus.exchangeRates.ar
                : 0
            }
          />
        ) : (
          ''
        )}
        {backups > 0 && activeArStatus === 'connected' && <Icon icon={ICONS.WARNING} />}
      </div>
    </Tooltip>
  );
}
