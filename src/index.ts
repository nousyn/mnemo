#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerSetupTool } from './tools/setup.js';
import { registerSaveTool } from './tools/save.js';
import { registerSearchTool } from './tools/search.js';
import { registerCompressTool } from './tools/compress.js';
import { preloadEmbedding } from './core/embedding.js';

const server = new McpServer({
    name: 'mnemo',
    version: '0.1.0',
    description: 'Memory management for AI coding assistants',
});

// Register all tools
registerSetupTool(server);
registerSaveTool(server);
registerSearchTool(server);
registerCompressTool(server);

async function main() {
    // Start loading the embedding model in the background immediately
    // so it's ready before the first tool call
    preloadEmbedding();

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Mnemo MCP server running on stdio');
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
