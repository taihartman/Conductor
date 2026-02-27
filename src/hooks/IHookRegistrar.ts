/**
 * @module IHookRegistrar
 *
 * Interface for managing Conductor hook registration in Claude Code settings.
 */

/**
 * Manages Conductor hook installation in `~/.claude/settings.json`
 * and the hook script at `~/.conductor/hook.sh`.
 */
export interface IHookRegistrar {
  /** Check if Conductor hooks are installed in Claude settings. */
  isInstalled(): Promise<boolean>;
  /** Install/update Conductor hooks in Claude settings. */
  install(): Promise<void>;
  /** Remove Conductor hooks from Claude settings. */
  uninstall(): Promise<void>;
  /** Ensure hook script exists and is up to date. */
  ensureHookScript(): Promise<void>;
}
