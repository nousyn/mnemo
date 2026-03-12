import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { saveNote, getNoteStats } from '../core/notes.js';
import { indexNote, isEmbeddingReady, findSimilar } from '../core/embedding.js';
import { COMPRESS_THRESHOLDS, MEMORY_TYPES } from '../core/config.js';

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
                        dedupWarning = `\n\nWarning: Similar memories already exist:\n${summaries}\nConsider using memory_get to check if this is a duplicate, or memory_compress to consolidate.`;
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
                    indexWarning = `\n\nWarning: Memory saved to disk but semantic indexing failed (${reason}). The note will be available via memory_search after the embedding model finishes loading.`;
                    console.error('Mnemo: indexing failed for note', note.meta.id, reason);
                }

                // Check if compression might be needed (program-level guardrail)
                const stats = await getNoteStats();
                let compressHint = '';

                if (stats.count > COMPRESS_THRESHOLDS.maxNotes || stats.totalSize > COMPRESS_THRESHOLDS.maxTotalSize) {
                    compressHint = `\n\nNote: Memory storage is growing large (${stats.count} notes, ${Math.round(stats.totalSize / 1000)}KB). Consider running memory_compress to consolidate and distill older memories.`;
                }

                const typeLine = `\nType: ${note.meta.type}`;
                const typeHint = !type
                    ? '\n\nWARNING: No type specified — force-defaulted to "fact". Always specify the correct type before saving. Untyped memories degrade retrieval quality.'
                    : '';

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Memory saved successfully.\n\nID: ${note.meta.id}${typeLine}\nTags: [${note.meta.tags.join(', ')}]${typeHint}${dedupWarning}${indexWarning}${compressHint}`,
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
