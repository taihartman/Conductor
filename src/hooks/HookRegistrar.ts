/**
 * @module HookRegistrar
 *
 * Manages Conductor hook registration in `~/.claude/settings.json`
 * and the hook script at `~/.conductor/hook.sh`.
 *
 * @remarks
 * On extension activation, hooks are registered for all relevant Claude Code
 * hook events (SessionStart, Stop, PermissionRequest, etc.). Each hook entry
 * is `async: true` so it never blocks Claude.
 *
 * The registrar performs non-destructive merges: it only adds/updates
 * Conductor hooks and never touches hooks from other tools.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IHookRegistrar } from './IHookRegistrar';
import { HOOK_SCRIPT_CONTENT, HOOK_SCRIPT_VERSION } from './hookScript';
import { LOG_PREFIX } from '../constants';

/** Claude Code hook events that Conductor registers for. */
const HOOK_EVENT_NAMES = [
  'SessionStart',
  'UserPromptSubmit',
  'Stop',
  'PermissionRequest',
  'Notification',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SessionEnd',
  'PreCompact',
] as const;

/** Timeout (seconds) for the hook command. */
const HOOK_TIMEOUT = 5;

/** The hook script filename. */
const HOOK_SCRIPT_NAME = 'hook.sh';

/** Marker to identify Conductor hooks in settings.json. */
const CONDUCTOR_HOOK_MARKER = 'conductor/hook.sh';

/** Version comment embedded in the hook script for update detection. */
const VERSION_MARKER_PREFIX = '# v';

interface HookEntry {
  type: string;
  command: string;
  timeout: number;
  async: boolean;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

type HooksConfig = Record<string, HookMatcher[]>;

interface ClaudeSettings {
  hooks?: HooksConfig;
  [key: string]: unknown;
}

/**
 * Manages Conductor hook installation and the hook script lifecycle.
 *
 * @remarks
 * - Reads/writes `~/.claude/settings.json` with atomic write (temp + rename)
 * - Writes `~/.conductor/hook.sh` with executable permissions
 * - Non-destructive: only adds/updates Conductor hooks, preserves others
 */
export class HookRegistrar implements IHookRegistrar {
  private readonly settingsPath: string;
  private readonly conductorDir: string;
  private readonly hookScriptPath: string;

  constructor(settingsPath?: string, conductorDir?: string) {
    const homeDir = os.homedir();
    this.settingsPath = settingsPath ?? path.join(homeDir, '.claude', 'settings.json');
    this.conductorDir = conductorDir ?? path.join(homeDir, '.conductor');
    this.hookScriptPath = path.join(this.conductorDir, HOOK_SCRIPT_NAME);
  }

  /**
   * Check whether at least one Conductor hook is registered in Claude Code settings.
   *
   * @returns True if a Conductor hook entry exists in any hook event
   */
  async isInstalled(): Promise<boolean> {
    const settings = this.readSettings();
    if (!settings?.hooks) return false;

    // Check if at least one hook event has a Conductor hook entry
    for (const eventName of HOOK_EVENT_NAMES) {
      const matchers = settings.hooks[eventName];
      if (matchers && this.findConductorHook(matchers)) {
        return true;
      }
    }
    return false;
  }

  /** Register Conductor hook entries in Claude Code settings and write the hook script. */
  async install(): Promise<void> {
    console.log(`${LOG_PREFIX.HOOK_REGISTRAR} Installing Conductor hooks...`);

    const settings = this.readSettings() ?? {};
    if (!settings.hooks) {
      settings.hooks = {};
    }

    const conductorHook: HookEntry = {
      type: 'command',
      command: this.hookScriptPath,
      timeout: HOOK_TIMEOUT,
      async: true,
    };

    for (const eventName of HOOK_EVENT_NAMES) {
      if (!settings.hooks[eventName]) {
        settings.hooks[eventName] = [];
      }

      const matchers = settings.hooks[eventName];
      const existing = this.findConductorMatcher(matchers);

      if (existing) {
        // Update existing Conductor hook entry
        const hookIdx = existing.hooks.findIndex((h) => this.isConductorHook(h));
        if (hookIdx >= 0) {
          existing.hooks[hookIdx] = conductorHook;
        } else {
          existing.hooks.push(conductorHook);
        }
      } else {
        // Add new matcher with Conductor hook
        matchers.push({
          matcher: '',
          hooks: [conductorHook],
        });
      }
    }

    this.writeSettings(settings);
    await this.ensureHookScript();

    console.log(`${LOG_PREFIX.HOOK_REGISTRAR} Conductor hooks installed successfully`);
  }

