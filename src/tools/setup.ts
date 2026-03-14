import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AGENT_TYPES, type AgentType, type StorageScope, writeStorageConfig } from '../core/config.js';
import { getAgentConfig, injectPrompt, hasPromptInjected } from '../prompts/templates.js';
import { installHooks } from '../hooks/installer.js';

const execFileAsync = promisify(execFile);

const PROJECT_ROOT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];

/**
 * Detect which agent tool is being used by checking config file existence.
 */
async function detectAgentTypeFromFiles(cwd: string): Promise<AgentType | null> {
    const home = os.homedir();

    const checks: Array<{ type: AgentType; paths: string[] }> = [
        {
            type: 'opencode',
            paths: [`${cwd}/opencode.json`, `${cwd}/opencode.jsonc`, `${home}/.config/opencode/opencode.json`],
        },
        {
            type: 'claude-code',
            paths: [`${cwd}/CLAUDE.md`, `${home}/.claude/CLAUDE.md`],
        },
        {
            type: 'openclaw',
            paths: [`${home}/.openclaw/openclaw.json`],
        },
        {
            type: 'codex',
            paths: [`${cwd}/.codex/config.toml`, `${home}/.codex/config.toml`],
        },
    ];

    for (const check of checks) {
        for (const p of check.paths) {
            try {
                await fs.access(p);
                return check.type;
            } catch {
                continue;
            }
        }
    }

    return null;
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function detectGitRoot(cwd: string): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

async function findProjectRootFromMarkers(startDir: string): Promise<string | null> {
    let current = path.resolve(startDir);

    while (true) {
        for (const marker of PROJECT_ROOT_MARKERS) {
            if (await pathExists(path.join(current, marker))) {
                return current;
            }
        }

        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

async function resolveProjectRoot(cwd: string, explicitProjectRoot?: string): Promise<string> {
    if (explicitProjectRoot) {
        return path.resolve(explicitProjectRoot);
    }

    const gitRoot = await detectGitRoot(cwd);
    if (gitRoot) {
        return gitRoot;
    }

    const markerRoot = await findProjectRootFromMarkers(cwd);
    if (markerRoot) {
        return markerRoot;
    }

    return path.resolve(cwd);
}

export interface SetupOptions {
    agentType?: AgentType;
    scope?: StorageScope;
    projectRoot?: string;
}

export interface SetupResult {
    success: boolean;
    message: string;
}

/**
 * Run Mnemo setup: inject prompt into agent config + install hooks.
 * This is the core logic, callable from CLI or programmatically.
 */
export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
    const cwd = process.cwd();
    const home = os.homedir();
    const scope = options.scope || 'global';

    // Determine agent type: explicit param > file-based detection
    let agentType: AgentType | undefined = options.agentType;
    if (!agentType) {
        const fromFiles = await detectAgentTypeFromFiles(cwd);
        if (!fromFiles) {
            return {
                success: false,
                message: `Could not auto-detect agent type. Please specify --agent. Valid values: ${AGENT_TYPES.join(', ')}`,
            };
        }
        agentType = fromFiles;
    }

    const config = getAgentConfig(agentType);
    const projectRoot = scope === 'project' ? await resolveProjectRoot(cwd, options.projectRoot) : null;
    const targetPath = scope === 'global' ? config.globalPath(home) : config.projectPath(projectRoot!);
    const storageConfigPath = await writeStorageConfig(scope, projectRoot || undefined);
    const storagePath = scope === 'global' ? path.dirname(storageConfigPath) : path.join(projectRoot!, '.mnemo');

    // Read existing content or start fresh
    let existingContent = '';
    try {
        existingContent = await fs.readFile(targetPath, 'utf-8');
    } catch {
        // File doesn't exist yet, that's fine
    }

    // --- Step 1: Prompt injection ---
    const isUpdate = hasPromptInjected(existingContent);
    const updated = injectPrompt(existingContent, agentType);

    // Ensure parent directory exists
    const dir = targetPath.substring(0, targetPath.lastIndexOf('/'));
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(targetPath, updated, 'utf-8');

    const promptStatus = isUpdate ? 'updated' : 'installed';

    // --- Step 2: Hook installation (independent from prompt) ---
    const hookResult = await installHooks(agentType);

    // --- Build report ---
    const lines: string[] = [
        isUpdate
            ? 'Mnemo memory instructions updated successfully.'
            : 'Mnemo memory management initialized successfully.',
        '',
        `Agent type: ${agentType}`,
        `Prompt: ${promptStatus} → ${targetPath}`,
        `Storage scope: ${scope}`,
        `Storage path: ${storagePath}`,
    ];

    if (hookResult.success) {
        lines.push('');
        lines.push(`Hooks: installed → ${hookResult.hookDir}`);
        if (hookResult.settingsUpdated) {
            lines.push('Hook settings: merged into agent settings.json');
        }
        for (const note of hookResult.notes) {
            lines.push(`Note: ${note}`);
        }
    } else {
        lines.push('');
        lines.push(`Hooks: failed — ${hookResult.error}`);
        lines.push('Prompt injection succeeded independently. Hooks can be retried later.');
    }

    if (!isUpdate) {
        lines.push('');
        lines.push('Mnemo is now ready to use.');
    }

    return {
        success: true,
        message: lines.join('\n'),
    };
}
