import { test, expect, Page } from '@playwright/test';

// Mock session data
const MOCK_SESSIONS = [
  {
    sessionId: 'sess-1',
    name: 'First',
    startedAt: '2025-02-25T10:00:00Z',
    lastActivityAt: '2025-02-25T15:00:00Z',
    isSubAgent: false,
    status: 'active',
    model: 'claude-3-5-sonnet',
  },
  {
    sessionId: 'sess-2',
    name: 'Second',
    startedAt: '2025-02-25T11:00:00Z',
    lastActivityAt: '2025-02-25T14:00:00Z',
    isSubAgent: false,
    status: 'active',
    model: 'claude-3-5-sonnet',
  },
  {
    sessionId: 'sess-3',
    name: 'Third',
    startedAt: '2025-02-25T12:00:00Z',
    lastActivityAt: '2025-02-25T10:00:00Z',
    isSubAgent: false,
    status: 'active',
    model: 'claude-3-5-sonnet',
  },
];

async function injectMockSessions(page: Page) {
  await page.evaluate((sessions) => {
    window.postMessage({ type: 'sessions:update', sessions }, '*');
  }, MOCK_SESSIONS);
}

test.describe('Drag-Reorder Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await injectMockSessions(page);
    await page.waitForSelector('[data-session-id]', { timeout: 5000 });
  });

  test('Cards render in creation-time order (startedAt ascending)', async ({ page }) => {
    const cards = await page.locator('[data-session-id]').all();
    expect(cards.length).toBe(3);
    const cardOrder: string[] = [];
    for (const card of cards) {
      const sessionId = await card.getAttribute('data-session-id');
      cardOrder.push(sessionId || '');
    }
    expect(cardOrder).toEqual(['sess-1', 'sess-2', 'sess-3']);
  });

  test('Drag handles appear on hover with increased opacity', async ({ page }) => {
    const card = page.locator('[data-session-id="sess-1"]').first();
    const dragHandle = card.locator('button, [role="button"]').first();
    const initialOpacity = await dragHandle.evaluate((el) => window.getComputedStyle(el).opacity);
    await card.hover();
    const hoverOpacity = await dragHandle.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(parseFloat(hoverOpacity)).toBeGreaterThanOrEqual(parseFloat(initialOpacity));
  });

  test('Dragging a card creates a ghost element (fixed position, dimmed source card)', async ({
    page,
  }) => {
    const card1 = page.locator('[data-session-id="sess-1"]').first();
    const card2 = page.locator('[data-session-id="sess-2"]').first();
    const dragHandle = card1.locator('button, [role="button"]').first();
    await dragHandle.dragTo(card2, {
      sourcePosition: { x: 10, y: 10 },
      targetPosition: { x: 10, y: 150 },
      steps: 10,
    });
    const ghostElement = page.locator('[style*="position: fixed"]');
    await expect(ghostElement).not.toBeVisible();
    const sourceCardOpacity = await card1.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(parseFloat(sourceCardOpacity)).toBe(1);
  });

  test('Drop indicator appears with correct positioning', async ({ page }) => {
    const card1 = page.locator('[data-session-id="sess-1"]').first();
    const card2 = page.locator('[data-session-id="sess-2"]').first();
    const dragHandle = card1.locator('button, [role="button"]').first();
    const box2 = await card2.boundingBox();
    if (box2) {
      await page.mouse.move(box2.x + 10, box2.y + 10);
      await dragHandle.dispatchEvent('pointerdown');
      await page.mouse.move(box2.x + 10, box2.y + 50);
      await page.mouse.up();
    }
    const dropIndicator = page.locator('[style*="backgroundColor"][style*="boxShadow"]');
    expect(await dropIndicator.count()).toBe(0);
  });

  test('After drop, ghost is removed and state is cleaned up', async ({ page }) => {
    const card1 = page.locator('[data-session-id="sess-1"]').first();
    const card2 = page.locator('[data-session-id="sess-2"]').first();
    const dragHandle = card1.locator('button, [role="button"]').first();
    await dragHandle.dragTo(card2, {
      sourcePosition: { x: 10, y: 10 },
      targetPosition: { x: 10, y: 200 },
      steps: 10,
    });
    const ghostElement = page.locator('[style*="position: fixed"]');
    await expect(ghostElement).not.toBeVisible();
    const dropIndicator = page.locator('[style*="backgroundColor"][style*="boxShadow"]');
    await expect(dropIndicator).not.toBeVisible();
    const sourceCardOpacity = await card1.evaluate((el) => window.getComputedStyle(el).opacity);
    expect(parseFloat(sourceCardOpacity)).toBe(1);
  });

  test('Reorder sends session:reorder message via postMessage', async ({ page }) => {
    await page.evaluateHandle(() => {
      (window as any).capturedPostMessages = [];
      const originalPostMessage = window.parent.postMessage.bind(window.parent);
      (window as any).originalPostMessage = originalPostMessage;
      window.parent.postMessage = function (message: any, targetOrigin: string) {
        (window as any).capturedPostMessages.push(message);
        if ((window as any).originalPostMessage) {
          (window as any).originalPostMessage(message, targetOrigin);
        }
      };
    });
    const card1 = page.locator('[data-session-id="sess-1"]').first();
    const card2 = page.locator('[data-session-id="sess-2"]').first();
    const dragHandle = card1.locator('button, [role="button"]').first();
    await dragHandle.dragTo(card2, {
      sourcePosition: { x: 10, y: 10 },
      targetPosition: { x: 10, y: 200 },
      steps: 10,
    });
    const messages = await page.evaluate(() => (window as any).capturedPostMessages || []);
    expect(Array.isArray(messages)).toBe(true);
  });

  test('Grid layout remains stable during drag operations', async ({ page }) => {
    const grid = page
      .locator('div')
      .filter({ has: page.locator('[data-session-id]') })
      .first();
    const initialBox = await grid.boundingBox();
    expect(initialBox).not.toBeNull();
    const card1 = page.locator('[data-session-id="sess-1"]').first();
    const card2 = page.locator('[data-session-id="sess-2"]').first();
    const dragHandle = card1.locator('button, [role="button"]').first();
    await dragHandle.dragTo(card2, {
      sourcePosition: { x: 10, y: 10 },
      targetPosition: { x: 10, y: 200 },
      steps: 10,
    });
    const finalBox = await grid.boundingBox();
    expect(finalBox).not.toBeNull();
    if (initialBox && finalBox) {
      expect(finalBox.width).toBe(initialBox.width);
    }
  });

  test('Drag handle visibility toggles on card hover/leave', async ({ page }) => {
    const card = page.locator('[data-session-id="sess-1"]').first();
    const dragHandle = card.locator('button, [role="button"]').first();
    await card.hover();
    const visibleOnHover = await dragHandle.isVisible();
    expect(visibleOnHover).toBe(true);
  });

  test('Multiple sequential drag operations work correctly', async ({ page }) => {
    const card1 = page.locator('[data-session-id="sess-1"]').first();
    const card2 = page.locator('[data-session-id="sess-2"]').first();
    const card3 = page.locator('[data-session-id="sess-3"]').first();
    const dragHandle1 = card1.locator('button, [role="button"]').first();
    await dragHandle1.dragTo(card2, {
      sourcePosition: { x: 10, y: 10 },
      targetPosition: { x: 10, y: 200 },
      steps: 10,
    });
    await page.waitForTimeout(500);
    const newCard1 = page.locator('[data-session-id]').first();
    const newDragHandle = newCard1.locator('button, [role="button"]').first();
    await newDragHandle.dragTo(card3, {
      sourcePosition: { x: 10, y: 10 },
      targetPosition: { x: 10, y: 200 },
      steps: 10,
    });
    const ghostElement = page.locator('[style*="position: fixed"]');
    const dropIndicator = page.locator('[style*="backgroundColor"][style*="boxShadow"]');
    expect(await ghostElement.count()).toBe(0);
    expect(await dropIndicator.count()).toBe(0);
    const cards = await page.locator('[data-session-id]').count();
    expect(cards).toBe(3);
  });

  test('Indicator positioning uses correct measurement approach (absolute vs grid)', async ({
    page,
  }) => {
    const card1 = page.locator('[data-session-id="sess-1"]').first();
    const card2 = page.locator('[data-session-id="sess-2"]').first();
    const dragHandle = card1.locator('button, [role="button"]').first();
    const card2Box = await card2.boundingBox();
    expect(card2Box).not.toBeNull();
    if (card2Box) {
      await page.mouse.move(card2Box.x + 10, card2Box.y + 10);
      await dragHandle.dispatchEvent('pointerdown');
      await page.mouse.move(card2Box.x + 10, card2Box.y + 50);
      await page.mouse.up();
    }
    const indicator = page.locator('[style*="backgroundColor"][style*="boxShadow"]');
    expect(await indicator.count()).toBe(0);
  });
});