  /** Remove Conductor hook entries from Claude Code settings. */
  async uninstall(): Promise<void> {
    console.log(`${LOG_PREFIX.HOOK_REGISTRAR} Uninstalling Conductor hooks...`);

    const settings = this.readSettings();
    if (!settings?.hooks) return;

    for (const eventName of HOOK_EVENT_NAMES) {
      const matchers = settings.hooks[eventName];
      if (!matchers) continue;

      // Remove Conductor hooks from each matcher
      for (let i = matchers.length - 1; i >= 0; i--) {
        const matcher = matchers[i];
        matcher.hooks = matcher.hooks.filter((h) => !this.isConductorHook(h));
        // Remove empty matchers
        if (matcher.hooks.length === 0) {
          matchers.splice(i, 1);
        }
      }

      // Remove empty event key
      if (matchers.length === 0) {
        delete settings.hooks[eventName];
      }
    }

    // Remove empty hooks object
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    this.writeSettings(settings);

    // Remove hook script
    try {
      fs.unlinkSync(this.hookScriptPath);
      console.log(`${LOG_PREFIX.HOOK_REGISTRAR} Hook script removed`);
    } catch {
      // File may not exist
    }

    console.log(`${LOG_PREFIX.HOOK_REGISTRAR} Conductor hooks uninstalled`);
  }

  /** Write or update the hook script that Claude Code invokes on lifecycle events. */
  async ensureHookScript(): Promise<void> {
    // Ensure directories exist
    const eventsDir = path.join(this.conductorDir, 'events');
    fs.mkdirSync(eventsDir, { recursive: true });

    // Check if script needs updating
    if (this.isScriptUpToDate()) {
      return;
    }

    // Write hook script
    fs.writeFileSync(this.hookScriptPath, HOOK_SCRIPT_CONTENT, { mode: 0o755 });
    console.log(`${LOG_PREFIX.HOOK_REGISTRAR} Hook script written to ${this.hookScriptPath}`);
  }

  private isScriptUpToDate(): boolean {
    try {
      const content = fs.readFileSync(this.hookScriptPath, 'utf8');
      return content.includes(`${VERSION_MARKER_PREFIX}${HOOK_SCRIPT_VERSION}`);
    } catch {
      return false;
    }
  }

  private readSettings(): ClaudeSettings | null {
    try {
      const content = fs.readFileSync(this.settingsPath, 'utf8');
      return JSON.parse(content) as ClaudeSettings;
    } catch {
      return null;
    }
  }

  private writeSettings(settings: ClaudeSettings): void {
    // Ensure parent directory exists
    const dir = path.dirname(this.settingsPath);
    fs.mkdirSync(dir, { recursive: true });

    const content = JSON.stringify(settings, null, 2) + '\n';
    const tmpPath = this.settingsPath + '.tmp';

    try {
      // Atomic write: write to temp file, then rename
      fs.writeFileSync(tmpPath, content, 'utf8');
      fs.renameSync(tmpPath, this.settingsPath);
    } catch {
      // Fallback: direct write (rename may fail on some platforms)
      fs.writeFileSync(this.settingsPath, content, 'utf8');
    }
  }

  private isConductorHook(hook: HookEntry): boolean {
    return typeof hook.command === 'string' && hook.command.includes(CONDUCTOR_HOOK_MARKER);
  }

  private findConductorHook(matchers: HookMatcher[]): HookEntry | undefined {
    for (const matcher of matchers) {
      const hook = matcher.hooks.find((h) => this.isConductorHook(h));
      if (hook) return hook;
    }
    return undefined;
  }

  private findConductorMatcher(matchers: HookMatcher[]): HookMatcher | undefined {
    return matchers.find((m) => m.hooks.some((h) => this.isConductorHook(h)));
  }
}
