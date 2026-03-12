import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { type AgentType } from '../core/config.js';
import { ensureDir } from '../core/config.js';
import { HOOK_CONFIGS } from './reminders.js';

export interface HookInstallResult {
    success: boolean;
    hookDir: string;
    filesWritten: string[];
    settingsUpdated: boolean;
    /** Non-fatal messages (e.g. manual steps needed) */
    notes: string[];
    /** Error message if success is false */
    error?: string;
}

/**
 * Install hook scripts/plugins for the given agent type.
 * This is independent from prompt injection — either can succeed/fail without affecting the other.
 */
export async function installHooks(agentType: AgentType): Promise<HookInstallResult> {
    const home = os.homedir();
    const config = HOOK_CONFIGS[agentType];
    const hookDir = config.getHookDir(home);

    const result: HookInstallResult = {
        success: false,
        hookDir,
        filesWritten: [],
        settingsUpdated: false,
        notes: [],
    };

    try {
        // Step 1: Generate hook files to target directory
        await ensureDir(hookDir);

        for (const [fileName, content] of Object.entries(config.files)) {
            const filePath = path.join(hookDir, fileName);
            await fs.writeFile(filePath, content, 'utf-8');

            // Make shell scripts executable
            if (fileName.endsWith('.sh')) {
                await fs.chmod(filePath, 0o755);
            }

            result.filesWritten.push(filePath);
        }

        // Step 2: For Claude Code / Codex, merge hook config into settings.json
        if (config.getSettingsPath) {
            const settingsPath = config.getSettingsPath(home);
            const activatorPath = path.join(hookDir, 'mnemo-activator.sh');
            await mergeHookSettings(settingsPath, activatorPath);
            result.settingsUpdated = true;
        }

        // Step 3: Agent-specific post-install notes
        if (agentType === 'openclaw') {
            result.notes.push('Run `openclaw hooks enable mnemo` to activate the hook.');
        }

        result.success = true;
    } catch (err) {
        result.error = err instanceof Error ? err.message : String(err);
    }

    return result;
}

/**
 * Merge Mnemo hook configuration into a Claude Code / Codex settings.json.
 * Reads existing settings, adds/updates the Mnemo hook entry, writes back.
 * Does not overwrite other existing hooks.
 */
async function mergeHookSettings(settingsPath: string, activatorPath: string): Promise<void> {
    // Read existing settings or start fresh
    let settings: Record<string, unknown> = {};
    try {
        const raw = await fs.readFile(settingsPath, 'utf-8');
        settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        // File doesn't exist or is invalid JSON — start fresh
    }

    // Ensure hooks object exists
    if (!settings.hooks || typeof settings.hooks !== 'object') {
        settings.hooks = {};
    }
    const hooks = settings.hooks as Record<string, unknown[]>;

    // Build the Mnemo hook entry
    const mnemoHookEntry = {
        matcher: '',
        hooks: [
            {
                type: 'command',
                command: activatorPath,
            },
        ],
    };

    // Merge into UserPromptSubmit
    if (!Array.isArray(hooks.UserPromptSubmit)) {
        hooks.UserPromptSubmit = [];
    }

    // Remove existing Mnemo entries (identified by command path containing 'mnemo')
    hooks.UserPromptSubmit = hooks.UserPromptSubmit.filter((entry) => {
        if (!entry || typeof entry !== 'object') return true;
        const e = entry as Record<string, unknown>;
        if (!Array.isArray(e.hooks)) return true;
        return !e.hooks.some((h: unknown) => {
            if (!h || typeof h !== 'object') return false;
            const hook = h as Record<string, unknown>;
            return typeof hook.command === 'string' && hook.command.includes('mnemo');
        });
    });

    // Add the new Mnemo entry
    hooks.UserPromptSubmit.push(mnemoHookEntry);

    // Write back
    await ensureDir(path.dirname(settingsPath));
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/**
 * Check if hooks are already installed for the given agent type.
 */
export async function hasHooksInstalled(agentType: AgentType): Promise<boolean> {
    const home = os.homedir();
    const config = HOOK_CONFIGS[agentType];
    const hookDir = config.getHookDir(home);

    try {
        // Check if at least one hook file exists
        for (const fileName of Object.keys(config.files)) {
            await fs.access(path.join(hookDir, fileName));
            return true;
        }
    } catch {
        // Not installed
    }

    return false;
}
