import path from 'node:path';
import { createKit, detectAgent, detectProjectRoot } from '@s_s/agent-kit';
import type { AgentType } from '@s_s/agent-kit';
import { AGENT_TYPES, type StorageScope, writeStorageConfig } from '../core/config.js';
import { buildMemoryPrompt } from '../prompts/templates.js';
import { getHookSets } from '../hooks/reminders.js';

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
 *
 * Uses @s_s/agent-kit for agent detection, prompt injection, and hook installation.
 */
export async function runSetup(options: SetupOptions = {}): Promise<SetupResult> {
    const cwd = process.cwd();
    const scope = options.scope || 'global';

    // --- Determine agent type: explicit param > file-based detection (agent-kit) ---
    let agentType: AgentType | undefined = options.agentType;
    if (!agentType) {
        const detected = await detectAgent(cwd);
        if (!detected) {
            return {
                success: false,
                message: `Could not auto-detect agent type. Please specify --agent. Valid values: ${AGENT_TYPES.join(', ')}`,
            };
        }
        agentType = detected;
    }

    // --- Resolve project root: explicit param > agent-kit detection ---
    let projectRoot: string | null = null;
    if (scope === 'project') {
        projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : await detectProjectRoot(cwd);
    }

    // --- Write Mnemo storage config ---
    const storageConfigPath = await writeStorageConfig(scope, projectRoot || undefined);
    const storagePath = scope === 'global' ? path.dirname(storageConfigPath) : path.join(projectRoot!, '.mnemo');

    // --- Create kit instance ---
    const kit = createKit('mnemo');

    // --- Step 1: Prompt injection (agent-kit) ---
    const scopeOptions =
        scope === 'project' ? { scope: 'project' as const, projectRoot: projectRoot! } : { scope: 'global' as const };

    const isUpdate = await kit.hasPromptInjected(agentType, scopeOptions);
    const prompt = buildMemoryPrompt(agentType);
    await kit.injectPrompt(agentType, prompt, scopeOptions);

    const promptStatus = isUpdate ? 'updated' : 'installed';

    // --- Step 2: Hook installation (agent-kit) ---
    const hookSets = getHookSets(agentType);
    const hookResult = await kit.installHooks(agentType, hookSets);

    // --- Build report ---
    const lines: string[] = [
        isUpdate
            ? 'Mnemo memory instructions updated successfully.'
            : 'Mnemo memory management initialized successfully.',
        '',
        `Agent type: ${agentType}`,
        `Prompt: ${promptStatus}`,
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
