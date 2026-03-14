import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { saveNote } from '../core/notes.js';
import { indexNote, isEmbeddingReady, findSimilar } from '../core/embedding.js';
import { MEMORY_TYPES } from '../core/config.js';
import { runEviction } from '../core/eviction.js';

/**
 * Register the memory_save tool
 */
export function registerSaveTool(server: McpServer): void {
    server.registerTool(
        'memory_save',
        {
            title: 'Save Memory',
            description:
                'Save a piece of high-value long-term context as a persistent memory note. Use this for stable preferences, important decisions, long-term goals, reusable rules, or continuity that should matter across future conversations. Content should be distilled and concise, not raw conversation.',
            inputSchema: {
                content: z
                    .string()
                    .describe(
                        'The long-term context to save. It should capture the durable essence of what should still matter in future conversations.',
                    ),
                type: z
                    .enum(MEMORY_TYPES)
                    .optional()
                    .describe(
                        'Memory type classification. Helps organize and retrieve memories. Options: preference (user preferences/habits), profile (stable background info), goal (long-term directions), continuity (unresolved threads to resume), fact (stable objective info), decision (confirmed choices), rule (reusable conventions), experience (validated reusable lessons).',
                    ),
                tags: z
                    .array(z.string())
                    .optional()
                    .describe(
                        "Tags to categorize this memory. E.g., ['architecture', 'decision'], ['user-preference'], ['project-mnemo']",
                    ),
                source: z
                    .string()
                    .optional()
                    .describe("Source identifier, e.g., 'opencode', 'claude-code'. Defaults to 'unknown'."),
            },
        },
        async ({ content, type, tags, source }) => {
            try {
                // Fallback: default to 'fact' if type not provided
                const resolvedType = type || 'fact';

                // Dedup detection: check for similar existing notes before saving
                let dedupWarning = '';
                try {
                    const similar = await findSimilar(content);
                    if (similar.length > 0) {
                        const summaries = similar
                            .map(
                                (s) =>
                                    `  - ID: ${s.id} (similarity: ${(s.score * 100).toFixed(1)}%) — ${s.text.slice(0, 100)}...`,
                            )
                            .join('\n');
                        dedupWarning = `\n\nWarning: Similar memories already exist:\n${summaries}\nConsider using memory_get to check if this is a duplicate, or memory_delete to remove outdated ones.`;
                    }
                } catch {
                    // Best effort — don't block save if dedup check fails
                }

                // Save the note to disk
                const note = await saveNote(content, tags || [], source || 'unknown', resolvedType);

                // Try to index for semantic search (may be slow on first call)
                let indexWarning = '';
                try {
                    await indexNote(note);
                } catch (indexError) {
                    const reason = indexError instanceof Error ? indexError.message : String(indexError);
                    indexWarning = `\n\nWarning: Memory saved to disk but semantic indexing failed (${reason}). The note is safely persisted and will be automatically indexed on next search via integrity repair.`;
                    console.error('Mnemo: indexing failed for note', note.meta.id, reason);
                }

                const typeLine = `\nType: ${note.meta.type}`;
                const typeHint = !type
                    ? '\n\nWARNING: No type specified — force-defaulted to "fact". Always specify the correct type before saving. Untyped memories degrade retrieval quality.'
                    : '';

                // Trigger passive eviction in the background (fire-and-forget)
                runEviction().catch((err) => {
                    console.error('Mnemo: eviction failed:', err instanceof Error ? err.message : String(err));
                });

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Memory saved successfully.\n\nID: ${note.meta.id}${typeLine}\nTags: [${note.meta.tags.join(', ')}]${typeHint}${dedupWarning}${indexWarning}`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Failed to save memory: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );
}
