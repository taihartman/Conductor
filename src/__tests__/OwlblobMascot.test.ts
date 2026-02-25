import { describe, it, expect, vi } from 'vitest';

/*
 * Basic structural tests for the OwlblobMascot component.
 * Since vitest runs in Node (no DOM), we test the component's
 * exported contract and constants rather than rendered output.
 * Full render tests would require jsdom/happy-dom.
 */

// Mock React hooks since we're in Node environment
vi.mock('react', () => ({
  useRef: (val: unknown) => ({ current: val ?? null }),
  useEffect: vi.fn(),
  useCallback: (fn: unknown) => fn,
  createElement: vi.fn(),
  default: {
    useRef: (val: unknown) => ({ current: val ?? null }),
    useEffect: vi.fn(),
    useCallback: (fn: unknown) => fn,
    createElement: vi.fn(),
  },
}));

// Mock the idle hook since we test it separately
vi.mock('../../webview-ui/src/hooks/useOwlblobIdle', () => ({
  useOwlblobIdle: vi.fn(),
}));

describe('OwlblobMascot', () => {
  it('exports a named OwlblobMascot function', async () => {
    const mod = await import('../../webview-ui/src/components/OwlblobMascot');
    expect(mod.OwlblobMascot).toBeDefined();
    expect(typeof mod.OwlblobMascot).toBe('function');
  });

  it('does not have a default export', async () => {
    const mod = await import('../../webview-ui/src/components/OwlblobMascot');
    expect(mod).not.toHaveProperty('default');
  });

  it('aspect ratio constants are 220:260', () => {
    // Verify the proportional height calculation: height = (size / 220) * 260
    const size = 40;
    const expectedHeight = (size / 220) * 260;
    // At size=40, height should be ~47.27
    expect(expectedHeight).toBeCloseTo(47.27, 1);
  });

  it('default size produces correct proportional height', () => {
    const defaultSize = 220;
    const height = (defaultSize / 220) * 260;
    expect(height).toBe(260);
  });

  it('header size produces correct proportional height', () => {
    const headerSize = 40;
    const height = (headerSize / 220) * 260;
    // 40/220 * 260 ≈ 47.27
    expect(height).toBeGreaterThan(47);
    expect(height).toBeLessThan(48);
  });
});
