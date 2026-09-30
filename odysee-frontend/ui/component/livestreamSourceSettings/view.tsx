import React from 'react';
import classnames from 'classnames';
// @ts-ignore
import { CustomPicker } from 'react-color';
// @ts-ignore
import { Saturation, Hue, EditableInput } from 'react-color/lib/components/common';
import type { CompositorLayer } from 'component/livestreamCompositor/view';
import { LIVESTREAM_SOURCE_SETTINGS_CLASSES as C } from './classes';

type Props = {
  layer: CompositorLayer;
  onUpdate: (updates: Partial<CompositorLayer>) => void;
};

const MiniPickerInner = (props: any) => {
  const hex = (props.hex || '').replace(/^#/, '').toUpperCase();
  return (
    <div className={C.miniPicker}>
      <div className={C.miniPickerSaturation}>
        <Saturation {...props} />
      </div>
      <div className={C.miniPickerHue}>
        <Hue {...props} />
      </div>
      <div className={C.miniPickerHex}>
        <span className={C.miniPickerHexPrefix}>#</span>
        <EditableInput
          value={hex}
          onChange={(data: any) => {
            const next = typeof data === 'string' ? data : data?.hex;
            if (typeof next === 'string' && /^[0-9a-fA-F]{6}$/.test(next)) {
              props.onChange({ hex: '#' + next, source: 'hex' });
            }
          }}
        />
      </div>
    </div>
  );
};
const MiniPicker = CustomPicker(MiniPickerInner);

const MiniPickerWithAlphaInner = (props: any) => {
  const hex = (props.hex || '').replace(/^#/, '').toUpperCase();
  const alpha = props.alpha ?? 1;
  return (
    <div className={C.miniPicker}>
      <div className={C.miniPickerSaturation}>
        <Saturation {...props} />
      </div>
      <div className={C.miniPickerHue}>
        <Hue {...props} />
      </div>
      <div className={C.miniPickerHex}>
        <span className={C.miniPickerHexPrefix}>#</span>
        <EditableInput
          value={hex}
          onChange={(data: any) => {
            const next = typeof data === 'string' ? data : data?.hex;
            if (typeof next === 'string' && /^[0-9a-fA-F]{6}$/.test(next)) {
              props.onChange({ hex: '#' + next, source: 'hex' });
            }
          }}
        />
      </div>
      <div className={C.miniPickerAlpha}>
        <span className={C.miniPickerAlphaLabel}>{__('Opacity')}</span>
        <input
          type="range"
          className={C.miniPickerAlphaSlider}
          min={0}
          max={100}
          value={Math.round(alpha * 100)}
          onChange={(e) => props.onAlphaChange?.(Number(e.target.value) / 100)}
        />
        <span className={C.miniPickerAlphaValue}>{Math.round(alpha * 100)}%</span>
      </div>
    </div>
  );
};
const MiniPickerWithAlpha = CustomPicker(MiniPickerWithAlphaInner);

function ColorSwatch({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className={C.colorWrap} ref={containerRef}>
      <button type="button" className={C.color} style={{ background: value }} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className={C.colorPopover}>
          <MiniPicker color={value} onChange={(c: any) => onChange(c.hex)} />
        </div>
      )}
    </div>
  );
}

function BgColorSwatch({
  hex,
  alpha,
  onChange,
}: {
  hex: string;
  alpha: number;
  onChange: (hex: string, alpha: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const swatchBg =
    alpha <= 0.01
      ? 'repeating-conic-gradient(#888 0% 25%, #ccc 0% 50%) 50% / 8px 8px'
      : `rgba(${r}, ${g}, ${b}, ${alpha})`;

  return (
    <div className={C.colorWrap} ref={containerRef}>
      <button type="button" className={C.color} style={{ background: swatchBg }} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className={C.colorPopover}>
          <MiniPickerWithAlpha
            color={hex}
            alpha={alpha}
            onChange={(c: any) => onChange(c.hex, alpha)}
            onAlphaChange={(a: number) => onChange(hex, a)}
          />
        </div>
      )}
    </div>
  );
}

