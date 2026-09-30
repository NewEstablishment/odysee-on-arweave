import React from 'react';
import classnames from 'classnames';
import * as ICONS from 'constants/icons';
import Icon from 'component/common/icon';
import Button from 'component/button';
import Spinner from 'component/spinner';

const WIZARD_STEP_CLASS_NAME =
  'tw:flex tw:flex-1 tw:items-center tw:justify-center tw:gap-app-xs tw:whitespace-nowrap tw:px-app-m tw:py-app-s tw:text-app-body tw:text-app-text tw:[border-top:0] tw:[border-right:1px_solid_var(--color-border)] tw:[border-bottom:0] tw:[border-left:0] tw:last:[border-right:0] tw:enabled:hover:bg-[var(--color-header-button)] tw:upto-small:p-app-xs';
const WIZARD_STEP_NUMBER_CLASS_NAME =
  'tw:flex tw:size-[24px] tw:shrink-0 tw:items-center tw:justify-center tw:rounded-[50%] tw:text-app-xsmall tw:font-bold';

type Step = {
  label: string;
  validate?: () => boolean;
  onInvalid?: () => void;
};

type StepChangeSource = 'next' | 'back' | 'step';

type Props = {
  steps: Step[];
  activeStep: number;
  onStepChange: (step: number, source: StepChangeSource) => void;
  uploadProgress?: number | null;
  children: React.ReactNode;
  onPublish?: () => void;
  publishLabel?: string | React.ReactNode;
  publishDisabled?: boolean;
  publishing?: boolean;
  publishFooterLeft?: React.ReactNode;
};

export default function PublishWizard(props: Props) {
  const {
    steps,
    activeStep,
    onStepChange,
    uploadProgress,
    children,
    onPublish,
    publishLabel,
    publishDisabled,
    publishing,
    publishFooterLeft,
  } = props;

  const isLastStep = activeStep === steps.length - 1;
  const isFirstStep = activeStep === 0;

  function handleNext() {
    if (isLastStep) return;
    const step = steps[activeStep];
    if (step.validate && !step.validate()) {
      step.onInvalid?.();
      return;
    }
    onStepChange(activeStep + 1, 'next');
  }

  function handleBack() {
    if (isFirstStep) return;
    onStepChange(activeStep - 1, 'back');
  }

  function handleStepClick(index: number) {
    if (index === activeStep) return;
    if (index < activeStep) {
      onStepChange(index, 'step');
      return;
    }
    for (let i = activeStep; i < index; i++) {
      const step = steps[i];
      if (step.validate && !step.validate()) {
        step.onInvalid?.();
        return;
      }
    }
    onStepChange(index, 'step');
  }

  const firstInvalidStep = React.useMemo(() => {
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].validate && !steps[i].validate()) return i;
    }
    return steps.length;
  }, [steps, activeStep]); // eslint-disable-line react-hooks/exhaustive-deps

  const panels = React.Children.toArray(children);

  return (
    <div className="tw:flex tw:flex-col">
      <div className="tw:mb-app-m">
        <div className="tw:flex tw:items-center tw:overflow-hidden tw:rounded-app tw:border tw:border-app-border tw:bg-app-card">
          {steps.map((step, i) => {
            const isBlocked = i > activeStep && i > firstInvalidStep;
            return (
              <button
                key={i}
                type="button"
                className={classnames(
                  WIZARD_STEP_CLASS_NAME,
                  i === activeStep ? 'tw:bg-[var(--color-header-button)] tw:font-bold' : 'tw:[background:none]',
                  isBlocked ? 'tw:cursor-default tw:opacity-40' : 'tw:cursor-pointer'
                )}
                onClick={() => handleStepClick(i)}
                disabled={isBlocked}
              >
                <span
                  className={classnames(
                    WIZARD_STEP_NUMBER_CLASS_NAME,
                    i < activeStep
                      ? 'tw:bg-app-primary tw:text-white'
                      : i === activeStep
                        ? 'tw:bg-app-border tw:bg-[image:var(--color-odysee-gradient)] tw:text-white'
                        : 'tw:bg-app-border tw:text-app-text-subtitle'
                  )}
                >
                  {i < activeStep ? <Icon icon={ICONS.COMPLETE} size={12} /> : i + 1}
                </span>
                <span className="tw:upto-small:hidden">{__(step.label)}</span>
              </button>
            );
          })}
        </div>

        {uploadProgress !== null && uploadProgress !== undefined && uploadProgress < 100 && (
          <div className="tw:mt-[-1px] tw:h-[3px] tw:overflow-hidden tw:rounded-[0_0_var(--border-radius)_var(--border-radius)] tw:bg-app-border">
            <div
              className="tw:h-full tw:bg-[image:var(--color-odysee-gradient)] tw:[transition:width_0.3s_ease]"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}
      </div>

      <div className="tw:flex-1">
        <React.Suspense
          fallback={
            <div className="tw:flex tw:min-h-[12rem] tw:items-center tw:justify-center">
              <Spinner type="small" />
            </div>
          }
        >
          {panels[activeStep] || null}
        </React.Suspense>
      </div>

      <div className="tw:mt-app-m tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-app-s tw:upto-small:mb-app-m">
        <div className="tw:flex tw:items-center tw:gap-app-s">
          {!isFirstStep && <Button button="alt" label={__('Back')} onClick={handleBack} />}
        </div>
        <div className="tw:flex tw:items-center tw:gap-app-s">
          {isLastStep ? (
            <div className="tw:flex tw:items-center tw:[&>.button-surface--primary]:rounded-l-none tw:upto-xsmall:w-full tw:upto-xsmall:justify-center">
              {publishFooterLeft}
              <Button
                button="primary"
                label={publishing ? __('Publishing...') : publishLabel || __('Publish')}
                onClick={onPublish}
                disabled={publishDisabled || publishing}
              />
            </div>
          ) : (
            <Button
              button="primary"
              label={__('Next')}
              onClick={handleNext}
              disabled={Boolean(steps[activeStep]?.validate && !steps[activeStep].validate?.())}
            />
          )}
        </div>
      </div>
    </div>
  );
}
