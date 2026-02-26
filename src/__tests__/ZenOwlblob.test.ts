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

  it('includes top hat SVG elements', async () => {
    const { ZenOwlblob } = await import('../../webview-ui/src/components/ZenOwlblob');
    const element = ZenOwlblob({});

    // Recursively collect all child elements and their types/props
    function collectElements(
      node: React.ReactElement
    ): Array<{ type: string; props: Record<string, unknown> }> {
      const results: Array<{ type: string; props: Record<string, unknown> }> = [];
      if (typeof node.type === 'string') {
        results.push({ type: node.type, props: node.props as Record<string, unknown> });
      }
      const children = (node.props as { children?: unknown })?.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child && typeof child === 'object' && 'type' in child) {
            results.push(...collectElements(child as React.ReactElement));
          }
        }
      } else if (children && typeof children === 'object' && 'type' in children) {
        results.push(...collectElements(children as React.ReactElement));
      }
      return results;
    }

    const allElements = collectElements(element);

    // Hat brim ellipse: cx=110, cy=82, rx=30, ry=7, fill=#2d2d44
    const brim = allElements.find(
      (el) => el.type === 'ellipse' && el.props.cx === '110' && el.props.cy === '82'
    );
    expect(brim).toBeDefined();

    // Hat band rect: fill=#b8a0d8
    const band = allElements.find((el) => el.type === 'rect' && el.props.fill === '#b8a0d8');
    expect(band).toBeDefined();
  });
});
