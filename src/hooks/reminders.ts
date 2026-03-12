import { type AgentType } from '../core/config.js';

/**
 * Core reminder texts used across all agents.
 * Keep each reminder minimal (~50 tokens) to avoid attention overhead.
 */

export const REMINDERS = {
    /** Per-turn self-check reminder (UserPromptSubmit equivalent) */
    perTurn: `<mnemo-reminder>
After this task, briefly self-check:
- Did a durable preference, decision, or rule emerge? → memory_save
- Is there an unresolved thread to resume later? → memory_save (continuity)
- Did context window reset? → memory_compress
If nothing qualifies, skip. Don't force saves.
</mnemo-reminder>`,

    /** Session start reminder */
    sessionStart: `<mnemo-session-start>
Search memory for relevant context before starting work.
Call memory_search with a query based on the user's message.
</mnemo-session-start>`,

    /** Context compaction reminder */
    compaction: `<mnemo-compaction>
Context is being compacted. Before losing context:
1. Save any important unresolved threads as continuity memories (memory_save)
2. Call memory_compress if many notes have accumulated
</mnemo-compaction>`,

    /** Session end / idle self-check */
    sessionEnd: `<mnemo-session-end>
Session ending. Quick self-check:
- Did a durable conclusion, preference, or decision emerge? → memory_save
- Was an important thread left unresolved? → memory_save (continuity)
- Did I learn something reusable that would be lost without saving? → memory_save (experience)
</mnemo-session-end>`,
} as const;

// ---------------------------------------------------------------------------
// Claude Code / Codex — shell script template
// ---------------------------------------------------------------------------

/**
 * Shell script for Claude Code / Codex UserPromptSubmit hook.
 * Outputs the per-turn reminder to stdout so the agent sees it as context.
 */
export const ACTIVATOR_SCRIPT = `#!/bin/bash
# Mnemo Memory Activator Hook
# Triggers on UserPromptSubmit to remind the agent about memory management
# Keep output minimal (~50 tokens) to minimize overhead

set -e

cat << 'EOF'
${REMINDERS.perTurn}
EOF
`;

// ---------------------------------------------------------------------------
// OpenClaw — HOOK.md + handler.ts templates
// ---------------------------------------------------------------------------

/**
 * OpenClaw HOOK.md manifest for the mnemo hook.
 */
export const OPENCLAW_HOOK_MD = `---
name: mnemo
description: "Injects memory management reminder during agent bootstrap"
metadata: {"openclaw":{"emoji":"\\ud83e\\udde0","events":["agent:bootstrap"]}}
---
`;

/**
 * OpenClaw handler.ts for agent:bootstrap event.
 * Injects a virtual MNEMO_REMINDER.md file into the bootstrap context.
 */
export const OPENCLAW_HANDLER_TS = `const REMINDER_CONTENT = \`
## Mnemo - Memory Management Reminder

${REMINDERS.sessionStart}

${REMINDERS.perTurn}
\`;

const handler = async (event) => {
    // Only handle agent:bootstrap
    if (event.type !== 'agent' || event.action !== 'bootstrap') {
        return;
    }

    // Skip sub-agent sessions to avoid bootstrap issues
    if (event.sessionKey && event.sessionKey.includes(':subagent:')) {
        return;
    }

    // Inject virtual file into bootstrap context
    if (Array.isArray(event.context.bootstrapFiles)) {
        event.context.bootstrapFiles.push({
            path: 'MNEMO_REMINDER.md',
            content: REMINDER_CONTENT,
            virtual: true,
        });
    }
};

export default handler;
`;

// ---------------------------------------------------------------------------
// OpenCode — plugin template
// ---------------------------------------------------------------------------

/**
 * OpenCode plugin for mnemo memory reminders.
 * Subscribes to session lifecycle events.
 */
export const OPENCODE_PLUGIN_TS = `/**
 * Mnemo Memory Reminder Plugin for OpenCode
 * Injects memory management reminders at key session lifecycle points.
 */

const SESSION_START_REMINDER = \`${REMINDERS.sessionStart}\`;

const SESSION_END_REMINDER = \`${REMINDERS.sessionEnd}\`;

const COMPACTION_REMINDER = \`${REMINDERS.compaction}\`;

export const MnemoReminder = async ({ client }) => {
    return {
        event: async ({ event }) => {
            if (event.type === "session.created") {
                // Remind to search memory at session start
                try {
                    const sessions = await client.session.list();
                    const current = sessions.data?.[0];
                    if (current?.id) {
                        await client.session.prompt({
                            path: { id: current.id },
                            body: {
                                noReply: true,
                                parts: [{ type: "text", text: SESSION_START_REMINDER }],
                            },
                        });
                    }
                } catch {
                    // Best effort — don't break the session
                }
            }
            if (event.type === "session.idle") {
                // Remind to self-check at session end
                try {
                    const sessions = await client.session.list();
                    const current = sessions.data?.[0];
                    if (current?.id) {
                        await client.session.prompt({
                            path: { id: current.id },
                            body: {
                                noReply: true,
                                parts: [{ type: "text", text: SESSION_END_REMINDER }],
                            },
                        });
                    }
                } catch {
                    // Best effort
                }
            }
        },
        "experimental.session.compacting": async (input, output) => {
            output.context.push(COMPACTION_REMINDER);
        },
    };
};
`;

// ---------------------------------------------------------------------------
// Agent → hook config mapping
// ---------------------------------------------------------------------------

interface HookScriptConfig {
    /** Directory where hook files are installed */
    getHookDir: (home: string) => string;
    /** Files to generate: filename → content */
    files: Record<string, string>;
    /**
     * For Claude Code / Codex: path to settings.json that needs hook config merged.
     * For OpenClaw / OpenCode: null (no settings merge needed).
     */
    getSettingsPath?: (home: string) => string;
}

export const HOOK_CONFIGS: Record<AgentType, HookScriptConfig> = {
    'claude-code': {
        getHookDir: (home) => `${home}/.claude/hooks/mnemo`,
        files: {
            'mnemo-activator.sh': ACTIVATOR_SCRIPT,
        },
        getSettingsPath: (home) => `${home}/.claude/settings.json`,
    },
    codex: {
        getHookDir: (home) => `${home}/.codex/hooks/mnemo`,
        files: {
            'mnemo-activator.sh': ACTIVATOR_SCRIPT,
        },
        getSettingsPath: (home) => `${home}/.codex/settings.json`,
    },
    openclaw: {
        getHookDir: (home) => `${home}/.openclaw/hooks/mnemo`,
        files: {
            'HOOK.md': OPENCLAW_HOOK_MD,
            'handler.ts': OPENCLAW_HANDLER_TS,
        },
    },
    opencode: {
        getHookDir: (home) => `${home}/.config/opencode/plugins`,
        files: {
            'mnemo-reminder.ts': OPENCODE_PLUGIN_TS,
        },
    },
};
