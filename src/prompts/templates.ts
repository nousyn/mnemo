import { type AgentType } from '../core/config.js';

/**
 * Base memory management prompt — shared by all agents.
 */
const BASE_MEMORY_PROMPT = `
## Mnemo - Memory Management

You have access to a persistent memory system (Mnemo). Use it to retain important information across conversations.

Mnemo is not a full transcript archive. It is a system for preserving high-value long-term context across conversations.

### Quick Reference

| Situation | Action | Type |
|-----------|--------|------|
| User states a stable preference or working style | memory_save | preference |
| A decision is made that will affect future work | memory_save | decision |
| A reusable rule or convention is established | memory_save | rule |
| A long-term goal or direction is clarified | memory_save | goal |
| An unresolved thread must be resumed later | memory_save | continuity |
| Stable background info about user/project/topic | memory_save | profile or fact |
| A validated, reusable experience proves its worth | memory_save | experience |
| New conversation begins | memory_search | — |
| User references past discussions or decisions | memory_search | — |
| Entering a long-running project or topic | memory_search | — |
| Many notes accumulated or context window reset | memory_compress | — |
| A continuity thread has been resolved | memory_compress or memory_save | evolve type |

### When to search memory (memory_search):
- **At the START of each conversation**, search for relevant context based on the user's first message. This is your highest-priority Mnemo action — do it before anything else.
- Search before doing major work on an ongoing topic, project, or long-running discussion
- When the user references past discussions or decisions — watch for phrases like:
  - "do you remember...", "we discussed before...", "last time we..."
  - "didn't we decide...", "what was the conclusion on..."
  - "as we agreed...", "going back to..."
- When you need background context for a task
- memory_search returns **summaries** — use memory_get with the returned IDs to retrieve full content when needed

### When to save memory (memory_save):
- Save only high-value long-term context, not temporary details or full conversation logs
- Watch for these trigger patterns in conversation:

**Preferences** (→ type: preference):
- User says: "I prefer...", "always do it this way...", "don't ever...", "I like when..."
- User expresses a stable preference, working style, boundary, or requirement

**Decisions** (→ type: decision):
- User says: "let's go with...", "decided:", "the plan is...", "we'll use..."
- A question is resolved and the answer will affect future work

**Rules** (→ type: rule):
- User says: "from now on...", "going forward, always...", "the convention is..."
- A reusable workflow convention or agreement is established

**Goals** (→ type: goal):
- User says: "the long-term plan is...", "eventually we want...", "the vision is..."
- A long-term direction or objective is clarified

**Continuity** (→ type: continuity):
- A thread is left unresolved but will clearly be resumed
- User says: "we'll pick this up later...", "let's come back to this...", "not now, but..."

**Profile / Fact** (→ type: profile or fact):
- Stable background information about the user, project, or topic is surfaced

**Experience** (→ type: experience) — high bar:
- Only save when ALL three conditions are met: (1) the experience has been validated, (2) it is reusable across sessions, (3) it would meaningfully affect future work
- A single error, one-off debugging session, or unconfirmed workaround does NOT qualify

### When to initialize memory (memory_setup):
- When Mnemo has not been initialized yet and a memory tool reports that setup is required
- When the user asks to enable, configure, or set up Mnemo memory management
- Default to global scope for shared cross-project memory
- Use project scope only when the user explicitly wants isolated per-project memory

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

### Memory Lifecycle:
Memories are not static. They evolve as context matures:
- \`continuity\` → \`decision\` (when an open question is resolved)
- \`decision\` → \`rule\` (when a one-time choice becomes a standing convention)
- \`continuity\` → \`fact\` (when an open question is answered with stable info)
- \`experience\` → \`rule\` (when a validated experience becomes a default practice)

**Continuity closure**: When a \`continuity\` thread is resolved, do not leave it dangling — either transform it into the appropriate type (decision, fact, rule) or remove it if it no longer has long-term value. Stale continuity notes pollute the memory system.

**Dedup before adding**: When saving, always check if a similar memory already exists. Prefer updating or replacing existing memories over creating duplicates. Priority order: supplement existing → update existing → replace outdated → add new (last resort).

### Guidelines:
- Prefer this order: memory_search -> do the work -> memory_save -> memory_compress when needed
- Before saving, verify the information meets at least 2 of these 3 criteria: (1) useful across future sessions, (2) affects future work or decisions, (3) would require re-alignment if forgotten
- **Always specify a type when saving.** Determine the type first (preference, profile, goal, continuity, fact, decision, rule, or experience), then call memory_save with the type parameter. Saving without a type defeats the purpose of organized long-term memory.
- Save memories in concise, distilled form — capture the essence, not raw conversation
- Do not save routine task state, ordinary command output, or one-off debugging noise
- Use descriptive tags to categorize memories
- Always include relevant project/topic context in the memory content
- Do not save trivial or temporary information
- When searching, use semantic queries that describe the information you need

### Self-Check (after completing each task):
Ask yourself briefly:
- Did a durable conclusion, preference, or decision emerge from this conversation?
- Was an important thread left unresolved that I should save as continuity?
- Did I learn something reusable that would be lost without saving?
If the answer to any of these is yes and the save threshold is met, call memory_save before moving on.
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