function getPrimaryHex() {
  if (typeof document === 'undefined') return '#de0050';
  const dyn = getComputedStyle(document.documentElement).getPropertyValue('--color-primary-dynamic').trim();
  if (!dyn) return '#de0050';
  const [r, g, b] = dyn.split(',').map((n) => parseInt(n.trim(), 10));
  if ([r, g, b].some((n) => Number.isNaN(n))) return '#de0050';
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export default function LivestreamSourceSettings(props: Props) {
  const { layer, onUpdate } = props;

  function handleSlider(key: keyof CompositorLayer, value: number) {
    onUpdate({ [key]: value } as any);
  }

  return (
    <div className={C.root}>
      <div className={C.box}>
        <h3 className={C.title}>{__('Appearance')}</h3>

        <label className={C.row}>
          <div className={C.rowHeader}>
            <span className={C.label}>{__('Border Radius')}</span>
            <span className={C.value}>{layer.borderRadius ?? 0}px</span>
          </div>
          <input
            type="range"
            min={0}
            max={2000}
            value={layer.borderRadius ?? 0}
            onChange={(e) => handleSlider('borderRadius', Number(e.target.value))}
            className={C.slider}
          />
        </label>

        <label className={C.row}>
          <div className={C.rowHeader}>
            <span className={C.label}>{__('Opacity')}</span>
            <span className={C.value}>{Math.round((layer.opacity ?? 1) * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round((layer.opacity ?? 1) * 100)}
            onChange={(e) => onUpdate({ opacity: Number(e.target.value) / 100 })}
            className={C.slider}
          />
        </label>
      </div>

      {layer.id === '__widget_chat__' ? (
        <div className={C.box}>
          <h3 className={C.title}>{__('Chat')}</h3>

          <label className={C.row}>
            <div className={C.rowHeader}>
              <span className={C.label}>{__('Font Size')}</span>
              <span className={C.value}>{layer.chatFontSize ?? 20}px</span>
            </div>
            <input
              type="range"
              min={10}
              max={60}
              value={layer.chatFontSize ?? 20}
              onChange={(e) => handleSlider('chatFontSize', Number(e.target.value))}
              className={C.slider}
            />
          </label>

          <label className={C.row}>
            <div className={C.rowHeader}>
              <span className={C.label}>{__('Line Height')}</span>
              <span className={C.value}>{(layer.chatLineHeight ?? 1.4).toFixed(1)}</span>
            </div>
            <input
              type="range"
              min={10}
              max={30}
              value={Math.round((layer.chatLineHeight ?? 1.4) * 10)}
              onChange={(e) => onUpdate({ chatLineHeight: Number(e.target.value) / 10 })}
              className={C.slider}
            />
          </label>

          <label className={C.row}>
            <div className={C.rowHeader}>
              <span className={C.label}>{__('Text Border')}</span>
              <span className={C.value}>{layer.chatBorderWidth ?? 1}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={10}
              value={layer.chatBorderWidth ?? 1}
              onChange={(e) => handleSlider('chatBorderWidth', Number(e.target.value))}
              className={C.slider}
            />
          </label>

          <label className={C.row}>
            <div className={C.rowHeader}>
              <span className={C.label}>{__('Max Messages')}</span>
              <span className={C.value}>{layer.chatMaxMessages ?? 30}</span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              value={layer.chatMaxMessages ?? 30}
              onChange={(e) => handleSlider('chatMaxMessages', Number(e.target.value))}
              className={C.slider}
            />
          </label>

          <div className={classnames(C.row, C.rowInline)}>
            <span className={C.label}>{__('Text Color')}</span>
            <ColorSwatch
              value={layer.chatTextColor ?? '#ffffff'}
              onChange={(hex) => onUpdate({ chatTextColor: hex })}
            />
          </div>

          <div className={classnames(C.row, C.rowInline)}>
            <span className={C.label}>{__('Username Color')}</span>
            <ColorSwatch
              value={layer.chatUserColor ?? getPrimaryHex()}
              onChange={(hex) => onUpdate({ chatUserColor: hex })}
            />
          </div>

          <div className={classnames(C.row, C.rowInline)}>
            <span className={C.label}>{__('Background Color')}</span>
            <BgColorSwatch
              hex={layer.chatBgColor ?? '#000000'}
              alpha={layer.chatBgAlpha ?? (layer.chatBgTransparent === false ? 1 : 0)}
              onChange={(hex, alpha) =>
                onUpdate({ chatBgColor: hex, chatBgAlpha: alpha, chatBgTransparent: alpha <= 0.01 })
              }
            />
          </div>

          <div className={classnames(C.row, C.rowInline)}>
            <span className={C.label}>{__('Border Color')}</span>
            <ColorSwatch
              value={layer.chatBorderColor ?? '#000000'}
              onChange={(hex) => onUpdate({ chatBorderColor: hex })}
            />
          </div>

          <div className={classnames(C.row, C.rowInline)}>
            <span className={C.label}>{__('New messages on top')}</span>
            <button
              type="button"
              className={classnames(C.toggle, C.toggleChat, {
                [C.toggleOn]: layer.chatNewOnTop,
                [C.toggleChatOff]: !layer.chatNewOnTop,
              })}
              onClick={() => onUpdate({ chatNewOnTop: !layer.chatNewOnTop })}
              aria-pressed={layer.chatNewOnTop ?? false}
            >
              <span className={classnames(C.toggleKnob, { [C.toggleKnobOn]: layer.chatNewOnTop })} />
            </button>
          </div>

          <div className={classnames(C.row, C.rowInline)}>
            <span className={C.label}>{__('Show avatars')}</span>
            <button
              type="button"
              className={classnames(C.toggle, C.toggleChat, {
                [C.toggleOn]: layer.chatShowAvatars,
                [C.toggleChatOff]: !layer.chatShowAvatars,
              })}
              onClick={() => onUpdate({ chatShowAvatars: !layer.chatShowAvatars })}
              aria-pressed={layer.chatShowAvatars ?? false}
            >
              <span className={classnames(C.toggleKnob, { [C.toggleKnobOn]: layer.chatShowAvatars })} />
            </button>
          </div>

          <div className={classnames(C.row, C.rowInline)}>
            <span className={C.label}>{__('Hyperchats only')}</span>
            <button
              type="button"
              className={classnames(C.toggle, C.toggleChat, {
                [C.toggleOn]: layer.chatHyperchatOnly,
                [C.toggleChatOff]: !layer.chatHyperchatOnly,
              })}
              onClick={() => onUpdate({ chatHyperchatOnly: !layer.chatHyperchatOnly })}
              aria-pressed={layer.chatHyperchatOnly ?? false}
            >
              <span className={classnames(C.toggleKnob, { [C.toggleKnobOn]: layer.chatHyperchatOnly })} />
            </button>
          </div>
        </div>
      ) : (
        <div className={C.box}>
          <h3 className={C.title}>{__('Color')}</h3>

          <label className={C.row}>
            <div className={C.rowHeader}>
              <span className={C.label}>{__('Brightness')}</span>
              <span className={C.value}>{layer.brightness ?? 100}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={layer.brightness ?? 100}
              onChange={(e) => handleSlider('brightness', Number(e.target.value))}
              className={C.slider}
            />
          </label>

          <label className={C.row}>
            <div className={C.rowHeader}>
              <span className={C.label}>{__('Contrast')}</span>
              <span className={C.value}>{layer.contrast ?? 100}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={layer.contrast ?? 100}
              onChange={(e) => handleSlider('contrast', Number(e.target.value))}
              className={C.slider}
            />
          </label>

          <label className={C.row}>
            <div className={C.rowHeader}>
              <span className={C.label}>{__('Saturation')}</span>
              <span className={C.value}>{layer.saturation ?? 100}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={200}
              value={layer.saturation ?? 100}
              onChange={(e) => handleSlider('saturation', Number(e.target.value))}
              className={C.slider}
            />
          </label>

          {(() => {
            const ck = layer.chromaKey ?? { enabled: false, color: '#00FF00', threshold: 0.4, smoothness: 0.1 };
            return (
              <>
                <div className={classnames(C.row, C.rowInline)}>
                  <span className={C.label}>{__('Greenscreen')}</span>
                  <button
                    type="button"
                    className={classnames(C.toggle, {
                      [C.toggleOn]: ck.enabled,
                    })}
                    onClick={() => onUpdate({ chromaKey: { ...ck, enabled: !ck.enabled } })}
                    aria-pressed={ck.enabled}
                  >
                    <span className={classnames(C.toggleKnob, { [C.toggleKnobOn]: ck.enabled })} />
                  </button>
                </div>

                {ck.enabled && (
                  <>
                    <div className={C.row}>
                      <div className={C.rowHeader}>
                        <span className={C.label}>{__('Key Color')}</span>
                      </div>
                      <ColorSwatch
                        value={ck.color}
                        onChange={(hex) => onUpdate({ chromaKey: { ...ck, color: hex } })}
                      />
                    </div>

                    <label className={C.row}>
                      <div className={C.rowHeader}>
                        <span className={C.label}>{__('Threshold')}</span>
                        <span className={C.value}>{Math.round(ck.threshold * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(ck.threshold * 100)}
                        onChange={(e) => onUpdate({ chromaKey: { ...ck, threshold: Number(e.target.value) / 100 } })}
                        className={C.slider}
                      />
                    </label>

                    <label className={C.row}>
                      <div className={C.rowHeader}>
                        <span className={C.label}>{__('Smoothness')}</span>
                        <span className={C.value}>{Math.round(ck.smoothness * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(ck.smoothness * 100)}
                        onChange={(e) => onUpdate({ chromaKey: { ...ck, smoothness: Number(e.target.value) / 100 } })}
                        className={C.slider}
                      />
                    </label>
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
