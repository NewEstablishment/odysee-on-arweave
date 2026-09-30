import React from 'react';

// Pick a random animation variant on mount
const VARIANTS = ['signal', 'pulse-rings', 'orbit', 'waveform', 'countdown'] as const;
type Variant = (typeof VARIANTS)[number];

function pickRandom(): Variant {
  return VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
}

type Props = {
  status: 'connecting' | 'requesting_permission';
  onLive?: boolean; // true when transitioning to live
};

const CONNECTING_ROOT_CLASS = 'tw:absolute tw:inset-0 tw:z-10 tw:flex tw:items-center tw:justify-center tw:text-white';
const PULSE_RING_CLASS =
  'tw:absolute tw:top-1/2 tw:left-1/2 tw:size-[50px] tw:rounded-[50%] tw:border-2 tw:border-app-primary tw:mt-[-25px] tw:ml-[-25px]';
const ORBIT_TRACK_CLASS = 'tw:absolute tw:inset-0';
const ORBIT_PARTICLE_CLASS = 'tw:absolute tw:rounded-[50%] tw:bg-white';

export default function LivestreamConnectingAnimation({ status, onLive }: Props) {
  const [variant] = React.useState<Variant>(pickRandom);
  const [dots, setDots] = React.useState('');
  const [countdownValue, setCountdownValue] = React.useState(3);

  // Animated dots
  React.useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'));
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Countdown timer for the countdown variant
  React.useEffect(() => {
    if (variant !== 'countdown') return;
    setCountdownValue(3);
    const interval = setInterval(() => {
      setCountdownValue((v) => (v > 1 ? v - 1 : 3));
    }, 1000);
    return () => clearInterval(interval);
  }, [variant]);

  const message = status === 'requesting_permission' ? __('Activating camera') + dots : __('Going live') + dots;

  if (onLive) {
    // Smooth reveal: content shrinks away, overlay dissolves, subtle glow appears
    return (
      <div
        className={`${CONNECTING_ROOT_CLASS} tw:bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.7)_100%)] tw:[animation:live-reveal-dissolve_0.8s_cubic-bezier(0.4,0,0.2,1)_forwards]`}
      >
        <div className="tw:inline-flex tw:items-center tw:justify-center tw:rounded-[8px] tw:bg-app-primary tw:px-[20px] tw:py-[8px] tw:text-[16px] tw:font-extrabold tw:tracking-[0.1em] tw:text-white tw:uppercase tw:[box-shadow:0_0_30px_rgba(var(--color-primary-dynamic),0.4)] tw:[animation:live-badge-pop_0.8s_cubic-bezier(0.34,1.56,0.64,1)_forwards]">
          {__('LIVE')}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${CONNECTING_ROOT_CLASS} tw:bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0.85)_100%)] tw:[animation:connecting-fade-in_0.4s_ease]`}
    >
      <div className="tw:flex tw:flex-col tw:items-center tw:gap-[20px]">
        <div className="tw:flex tw:size-[80px] tw:items-center tw:justify-center">
          {variant === 'signal' && <SignalAnimation />}
          {variant === 'pulse-rings' && <PulseRingsAnimation />}
          {variant === 'orbit' && <OrbitAnimation />}
          {variant === 'waveform' && <WaveformAnimation />}
          {variant === 'countdown' && <CountdownAnimation value={countdownValue} />}
        </div>
        <p className="tw:m-0 tw:min-w-[140px] tw:text-center tw:text-[15px] tw:font-semibold tw:tracking-[0.03em] tw:text-[rgba(255,255,255,0.75)]">
          {message}
        </p>
      </div>
    </div>
  );
}

// ---- Animation variants ----

function SignalAnimation() {
  return (
    <div className="tw:text-app-primary">
      <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
        {/* Center dot */}
        <circle
          cx="32"
          cy="32"
          r="4"
          fill="currentColor"
          className="tw:[animation:signal-dot-pulse_1.5s_ease-in-out_infinite]"
        />
        {/* Expanding signal arcs */}
        <circle
          cx="32"
          cy="32"
          r="14"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          className="tw:origin-[32px_32px] tw:[animation:signal-ring-expand_2s_ease-out_0s_infinite]"
          style={{ opacity: 0 }}
        />
        <circle
          cx="32"
          cy="32"
          r="22"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          className="tw:origin-[32px_32px] tw:[animation:signal-ring-expand_2s_ease-out_0.4s_infinite]"
          style={{ opacity: 0 }}
        />
        <circle
          cx="32"
          cy="32"
          r="30"
          stroke="currentColor"
          strokeWidth="1"
          fill="none"
          className="tw:origin-[32px_32px] tw:[animation:signal-ring-expand_2s_ease-out_0.8s_infinite]"
          style={{ opacity: 0 }}
        />
      </svg>
    </div>
  );
}

function PulseRingsAnimation() {
  return (
    <div className="tw:relative tw:size-[80px]">
      <div className="tw:absolute tw:inset-0 tw:z-[2] tw:flex tw:items-center tw:justify-center tw:text-white tw:[animation:pulse-rings-icon-bounce_2s_ease-in-out_infinite]">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
          <path d="M23 7l-7 5 7 5V7z" />
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
      </div>
      <div className={`${PULSE_RING_CLASS} tw:[animation:pulse-ring-grow_1.8s_ease-out_0s_infinite]`} />
      <div className={`${PULSE_RING_CLASS} tw:[animation:pulse-ring-grow_1.8s_ease-out_0.5s_infinite]`} />
      <div className={`${PULSE_RING_CLASS} tw:[animation:pulse-ring-grow_1.8s_ease-out_1s_infinite]`} />
    </div>
  );
}

function OrbitAnimation() {
  return (
    <div className="tw:relative tw:size-[80px]">
      <div className="tw:absolute tw:top-1/2 tw:left-1/2 tw:size-[10px] tw:mt-[-5px] tw:ml-[-5px] tw:rounded-[50%] tw:bg-app-primary tw:[box-shadow:0_0_12px_rgba(var(--color-primary-dynamic),0.5)]" />
      <div className={`${ORBIT_TRACK_CLASS} tw:[animation:orbit-spin_2.5s_linear_infinite]`}>
        <div
          className={`${ORBIT_PARTICLE_CLASS} tw:top-[4px] tw:left-1/2 tw:size-[6px] tw:ml-[-3px] tw:[box-shadow:0_0_8px_rgba(255,255,255,0.5)]`}
        />
      </div>
      <div className={`${ORBIT_TRACK_CLASS} tw:[animation:orbit-spin_3.2s_linear_infinite_reverse]`}>
        <div className={`${ORBIT_PARTICLE_CLASS} tw:top-1/2 tw:right-[2px] tw:size-[5px] tw:mt-[-3px] tw:opacity-70`} />
      </div>
      <div className={`${ORBIT_TRACK_CLASS} tw:[animation:orbit-spin_4s_linear_infinite]`}>
        <div
          className={`${ORBIT_PARTICLE_CLASS} tw:bottom-[8px] tw:left-1/2 tw:size-[4px] tw:ml-[-3px] tw:opacity-50`}
        />
      </div>
    </div>
  );
}

function WaveformAnimation() {
  return (
    <div className="tw:flex tw:h-[50px] tw:items-center tw:gap-[3px]">
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <div
          key={i}
          className="tw:w-[5px] tw:rounded-[3px] tw:bg-app-primary tw:[animation:waveform-bounce_1.2s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.08}s` }}
        />
      ))}
    </div>
  );
}

function CountdownAnimation({ value }: { value: number }) {
  return (
    <div className="tw:relative tw:size-[72px] tw:text-app-primary">
      <svg className="tw:[transform:rotate(-90deg)]" width="72" height="72" viewBox="0 0 72 72">
        {/* Background circle */}
        <circle cx="36" cy="36" r="30" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.15" />
        {/* Animated progress arc */}
        <circle
          cx="36"
          cy="36"
          r="30"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${2 * Math.PI * 30}`}
          className="tw:stroke-app-primary tw:[animation:countdown-sweep_1s_linear_infinite]"
        />
      </svg>
      <span
        className="tw:absolute tw:inset-0 tw:flex tw:items-center tw:justify-center tw:text-[28px] tw:font-bold tw:text-white tw:[animation:countdown-pop_1s_ease_infinite]"
        key={value}
      >
        {value}
      </span>
    </div>
  );
}
