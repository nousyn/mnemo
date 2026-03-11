import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readAllNotes, saveNote, deleteNotes, getNoteStats } from '../core/notes.js';
import { indexNote, removeMultipleFromIndex } from '../core/embedding.js';

/**
 * Register the memory_compress tool
 */
export function registerCompressTool(server: McpServer): void {
    server.registerTool(
        'memory_compress',
        {
            title: 'Compress Memory',
            description:
                'Consolidate and compress existing long-term memories. This tool reads current notes, asks you to distill them into fewer and clearer memories, and helps keep the knowledge base focused on durable high-value context instead of fragmented history.',
            inputSchema: {
                strategy: z
                    .enum(['review', 'auto_tag'])
                    .default('review')
                    .optional()
                    .describe(
                        "'review' (default): Returns all notes for you to manually distill. 'auto_tag': Only re-organizes tags without changing content.",
                    ),
                older_than_days: z
                    .number()
                    .int()
                    .min(1)
                    .optional()
                    .describe('Only include notes older than this many days. If not specified, includes all notes.'),
            },
        },
        async ({ strategy, older_than_days }) => {
            try {
                const allNotes = await readAllNotes();

                if (allNotes.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: 'No memories to compress.',
                            },
                        ],
                    };
                }

                // Filter by age if specified
                let targetNotes = allNotes;
                if (older_than_days) {
                    const cutoff = new Date();
                    cutoff.setDate(cutoff.getDate() - older_than_days);
                    targetNotes = allNotes.filter((n) => new Date(n.meta.created) < cutoff);
                }

                if (targetNotes.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `No memories older than ${older_than_days} days to compress.`,
                            },
                        ],
                    };
                }

                const stats = await getNoteStats();

                if (strategy === 'auto_tag') {
                    // Just return stats, no content modification
                    const tagMap = new Map<string, number>();
                    for (const note of targetNotes) {
                        for (const tag of note.meta.tags) {
                            tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
                        }
                    }

                    const tagSummary = Array.from(tagMap.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([tag, count]) => `  - ${tag}: ${count} notes`)
                        .join('\n');

                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `Memory statistics:\n- Total notes: ${stats.count}\n- Total size: ${Math.round(stats.totalSize / 1000)}KB\n- Target notes for compression: ${targetNotes.length}\n\nTag distribution:\n${tagSummary}`,
                            },
                        ],
                    };
                }

                // Strategy: review - return all notes for LLM to distill
                const notesText = targetNotes
                    .map(
                        (n) =>
                            `[ID: ${n.meta.id}] [Tags: ${n.meta.tags.join(', ')}] [Created: ${n.meta.created}]\n${n.content}`,
                    )
                    .join('\n\n---\n\n');

                const noteIds = targetNotes.map((n) => n.meta.id);

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Found ${targetNotes.length} memories to compress (${Math.round(stats.totalSize / 1000)}KB total).\n\nPlease review the following memories and distill them into fewer, more concise notes. After reviewing, use memory_compress_apply to submit the compressed versions — it will atomically save the new notes and delete the originals.\n\nOriginal note IDs to delete after compression: [${noteIds.join(', ')}]\n\n---\n\n${notesText}`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Failed to compress memories: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );

    // Register the delete tool
    server.registerTool(
        'memory_delete',
        {
            title: 'Delete Memory',
            description:
                'Delete memory notes by their IDs. Primarily used after memory_compress to remove the original notes that have been consolidated into compressed versions.',
            inputSchema: {
                ids: z.array(z.string()).describe('Array of note IDs to delete'),
            },
        },
        async ({ ids }) => {
            try {
                // Remove from vector index
                await removeMultipleFromIndex(ids);

                // Remove from disk
                const deletedCount = await deleteNotes(ids);

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Deleted ${deletedCount} of ${ids.length} memory notes.`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Failed to delete memories: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );

    // Register the compress_apply tool (atomic save new + delete old)
    server.registerTool(
        'memory_compress_apply',
        {
            title: 'Apply Compression',
            description:
                'Atomically apply memory compression results. Saves the distilled notes and deletes the originals in one operation. Use this after memory_compress returns notes for review — distill them and submit the results here.',
            inputSchema: {
                notes: z
                    .array(
                        z.object({
                            content: z.string().describe('The distilled note content'),
                            tags: z.array(z.string()).optional().describe('Tags for this note'),
                        }),
                    )
                    .describe('Array of distilled notes to save'),
                old_ids: z
                    .array(z.string())
                    .describe('IDs of the original notes to delete (from memory_compress output)'),
                source: z.string().optional().describe("Source identifier, defaults to 'unknown'"),
            },
        },
        async ({ notes, old_ids, source }) => {
            try {
                // Step 1: Save all new notes
                const savedNotes = [];
                for (const n of notes) {
                    const saved = await saveNote(n.content, n.tags || [], source || 'unknown');
                    savedNotes.push(saved);
                }

                // Step 2: Index new notes
                const indexWarnings: string[] = [];
                for (const saved of savedNotes) {
                    try {
                        await indexNote(saved);
                    } catch (err) {
                        const reason = err instanceof Error ? err.message : String(err);
                        indexWarnings.push(`${saved.meta.id}: ${reason}`);
                    }
                }

                // Step 3: Remove old notes from index
                await removeMultipleFromIndex(old_ids);

                // Step 4: Delete old notes from disk
                const deletedCount = await deleteNotes(old_ids);

                const newIds = savedNotes.map((n) => n.meta.id);
                let result = `Compression applied successfully.\n\n- New notes saved: ${savedNotes.length} [${newIds.join(', ')}]\n- Old notes deleted: ${deletedCount} of ${old_ids.length}`;

                if (indexWarnings.length > 0) {
                    result += `\n\nWarning: Some notes could not be indexed (will be available after embedding model loads):\n${indexWarnings.join('\n')}`;
                }

                return {
                    content: [{ type: 'text' as const, text: result }],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Failed to apply compression: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );
}
