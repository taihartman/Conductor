import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HookRegistrar } from '../hooks/HookRegistrar';

describe('HookRegistrar', () => {
  let tmpDir: string;
  let settingsPath: string;
  let conductorDir: string;
  let registrar: HookRegistrar;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-registrar-test-'));
    settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    conductorDir = path.join(tmpDir, '.conductor');
    registrar = new HookRegistrar(settingsPath, conductorDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function readSettings(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }

  function writeSettings(settings: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }

  // --- isInstalled ---

  it('returns false when settings.json does not exist', async () => {
    expect(await registrar.isInstalled()).toBe(false);
  });

  it('returns false when settings has no hooks', async () => {
    writeSettings({ someOther: 'setting' });
    expect(await registrar.isInstalled()).toBe(false);
  });

  it('returns false when hooks exist but none are Conductor hooks', async () => {
    writeSettings({
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [{ type: 'command', command: '/some/other/hook.sh', timeout: 5, async: true }],
          },
        ],
      },
    });
    expect(await registrar.isInstalled()).toBe(false);
  });

  it('returns true when Conductor hooks are installed', async () => {
    writeSettings({
      hooks: {
        SessionStart: [
          {
            matcher: '',
            hooks: [
              {
                type: 'command',
                command: path.join(conductorDir, 'hook.sh'),
                timeout: 5,
                async: true,
              },
            ],
          },
        ],
      },
    });
    expect(await registrar.isInstalled()).toBe(true);
  });

  // --- install ---

  it('creates settings.json and hooks when file does not exist', async () => {
    await registrar.install();

    const settings = readSettings();
    expect(settings.hooks).toBeDefined();

    const hooks = settings.hooks as Record<string, unknown[]>;
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.Stop).toBeDefined();
    expect(hooks.PermissionRequest).toBeDefined();
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.PostToolUseFailure).toBeDefined();
    expect(hooks.Notification).toBeDefined();
    expect(hooks.SubagentStart).toBeDefined();
    expect(hooks.SessionEnd).toBeDefined();
    expect(hooks.PreCompact).toBeDefined();
    expect(hooks.UserPromptSubmit).toBeDefined();
  });

  it('preserves existing non-Conductor hooks', async () => {
    const existingHook = {
      type: 'command',
      command: '/path/to/peon-ping.sh',
      timeout: 10,
      async: true,
    };
    writeSettings({
      hooks: {
        SessionStart: [{ matcher: '', hooks: [existingHook] }],
      },
    });

    await registrar.install();

    const settings = readSettings();
    const hooks = settings.hooks as Record<
      string,
      Array<{ matcher: string; hooks: Array<Record<string, unknown>> }>
    >;

    // Should have 2 matchers now: one for peon-ping, one for conductor
    const sessionStartHooks = hooks.SessionStart;
    expect(sessionStartHooks).toHaveLength(2);

    // peon-ping hook should be untouched
    expect(sessionStartHooks[0].hooks[0].command).toBe('/path/to/peon-ping.sh');
    // Conductor hook should be added
    expect(sessionStartHooks[1].hooks[0].command).toContain('conductor/hook.sh');
  });

  it('preserves existing non-hook settings', async () => {
    writeSettings({ api_key: 'sk-test', model: 'claude-3' });

    await registrar.install();

    const settings = readSettings();
    expect(settings.api_key).toBe('sk-test');
    expect(settings.model).toBe('claude-3');
    expect(settings.hooks).toBeDefined();
  });

  it('writes hook script with executable permissions', async () => {
    await registrar.install();

    const scriptPath = path.join(conductorDir, 'hook.sh');
    expect(fs.existsSync(scriptPath)).toBe(true);

    const stat = fs.statSync(scriptPath);
    // Check owner execute permission
    expect(stat.mode & 0o100).toBeTruthy();

    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('#!/usr/bin/env bash');
    expect(content).toContain('EVENTS_DIR');
    expect(content).toContain('jq');
  });

  it('creates events directory', async () => {
    await registrar.install();

    const eventsDir = path.join(conductorDir, 'events');
    expect(fs.existsSync(eventsDir)).toBe(true);
    expect(fs.statSync(eventsDir).isDirectory()).toBe(true);
  });

  it('hook entries have correct structure', async () => {
    await registrar.install();

    const settings = readSettings();
    const hooks = settings.hooks as Record<
      string,
      Array<{ matcher: string; hooks: Array<Record<string, unknown>> }>
    >;
    const entry = hooks.SessionStart[0].hooks[0];

    expect(entry.type).toBe('command');
    expect(entry.command).toContain('conductor/hook.sh');
    expect(entry.timeout).toBe(5);
    expect(entry.async).toBe(true);
  });

  it('updates existing Conductor hooks on re-install', async () => {
    // First install
    await registrar.install();

    // Manually modify the command to simulate an old version
    const settings = readSettings();
    const hooks = settings.hooks as Record<
      string,
      Array<{ matcher: string; hooks: Array<Record<string, unknown>> }>
    >;
    hooks.SessionStart[0].hooks[0].timeout = 99;
    writeSettings(settings);

    // Re-install should update
    await registrar.install();

    const updated = readSettings();
    const updatedHooks = updated.hooks as Record<
      string,
      Array<{ matcher: string; hooks: Array<Record<string, unknown>> }>
    >;
    expect(updatedHooks.SessionStart[0].hooks[0].timeout).toBe(5);
  });

  // --- uninstall ---

  it('removes Conductor hooks from settings', async () => {
    await registrar.install();
    expect(await registrar.isInstalled()).toBe(true);

    await registrar.uninstall();
    expect(await registrar.isInstalled()).toBe(false);
  });

  it('preserves non-Conductor hooks on uninstall', async () => {
    const otherHook = {
      type: 'command',
      command: '/path/to/other.sh',
      timeout: 10,
      async: true,
    };
    writeSettings({
      hooks: {
        SessionStart: [{ matcher: '', hooks: [otherHook] }],
      },
    });

    // Install then uninstall
    await registrar.install();
    await registrar.uninstall();

    const settings = readSettings();
    const hooks = settings.hooks as Record<
      string,
      Array<{ matcher: string; hooks: Array<Record<string, unknown>> }>
    >;
    expect(hooks.SessionStart).toHaveLength(1);
    expect(hooks.SessionStart[0].hooks[0].command).toBe('/path/to/other.sh');
  });

  it('removes hook script on uninstall', async () => {
    await registrar.install();
    const scriptPath = path.join(conductorDir, 'hook.sh');
    expect(fs.existsSync(scriptPath)).toBe(true);

    await registrar.uninstall();
    expect(fs.existsSync(scriptPath)).toBe(false);
  });

  it('uninstall is safe when nothing is installed', async () => {
    // Should not throw
    await registrar.uninstall();
  });

  // --- ensureHookScript ---

  it('creates script if missing', async () => {
    const scriptPath = path.join(conductorDir, 'hook.sh');
    expect(fs.existsSync(scriptPath)).toBe(false);

    await registrar.ensureHookScript();
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('updates script if version marker is outdated', async () => {
    fs.mkdirSync(conductorDir, { recursive: true });
    const scriptPath = path.join(conductorDir, 'hook.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\n# v0 — old version\n', { mode: 0o755 });

    await registrar.ensureHookScript();

    const content = fs.readFileSync(scriptPath, 'utf8');
    expect(content).toContain('# v2');
    expect(content).not.toContain('# v0');
  });

  it('skips write if script is already up to date', async () => {
    await registrar.ensureHookScript();
    const scriptPath = path.join(conductorDir, 'hook.sh');
    const firstMtime = fs.statSync(scriptPath).mtimeMs;

    // Small delay to ensure mtime would differ
    await new Promise((resolve) => setTimeout(resolve, 10));

    await registrar.ensureHookScript();
    const secondMtime = fs.statSync(scriptPath).mtimeMs;

    expect(secondMtime).toBe(firstMtime);
  });
});
