import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteNotes } from '../core/notes.js';
import { removeMultipleFromIndex } from '../core/embedding.js';

/**
 * Register the memory_delete tool.
 *
 * Note: memory_compress and memory_compress_apply have been removed.
 * Exposing compression to the agent caused it to discard active context
 * before compaction, leading to irrecoverable memory loss. Memory lifecycle
 * management is now handled internally via passive eviction (see eviction.ts).
 */
export function registerDeleteTool(server: McpServer): void {
    server.registerTool(
        'memory_delete',
        {
            title: 'Delete Memory',
            description: 'Delete memory notes by their IDs. Use this to remove outdated or incorrect memories.',
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
