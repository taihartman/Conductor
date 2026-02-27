/** Modifier key placeholder used in shortcut templates. */
const MODIFIER_PLACEHOLDER = '{modifier}';

/** Mac modifier label. */
const MODIFIER_MAC = 'Cmd';

/** Non-Mac modifier label. */
const MODIFIER_OTHER = 'Ctrl';

/** Returns `true` when running on macOS. Safe in Node test environments. */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
}

/**
 * Replaces every `{modifier}` token in `template` with the platform-appropriate
 * modifier key (`Cmd` on Mac, `Ctrl` elsewhere).
 */
export function resolveModifier(template: string): string {
  if (!template.includes(MODIFIER_PLACEHOLDER)) return template;
  const label = isMac() ? MODIFIER_MAC : MODIFIER_OTHER;
  return template.replaceAll(MODIFIER_PLACEHOLDER, label);
}
