import { describe, it, expect, beforeEach } from 'vitest';
import { useDashboardStore } from '../../webview-ui/src/store/dashboardStore';

/** Reset the Zustand store between tests. */
function resetStore(): void {
  useDashboardStore.setState(useDashboardStore.getInitialState());
}

describe('DashboardStore — panelLayout', () => {
  beforeEach(() => {
    resetStore();
  });

  it('initializes panelLayout as null', () => {
    const { panelLayout } = useDashboardStore.getState();
    expect(panelLayout).toBeNull();
  });

  it('setPanelLayout stores the layout correctly', () => {
    const layout = { overview: 30, detail: 70 };
    useDashboardStore.getState().setPanelLayout(layout);
    expect(useDashboardStore.getState().panelLayout).toEqual(layout);
  });

  it('setPanelLayout overwrites a previous layout', () => {
    useDashboardStore.getState().setPanelLayout({ overview: 30, detail: 70 });
    useDashboardStore.getState().setPanelLayout({ overview: 50, detail: 50 });
    expect(useDashboardStore.getState().panelLayout).toEqual({ overview: 50, detail: 50 });
  });

  it('clearFocus does not reset panelLayout', () => {
    const layout = { overview: 25, detail: 75 };
    useDashboardStore.getState().setPanelLayout(layout);
    useDashboardStore.getState().clearFocus();
    expect(useDashboardStore.getState().panelLayout).toEqual(layout);
  });

  it('setFocusedSession does not reset panelLayout', () => {
    const layout = { overview: 60, detail: 40 };
    useDashboardStore.getState().setPanelLayout(layout);
    useDashboardStore.getState().setFocusedSession('session-123');
    expect(useDashboardStore.getState().panelLayout).toEqual(layout);
  });

  it('setFocusedSession(null) does not reset panelLayout', () => {
    const layout = { overview: 35, detail: 65 };
    useDashboardStore.getState().setPanelLayout(layout);
    useDashboardStore.getState().setFocusedSession(null);
    expect(useDashboardStore.getState().panelLayout).toEqual(layout);
  });
});

describe('DashboardStore — activeTab', () => {
  beforeEach(() => {
    resetStore();
  });

  it('initializes activeTab as "sessions"', () => {
    expect(useDashboardStore.getState().activeTab).toBe('sessions');
  });

  it('setActiveTab switches to "hidden"', () => {
    useDashboardStore.getState().setActiveTab('hidden');
    expect(useDashboardStore.getState().activeTab).toBe('hidden');
  });

  it('setActiveTab switches back to "sessions"', () => {
    useDashboardStore.getState().setActiveTab('hidden');
    useDashboardStore.getState().setActiveTab('sessions');
    expect(useDashboardStore.getState().activeTab).toBe('sessions');
  });

  it('clearFocus does not reset activeTab', () => {
    useDashboardStore.getState().setActiveTab('hidden');
    useDashboardStore.getState().clearFocus();
    expect(useDashboardStore.getState().activeTab).toBe('hidden');
  });
});

describe('DashboardStore — overviewMode', () => {
  beforeEach(() => {
    resetStore();
  });

  it('initializes overviewMode as "list"', () => {
    expect(useDashboardStore.getState().overviewMode).toBe('list');
  });

  it('setOverviewMode switches to "board"', () => {
    useDashboardStore.getState().setOverviewMode('board');
    expect(useDashboardStore.getState().overviewMode).toBe('board');
  });

  it('setOverviewMode switches back to "list"', () => {
    useDashboardStore.getState().setOverviewMode('board');
    useDashboardStore.getState().setOverviewMode('list');
    expect(useDashboardStore.getState().overviewMode).toBe('list');
  });

  it('clearFocus does not reset overviewMode', () => {
    useDashboardStore.getState().setOverviewMode('board');
    useDashboardStore.getState().clearFocus();
    expect(useDashboardStore.getState().overviewMode).toBe('board');
  });
});

describe('DashboardStore — pendingLaunchSessionId', () => {
  beforeEach(() => {
    resetStore();
  });

  it('initializes pendingLaunchSessionId as null', () => {
    expect(useDashboardStore.getState().pendingLaunchSessionId).toBeNull();
  });

  it('setPendingLaunchSession stores the session ID', () => {
    useDashboardStore.getState().setPendingLaunchSession('abc-123');
    expect(useDashboardStore.getState().pendingLaunchSessionId).toBe('abc-123');
  });

  it('setFullState auto-focuses when pending session appears', () => {
    useDashboardStore.getState().setPendingLaunchSession('abc-123');
    useDashboardStore.getState().setFullState([{ sessionId: 'abc-123' } as any], [], [], [], []);
    const state = useDashboardStore.getState();
    expect(state.focusedSessionId).toBe('abc-123');
    expect(state.pendingLaunchSessionId).toBeNull();
  });

  it('setFullState does not auto-focus when pending session is absent', () => {
    useDashboardStore.getState().setPendingLaunchSession('abc-123');
    useDashboardStore
      .getState()
      .setFullState([{ sessionId: 'other-session' } as any], [], [], [], []);
    const state = useDashboardStore.getState();
    expect(state.focusedSessionId).toBeNull();
    expect(state.pendingLaunchSessionId).toBe('abc-123');
  });

  it('setFullState does not auto-focus when no pending session', () => {
    useDashboardStore.getState().setFullState([{ sessionId: 'abc-123' } as any], [], [], [], []);
    expect(useDashboardStore.getState().focusedSessionId).toBeNull();
  });

  it('setPendingLaunchSession(null) clears pending', () => {
    useDashboardStore.getState().setPendingLaunchSession('abc-123');
    useDashboardStore.getState().setPendingLaunchSession(null);
    expect(useDashboardStore.getState().pendingLaunchSessionId).toBeNull();
  });
});
