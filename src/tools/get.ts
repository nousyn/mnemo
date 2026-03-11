import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readNote } from '../core/notes.js';

/**
 * Register the memory_get tool
 */
export function registerGetTool(server: McpServer): void {
    server.registerTool(
        'memory_get',
        {
            title: 'Get Memory',
            description:
                'Retrieve the full content of one or more memory notes by their IDs. Use this after memory_search to get the complete content of relevant memories.',
            inputSchema: {
                ids: z.array(z.string()).min(1).describe('Array of note IDs to retrieve (from memory_search results)'),
            },
        },
        async ({ ids }) => {
            try {
                const results: Array<{
                    id: string;
                    content: string;
                    tags: string[];
                    source: string;
                    created: string;
                    type?: string;
                }> = [];
                const notFound: string[] = [];

                for (const id of ids) {
                    const note = await readNote(id);
                    if (note) {
                        results.push({
                            id: note.meta.id,
                            content: note.content,
                            tags: note.meta.tags,
                            source: note.meta.source,
                            created: note.meta.created,
                            type: note.meta.type,
                        });
                    } else {
                        notFound.push(id);
                    }
                }

                if (results.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: `No memories found for the given IDs: [${notFound.join(', ')}]`,
                            },
                        ],
                    };
                }

                const output = results
                    .map(
                        (r, i) =>
                            `### Memory ${i + 1}\n` +
                            `- **ID:** ${r.id}\n` +
                            (r.type ? `- **Type:** ${r.type}\n` : '') +
                            `- **Tags:** [${r.tags.join(', ')}]\n` +
                            `- **Source:** ${r.source}\n` +
                            `- **Created:** ${r.created}\n\n` +
                            `${r.content}`,
                    )
                    .join('\n\n---\n\n');

                let text = output;
                if (notFound.length > 0) {
                    text += `\n\n---\n\nNote: The following IDs were not found: [${notFound.join(', ')}]`;
                }

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Failed to retrieve memories: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );
}
