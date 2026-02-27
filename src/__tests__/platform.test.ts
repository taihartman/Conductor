import { describe, it, expect, vi, afterEach } from 'vitest';
import { isMac, resolveModifier } from '../../webview-ui/src/utils/platform';

describe('isMac', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it('returns true when navigator.platform contains "Mac"', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'MacIntel' },
      writable: true,
      configurable: true,
    });
    expect(isMac()).toBe(true);
  });

  it('returns false for Windows platform', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      writable: true,
      configurable: true,
    });
    expect(isMac()).toBe(false);
  });

  it('returns false for Linux platform', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Linux x86_64' },
      writable: true,
      configurable: true,
    });
    expect(isMac()).toBe(false);
  });

  it('returns false when navigator is undefined (Node environment)', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(isMac()).toBe(false);
  });
});

describe('resolveModifier', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces {modifier} with Ctrl on non-Mac', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      writable: true,
      configurable: true,
    });
    expect(resolveModifier('{modifier}+Shift+;')).toBe('Ctrl+Shift+;');
  });

  it('replaces {modifier} with Cmd on Mac', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'MacIntel' },
      writable: true,
      configurable: true,
    });
    expect(resolveModifier('{modifier}+Shift+;')).toBe('Cmd+Shift+;');
  });

  it('returns the string unchanged when no {modifier} placeholder', () => {
    expect(resolveModifier('Double-click name')).toBe('Double-click name');
  });

  it('replaces multiple {modifier} occurrences', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      writable: true,
      configurable: true,
    });
    expect(resolveModifier('{modifier}+A and {modifier}+B')).toBe('Ctrl+A and Ctrl+B');
  });
});
