import { type AgentType } from '../core/config.js';

/**
 * Base memory management prompt — shared by all agents.
 */
const BASE_MEMORY_PROMPT = `
## Mnemo - Memory Management

You have access to a persistent memory system (Mnemo). Use it to retain important information across conversations.

Mnemo is not a full transcript archive. It is a system for preserving high-value long-term context across conversations.

### When to save memory (memory_save):
- Save only high-value long-term context, not temporary details or full conversation logs
- Save when the user expresses a stable preference, working style, boundary, or requirement
- Save when a decision is clearly made and will affect future work
- Save when a long-term goal or direction is clarified
- Save when an important continuity thread is opened that must be resumed later
- Save when a reusable rule or workflow convention is established
- Save a validated high-value experience only when it is likely to matter again across future conversations
- Before saving, prefer asking yourself whether the information will still matter in a future session

### When to initialize memory (memory_setup):
- When Mnemo has not been initialized yet and a memory tool reports that setup is required
- When the user asks to enable, configure, or set up Mnemo memory management
- Default to global scope for shared cross-project memory
- Use project scope only when the user explicitly wants isolated per-project memory

### When to search memory (memory_search):
- At the START of each conversation, search for relevant context based on the user's first message
- Search before doing major work on an ongoing topic, project, or long-running discussion
- When the user references past discussions or decisions
- When you need background context for a task
- When the user asks "do you remember..." or similar
- memory_search returns **summaries** — use memory_get with the returned IDs to retrieve full content when needed

### When to get full memory content (memory_get):
- After memory_search, when you need the complete content of specific memories
- Pass one or more note IDs from memory_search results to retrieve full content
- Only retrieve what you actually need — summaries from memory_search are often sufficient

### When to compress memory (memory_compress):
- When you notice the conversation has generated many memory notes
- When explicitly asked to organize or clean up memories
- Periodically during long conversations
- After context compaction or context window reset — when resuming from a compacted context, check if memories need consolidation before continuing work
- When a continuity thread has turned into a clear decision, rule, or fact and older notes should be consolidated
- Workflow: call memory_compress to get all notes → distill them into fewer, concise notes → call memory_compress_apply with the distilled notes and old IDs to atomically save new + delete old

### Guidelines:
- Prefer this order: memory_search -> do the work -> memory_save -> memory_compress when needed
- Before saving, verify the information meets at least 2 of these 3 criteria: (1) useful across future sessions, (2) affects future work or decisions, (3) would require re-alignment if forgotten
- Before saving new content, check if a similar memory already exists. Prefer updating or replacing existing memories over creating duplicates.
- Save memories in concise, distilled form - capture the essence, not raw conversation
- Do not save routine task state, ordinary command output, or one-off debugging noise
- Use descriptive tags to categorize memories
- Always include relevant project/topic context in the memory content
- Do not save trivial or temporary information
- When searching, use semantic queries that describe the information you need
`.trim();

/**
 * Agent-specific memory prompt overrides.
 * Appended after the base prompt for agents that need additional instructions.
 */
const AGENT_MEMORY_PROMPTS: Partial<Record<AgentType, string>> = {
    openclaw: `

### OpenClaw Integration:
- After each memory_save, also append the same content to your daily memory file (memory/YYYY-MM-DD.md) to keep OpenClaw's built-in memory in sync
- When you write to daily memory (memory/YYYY-MM-DD.md) or update MEMORY.md, also call memory_save to ensure cross-agent persistence
- During heartbeat memory maintenance (reviewing daily files → updating MEMORY.md), also call memory_compress to consolidate Mnemo memories`,
};

/**
 * Agent-specific configuration file paths
 */
const AGENT_CONFIG: Record<
    AgentType,
    {
        fileName: string;
        globalPath: (home: string) => string;
        projectPath: (cwd: string) => string;
    }
> = {
    opencode: {
        fileName: 'AGENTS.md',
        globalPath: (home) => `${home}/.config/opencode/AGENTS.md`,
        projectPath: (cwd) => `${cwd}/AGENTS.md`,
    },
    'claude-code': {
        fileName: 'CLAUDE.md',
        globalPath: (home) => `${home}/.claude/CLAUDE.md`,
        projectPath: (cwd) => `${cwd}/CLAUDE.md`,
    },
    openclaw: {
        fileName: 'AGENTS.md',
        globalPath: (home) => `${home}/.openclaw/workspace/AGENTS.md`,
        projectPath: (cwd) => `${cwd}/AGENTS.md`,
    },
    codex: {
        fileName: 'AGENTS.md',
        globalPath: (home) => `${home}/.codex/AGENTS.md`,
        projectPath: (cwd) => `${cwd}/AGENTS.md`,
    },
};

/**
 * Marker used to identify Mnemo's section in agent config files
 */
const MARKER_START = '<!-- mnemo:start -->';
const MARKER_END = '<!-- mnemo:end -->';

/**
 * Build the full memory prompt for a given agent type.
 * Falls back to base-only when no agent-specific override exists.
 */
function buildMemoryPrompt(agentType?: AgentType): string {
    const agentPrompt = agentType ? (AGENT_MEMORY_PROMPTS[agentType] ?? '') : '';
    return BASE_MEMORY_PROMPT + agentPrompt;
}

/**
 * Get the prompt block wrapped with markers
 */
export function getPromptBlock(agentType?: AgentType): string {
    return `${MARKER_START}\n${buildMemoryPrompt(agentType)}\n${MARKER_END}`;
}

/**
 * Check if content already has Mnemo prompt injected
 */
export function hasPromptInjected(content: string): boolean {
    return content.includes(MARKER_START);
}

/**
 * Inject or replace Mnemo prompt in content
 */
export function injectPrompt(existingContent: string, agentType?: AgentType): string {
    const block = getPromptBlock(agentType);

    if (hasPromptInjected(existingContent)) {
        // Replace existing block
        const regex = new RegExp(`${escapeRegex(MARKER_START)}[\\s\\S]*?${escapeRegex(MARKER_END)}`, 'g');
        return existingContent.replace(regex, block);
    }

    // Append to end
    const separator = existingContent.trim() ? '\n\n' : '';
    return existingContent.trimEnd() + separator + block + '\n';
}

/**
 * Get config file info for an agent type
 */
export function getAgentConfig(agentType: AgentType) {
    return AGENT_CONFIG[agentType];
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
