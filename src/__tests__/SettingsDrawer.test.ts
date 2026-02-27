import { describe, it, expect } from 'vitest';
import { SHORTCUTS, FEATURES } from '../../webview-ui/src/components/SettingsDrawer';
import { UI_STRINGS } from '../../webview-ui/src/config/strings';

describe('SettingsDrawer help data', () => {
  describe('SHORTCUTS array', () => {
    it('contains exactly 9 shortcut entries', () => {
      expect(SHORTCUTS).toHaveLength(9);
    });

    it('every entry has a non-empty key and action', () => {
      for (const shortcut of SHORTCUTS) {
        expect(shortcut.key.length).toBeGreaterThan(0);
        expect(shortcut.action.length).toBeGreaterThan(0);
      }
    });

    it('references UI_STRINGS values for keys', () => {
      expect(SHORTCUTS[0].key).toBe(UI_STRINGS.HELP_KEY_SWITCH_SESSION);
      expect(SHORTCUTS[0].action).toBe(UI_STRINGS.HELP_SHORTCUT_SWITCH_SESSION);
    });
  });

  describe('FEATURES array', () => {
    it('contains exactly 12 feature entries', () => {
      expect(FEATURES).toHaveLength(12);
    });

    it('every entry has a non-empty title and description', () => {
      for (const feature of FEATURES) {
        expect(feature.title.length).toBeGreaterThan(0);
        expect(feature.description.length).toBeGreaterThan(0);
      }
    });

    it('first feature is Kanban Board', () => {
      expect(FEATURES[0].title).toBe(UI_STRINGS.HELP_FEATURE_KANBAN);
      expect(FEATURES[0].description).toBe(UI_STRINGS.HELP_DESC_KANBAN);
    });

    it('last feature is Auto-Hide Patterns', () => {
      const last = FEATURES[FEATURES.length - 1];
      expect(last.title).toBe(UI_STRINGS.HELP_FEATURE_AUTO_HIDE);
      expect(last.description).toBe(UI_STRINGS.HELP_DESC_AUTO_HIDE);
    });

    it('has unique titles', () => {
      const titles = FEATURES.map((f) => f.title);
      expect(new Set(titles).size).toBe(titles.length);
    });
  });

  describe('UI_STRINGS help entries', () => {
    it('defines HELP_SECTION_HEADING', () => {
      expect(UI_STRINGS.HELP_SECTION_HEADING).toBe('Help & Shortcuts');
    });

    it('defines HELP_SHORTCUTS_HEADING', () => {
      expect(UI_STRINGS.HELP_SHORTCUTS_HEADING).toBe('Keyboard Shortcuts');
    });

    it('defines HELP_FEATURES_HEADING', () => {
      expect(UI_STRINGS.HELP_FEATURES_HEADING).toBe('Features');
    });
  });
});
