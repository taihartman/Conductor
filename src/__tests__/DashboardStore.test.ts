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
