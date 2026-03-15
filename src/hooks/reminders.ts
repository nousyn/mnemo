import { defineHooks, type AgentType, type HookSet } from '@s_s/agent-kit';

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
If nothing qualifies, skip. Don't force saves.
</mnemo-reminder>`,

    /** Session start reminder */
    sessionStart: `<mnemo-session-start>
Search memory for relevant context before starting work.
Call memory_search with a query based on the user's message.
</mnemo-session-start>`,

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
// OpenClaw — handler.ts template
// ---------------------------------------------------------------------------

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
 * Uses experimental.chat.messages.transform for invisible injection.
 */
export const OPENCODE_PLUGIN_TS = `/**
 * Mnemo Memory Reminder Plugin for OpenCode
 * Injects memory management reminders invisibly via message transform.
 */

const SESSION_START_REMINDER = \`${REMINDERS.sessionStart}

${REMINDERS.perTurn}\`;

const PER_TURN_REMINDER = \`${REMINDERS.perTurn}\`;

// Track which sessions have already received the start reminder
const seenSessions = new Set();

export const MnemoReminder = async () => {
    return {
        "experimental.chat.messages.transform": async (_input, output) => {
            const messages = output.messages;
            if (!messages || messages.length === 0) return;

            // Skip all injection after compaction — let the LLM work cleanly
            // from the compaction summary without any mnemo interference.
            const isPostCompaction = messages.some(m =>
                m.info?.role === "user" && m.parts?.some(p => p.type === "compaction")
            );
            if (isPostCompaction) return;

            // Determine session ID from the first message
            const sessionID = messages[0]?.info?.sessionID;
            const isNewSession = sessionID && !seenSessions.has(sessionID);
            if (sessionID) seenSessions.add(sessionID);

            // Pick the appropriate reminder
            const reminder = isNewSession ? SESSION_START_REMINDER : PER_TURN_REMINDER;

            // Find the last user message and append the reminder to its parts
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].info?.role === "user") {
                    messages[i].parts.push({ type: "text", text: reminder });
                    break;
                }
            }
        },
    };
};
`;

// ---------------------------------------------------------------------------
// Hook definitions via agent-kit defineHooks()
// ---------------------------------------------------------------------------

/**
 * Get validated HookSet definitions for a specific agent type.
 * Returns the HookSet(s) ready to pass to kit.installHooks().
 */
export function getHookSets(agentType: AgentType): HookSet[] {
    switch (agentType) {
        case 'claude-code':
            return [
                defineHooks('claude-code', {
                    events: ['UserPromptSubmit'],
                    content: ACTIVATOR_SCRIPT,
                }),
            ];
        case 'codex':
            return [
                defineHooks('codex', {
                    events: ['UserPromptSubmit'],
                    content: ACTIVATOR_SCRIPT,
                }),
            ];
        case 'openclaw':
            return [
                defineHooks('openclaw', {
                    events: ['agent:bootstrap'],
                    content: OPENCLAW_HANDLER_TS,
                    description: 'Injects memory management reminder during agent bootstrap',
                }),
            ];
        case 'opencode':
            return [
                defineHooks('opencode', {
                    events: ['experimental.chat.messages.transform'],
                    content: OPENCODE_PLUGIN_TS,
                }),
            ];
    }
}
