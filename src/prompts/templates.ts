import { type AgentType } from '../core/config.js';

/**
 * Base memory management prompt — shared by all agents.
 */
const BASE_MEMORY_PROMPT = `
## Mnemo - Persistent Memory

You have a persistent memory system (Mnemo). It preserves high-value long-term context across conversations — not transcripts.

### Core Rules
- **Save selectively**: A memory must meet ≥2 of: (1) useful across sessions, (2) affects future work, (3) would need re-alignment if forgotten.
- **Always specify type** when saving: preference, profile, goal, continuity, fact, decision, rule, or experience.
- **Dedup before saving**: Check if similar memory exists. Prefer updating/replacing over creating duplicates.
- **Distill, don't dump**: Save the essence, not raw conversation. No routine output or one-off debugging noise.
- **Lifecycle**: Memories evolve — continuity→decision (resolved), decision→rule (becomes convention), continuity→fact (answered). Close stale continuity threads.
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
 * Build the full memory prompt for a given agent type.
 * Falls back to base-only when no agent-specific override exists.
 */
export function buildMemoryPrompt(agentType?: AgentType): string {
    const agentPrompt = agentType ? (AGENT_MEMORY_PROMPTS[agentType] ?? '') : '';
    return BASE_MEMORY_PROMPT + agentPrompt;
}
