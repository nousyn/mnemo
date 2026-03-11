import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchNotes, isEmbeddingReady } from '../core/embedding.js';

/**
 * Extract a summary from note content: first line, or first ~200 chars.
 */
export function extractSummary(content: string, maxLen: number = 200): string {
    const firstLine = content.split('\n')[0].trim();
    if (firstLine.length <= maxLen) return firstLine;
    return firstLine.slice(0, maxLen) + '...';
}

/**
 * Register the memory_search tool
 */
export function registerSearchTool(server: McpServer): void {
    server.registerTool(
        'memory_search',
        {
            title: 'Search Memory',
            description:
                'Search through persistent high-value long-term context using semantic similarity. Returns summaries of matching memories so you can recover relevant background before continuing work.',
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

                // Return summaries instead of full content
                const output = results
                    .map(
                        (r, i) =>
                            `### Memory ${i + 1} (relevance: ${(r.score * 100).toFixed(1)}%)\n` +
                            `- **ID:** ${r.id}\n` +
                            `- **Tags:** [${r.tags}]\n` +
                            `- **Source:** ${r.source}\n` +
                            `- **Created:** ${r.created}\n` +
                            `- **Summary:** ${extractSummary(r.text)}`,
                    )
                    .join('\n\n---\n\n');

                return {
                    content: [
                        {
                            type: 'text' as const,
                            text: `Found ${results.length} relevant memories (use memory_get with IDs to retrieve full content):\n\n${output}`,
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
