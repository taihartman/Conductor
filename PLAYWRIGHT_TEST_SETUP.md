PLAYWRIGHT E2E TEST SETUP AND EXECUTION GUIDE

=== FILES CREATED ===
1. /Users/a515138832/StudioProjects/claude-agent-dashboard/drag-reorder.spec.ts (8.4K)
   - Comprehensive Playwright test suite for drag-reorder functionality
   - 10 test cases covering all requirements

2. /Users/a515138832/StudioProjects/claude-agent-dashboard/playwright.config.ts (769B)
   - Playwright configuration for headless and headed testing
   - Configured with webServer to auto-start dev server

=== SETUP STEPS ===

Step 1: Install Playwright and dependencies
Run this command in the project root:
  npm install --save-dev @playwright/test

Step 2: Start the webview dev server (if not using auto-start)
  cd webview-ui && npm run dev

Step 3: Run all tests
  npx playwright test drag-reorder.spec.ts

Step 4: Run tests with UI (recommended for debugging)
  npx playwright test drag-reorder.spec.ts --ui

Step 5: Run tests in headed mode (see browser)
  npx playwright test drag-reorder.spec.ts --headed

Step 6: Run specific test
  npx playwright test drag-reorder.spec.ts -g "Cards render in creation-time order"

=== TEST CASES INCLUDED ===

1. Cards render in creation-time order (startedAt ascending)
   - Verifies sessions are sorted by startedAt in ascending order
   
2. Drag handles appear on hover with increased opacity
   - Verifies drag handles visibility increases on hover

3. Dragging a card creates a ghost element (fixed position, dimmed source card)
   - Tests ghost element creation and source card state

4. Drop indicator appears with correct positioning
   - Tests drop indicator appears with correct absolute positioning

5. After drop, ghost is removed and state is cleaned up
   - Verifies cleanup of ghost and indicator elements

6. Reorder sends session:reorder message via postMessage
   - Tests postMessage communication after reorder

7. Grid layout remains stable during drag operations
   - Verifies grid width/height stability during drag

8. Drag handle visibility toggles on card hover/leave
   - Tests visibility toggle behavior

9. Multiple sequential drag operations work correctly
   - Tests multiple consecutive drag-drop operations

10. Indicator positioning uses correct measurement approach (absolute vs grid)
    - Verifies indicator positioning methodology

=== KEY FEATURES TESTED ===

✓ Grid layout stability during drag
✓ Indicator positioning (absolute vs grid-based)
✓ Ghost visibility and styling
✓ State cleanup on drop
✓ Drag handle hover effects
✓ Session ordering by startedAt
✓ PostMessage communication
✓ Sequential drag operations

=== TEST CONFIGURATION ===

The tests use mock session data injected via postMessage:
- 3 sessions with different startedAt times
- Sessions ordered by creation time (sess-1 at 10:00, sess-2 at 11:00, sess-3 at 12:00)

Browser targets:
- Chromium (default)
- Firefox
- WebKit (Safari)

Screenshot capture: On failure only
Trace recording: On first retry

