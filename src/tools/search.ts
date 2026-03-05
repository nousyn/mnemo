import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchNotes, isEmbeddingReady } from '../core/embedding.js';
import { readNote } from '../core/notes.js';

/**
 * Register the memory_search tool
 */
export function registerSearchTool(server: McpServer): void {
    server.registerTool(
        'memory_search',
        {
            title: 'Search Memory',
            description:
                'Search through persistent memories using semantic similarity. Use this at the start of conversations to load relevant context, when the user references past discussions, or when you need background information for a task.',
            inputSchema: {
                query: z
                    .string()
                    .describe(
                        "Natural language description of what you're looking for. E.g., 'architecture decisions for the mnemo project', 'user preferences about code style'",
                    ),
                top_k: z
                    .number()
                    .int()
                    .min(1)
                    .max(20)
                    .default(5)
                    .optional()
                    .describe('Maximum number of results to return (default: 5)'),
                source_filter: z
                    .string()
                    .optional()
                    .describe("Filter results by source agent tool, e.g., 'opencode', 'claude-code'"),
                tag_filter: z
                    .array(z.string())
                    .optional()
                    .describe(
                        'Filter results to only include notes that have ALL of the specified tags. E.g., ["architecture", "decision"]',
                    ),
            },
        },
        async ({ query, top_k, source_filter, tag_filter }) => {
            try {
                if (!isEmbeddingReady()) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: 'Mnemo is still loading the embedding model. Please try again in a few seconds.',
                            },
                        ],
                    };
                }

                // When tag_filter is used, fetch more results to compensate for post-filtering
                const fetchK = tag_filter && tag_filter.length > 0 ? (top_k || 5) * 3 : top_k || 5;
                let results = await searchNotes(query, fetchK, source_filter);

                // Post-filter by tags if specified
                if (tag_filter && tag_filter.length > 0) {
                    results = results.filter((r) => {
                        const noteTags = r.tags.split(',').filter(Boolean);
                        return tag_filter.every((t) => noteTags.includes(t));
                    });
                    results = results.slice(0, top_k || 5);
                }

                if (results.length === 0) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: 'No relevant memories found.',
                            },
                        ],
                    };
                }

                // For each result, load the full note content
                const enrichedResults = await Promise.all(
                    results.map(async (r) => {
                        const note = await readNote(r.id);
                        return {
                            id: r.id,
                            score: r.score,
                            content: note?.content || r.text,
                            tags: note?.meta.tags || r.tags.split(',').filter(Boolean),
                            source: r.source,
                            created: r.created,
                        };
                    }),
                );

                const output = enrichedResults
                    .map(
                        (r, i) =>
                            `### Memory ${i + 1} (relevance: ${(r.score * 100).toFixed(1)}%)\n` +
                            `- **ID:** ${r.id}\n` +
                            `- **Tags:** [${Array.isArray(r.tags) ? r.tags.join(', ') : r.tags}]\n` +
                            `- **Source:** ${r.source}\n` +
                            `- **Created:** ${r.created}\n\n` +
                            `${r.content}`,
                    )
                    .join('\n\n---\n\n');

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Found ${results.length} relevant memories:\n\n${output}`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Failed to search memories: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        },
    );
}
