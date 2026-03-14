import { type AgentType } from '../core/config.js';

/**
 * Base memory management prompt — shared by all agents.
 */
const BASE_MEMORY_PROMPT = `
## Mnemo - Persistent Memory

You have a persistent memory system (Mnemo). It preserves high-value long-term context across conversations — not transcripts.

### Core Rules
- **Search first**: At the START of each conversation, call memory_search based on the user's message before doing work.
- **Save selectively**: A memory must meet \u22652 of: (1) useful across sessions, (2) affects future work, (3) would need re-alignment if forgotten.
- **Always specify type** when saving: preference, profile, goal, continuity, fact, decision, rule, or experience.
- **Dedup before saving**: Check if similar memory exists. Prefer updating/replacing over creating duplicates.
- **Distill, don't dump**: Save the essence, not raw conversation. No routine output or one-off debugging noise.
- **Lifecycle**: Memories evolve — continuity\u2192decision (resolved), decision\u2192rule (becomes convention), continuity\u2192fact (answered). Close stale continuity threads.
`.trim();

/**
 * Agent-specific memory prompt overrides.
 * Appended after the base prompt for agents that need additional instructions.
 */
const AGENT_MEMORY_PROMPTS: Partial<Record<AgentType, string>> = {
    openclaw: `

### OpenClaw Integration:
- After each memory_save, also append the same content to your daily memory file (memory/YYYY-MM-DD.md) to keep OpenClaw's built-in memory in sync
- When you write to daily memory (memory/YYYY-MM-DD.md) or update MEMORY.md, also call memory_save to ensure cross-agent persistence`,
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
