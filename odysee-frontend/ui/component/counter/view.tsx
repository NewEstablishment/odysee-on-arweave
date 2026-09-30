import React from 'react';
import { COUNTER_ROOT_CLASS } from './classes';

type Props = {
  value: number | string;
  precision?: number;
  startFrom?: number;
};
const DIGITS = Array.from(
  {
    length: 10,
  },
  (_, i) => i
);
export default function Counter(props: Props) {
  const { value, precision = 2, startFrom } = props;
  const [chars, setChars] = React.useState([]);
  const [displayValue, setDisplayValue] = React.useState(startFrom != null ? startFrom : value);
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setDisplayValue(value);
    }, 200);
    return () => clearTimeout(timer);
  }, [value]);
  React.useEffect(() => {
    const str = Number(displayValue).toFixed(precision);
    setChars(str.split(''));
  }, [displayValue, precision]);
  return (
    <div className={COUNTER_ROOT_CLASS}>
      <div className="counter-wrapper tw:flex tw:leading-none">
        {chars.map((c, i) =>
          /\d/.test(c) ? (
            <div className="tw:inline-block tw:h-[1em] tw:w-[1ch] tw:overflow-hidden" key={i}>
              <div
                className="tw:h-[1000%] tw:transition-[transform] tw:duration-[600ms] tw:ease-[ease-in-out] tw:will-change-transform"
                style={{
                  transform: `translateY(-${+c * 10}%)`,
                }}
              >
                {DIGITS.map((d) => (
                  <div className="tw:h-[10%] tw:text-[inherit] tw:leading-none" key={d}>
                    {d}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <span key={i} className="tw:inline-block tw:w-[0.5ch] tw:text-[inherit] tw:leading-none">
              {c}
            </span>
          )
        )}
      </div>
    </div>
  );
}
