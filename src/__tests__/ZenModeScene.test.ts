import { describe, it, expect } from 'vitest';

describe('ZenModeScene', () => {
  it('has a named export and no default export', async () => {
    const mod = await import('../../webview-ui/src/components/ZenModeScene');
    expect(mod).toHaveProperty('ZenModeScene');
    expect(typeof mod.ZenModeScene).toBe('function');
    expect(mod).not.toHaveProperty('default');
  });
});
