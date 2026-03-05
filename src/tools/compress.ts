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
                'Consolidate and compress existing memory notes. This tool reads all current memories, asks you to distill them into fewer, more concise notes, and replaces the originals. Use this when memory storage grows large, or to periodically organize and clean up memories. The tool returns all current memories for you to review and distill - respond with the compressed version using memory_save.',
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
                            text: `Found ${targetNotes.length} memories to compress (${Math.round(stats.totalSize / 1000)}KB total).\n\nPlease review the following memories and distill them into fewer, more concise notes. After reviewing, use memory_save to save the compressed versions, then use memory_delete to remove the originals.\n\nOriginal note IDs to delete after compression: [${noteIds.join(', ')}]\n\n---\n\n${notesText}`,
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

    // Register the delete tool (used during compression)
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
}
