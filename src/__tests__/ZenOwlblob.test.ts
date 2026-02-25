import { describe, it, expect } from 'vitest';

describe('ZenOwlblob', () => {
  it('has a named export and no default export', async () => {
    const mod = await import('../../webview-ui/src/components/ZenOwlblob');
    expect(mod).toHaveProperty('ZenOwlblob');
    expect(typeof mod.ZenOwlblob).toBe('function');
    expect(mod).not.toHaveProperty('default');
  });

  it('uses 220:260 aspect ratio', async () => {
    // The component renders an SVG with viewBox "0 0 220 260".
    // We verify by checking the function signature and the viewBox constant
    // embedded in the module (since we don't have a full DOM).
    const { ZenOwlblob } = await import('../../webview-ui/src/components/ZenOwlblob');

    // Call with default size, check the returned element's viewBox
    const element = ZenOwlblob({});
    expect(element.props.viewBox).toBe('0 0 220 260');
  });
});
