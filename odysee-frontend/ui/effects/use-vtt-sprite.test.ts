import { describe, expect, it } from '@voidzero-dev/vite-plus-test';
import { shouldGenerateVttSprite } from './use-vtt-sprite';

describe('shouldGenerateVttSprite', () => {
  it('does not create a competing hidden player for HyperBEAM media', () => {
    expect(
      shouldGenerateVttSprite(
        'http://127.0.0.1:18801/~cache@1.0/read?read=odysee%2Fmedia%2Fstream-id%2Ftxid%3A0',
        730,
        false
      )
    ).toBe(false);
  });

  it('retains generated scrub previews for ordinary media sources', () => {
    expect(shouldGenerateVttSprite('https://cdn.example/video.mp4', 730, false)).toBe(true);
  });

  it('does not replace an existing native storyboard', () => {
    expect(shouldGenerateVttSprite('https://cdn.example/video.mp4', 730, true)).toBe(false);
  });
});
