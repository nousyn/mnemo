import fs from 'node:fs/promises';
import os from 'node:os';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AGENT_TYPES, type AgentType } from '../core/config.js';
import { getAgentConfig, injectPrompt, hasPromptInjected } from '../prompts/templates.js';

/**
 * Detect which agent tool is being used by checking config file existence
 */
async function detectAgentType(cwd: string): Promise<AgentType | null> {
    const home = os.homedir();

    // Check for agent-specific config files
    const checks: Array<{ type: AgentType; paths: string[] }> = [
        {
            type: 'opencode',
            paths: [`${cwd}/opencode.json`, `${cwd}/opencode.jsonc`, `${home}/.config/opencode/opencode.json`],
        },
        {
            type: 'claude-code',
            paths: [`${cwd}/CLAUDE.md`, `${home}/.claude/CLAUDE.md`],
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

/**
 * Register the memory_setup tool
 */
export function registerSetupTool(server: McpServer): void {
    server.registerTool(
        'memory_setup',
        {
            title: 'Memory Setup',
            description:
                "Initialize Mnemo memory management. Writes memory management instructions into the agent's configuration file (e.g., AGENTS.md for OpenCode). Should be called once when setting up Mnemo for the first time.",
            inputSchema: {
                agent_type: z
                    .enum(AGENT_TYPES)
                    .optional()
                    .describe(
                        'Agent tool type. If not specified, will try to auto-detect. Valid values: opencode, claude-code, openclaw, codex',
                    ),
                scope: z
                    .enum(['project', 'global'])
                    .default('project')
                    .describe(
                        "Where to write the prompt: 'project' for current project, 'global' for user-level config",
                    ),
            },
        },
        async ({ agent_type, scope }) => {
            const cwd = process.cwd();
            const home = os.homedir();

            // Determine agent type
            let agentType: AgentType | undefined = agent_type;
            if (!agentType) {
                const detected = await detectAgentType(cwd);
                if (!detected) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Could not auto-detect agent type. Please specify agent_type parameter. Valid values: ${AGENT_TYPES.join(', ')}`,
                            },
                        ],
                        isError: true,
                    };
                }
                agentType = detected;
            }

            const config = getAgentConfig(agentType);
            const targetPath = scope === 'global' ? config.globalPath(home) : config.projectPath(cwd);

            // Read existing content or start fresh
            let existingContent = '';
            try {
                existingContent = await fs.readFile(targetPath, 'utf-8');
            } catch {
                // File doesn't exist yet, that's fine
            }

            // Check if already installed
            if (hasPromptInjected(existingContent)) {
                // Update in place
                const updated = injectPrompt(existingContent);
                await fs.writeFile(targetPath, updated, 'utf-8');
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Mnemo memory instructions updated in ${targetPath}`,
                        },
                    ],
                };
            }

            // Inject prompt
            const updated = injectPrompt(existingContent);

            // Ensure parent directory exists
            const dir = targetPath.substring(0, targetPath.lastIndexOf('/'));
            await fs.mkdir(dir, { recursive: true });

            await fs.writeFile(targetPath, updated, 'utf-8');

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Mnemo memory management initialized successfully.\n\nAgent type: ${agentType}\nConfig file: ${targetPath}\n\nMnemo is now ready to use.`,
                    },
                ],
            };
        },
    );
}
