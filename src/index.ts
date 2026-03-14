#!/usr/bin/env node

import { AGENT_TYPES, type AgentType, type StorageScope } from './core/config.js';

const VALID_SCOPES: StorageScope[] = ['global', 'project'];

/**
 * Parse CLI arguments for the setup subcommand.
 * Supports: --agent <type>, --scope <scope>, --project-root <path>
 */
function parseSetupArgs(args: string[]): {
    agentType?: AgentType;
    scope?: StorageScope;
    projectRoot?: string;
} {
    const result: { agentType?: AgentType; scope?: StorageScope; projectRoot?: string } = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        if (arg === '--agent' && next) {
            if (!AGENT_TYPES.includes(next as AgentType)) {
                console.error(`Invalid agent type: ${next}. Valid values: ${AGENT_TYPES.join(', ')}`);
                process.exit(1);
            }
            result.agentType = next as AgentType;
            i++;
        } else if (arg === '--scope' && next) {
            if (!VALID_SCOPES.includes(next as StorageScope)) {
                console.error(`Invalid scope: ${next}. Valid values: ${VALID_SCOPES.join(', ')}`);
                process.exit(1);
            }
            result.scope = next as StorageScope;
            i++;
        } else if (arg === '--project-root' && next) {
            result.projectRoot = next;
            i++;
        }
    }

    return result;
}

async function runCLISetup(args: string[]) {
    const { runSetup } = await import('./tools/setup.js');
    const options = parseSetupArgs(args);
    const result = await runSetup(options);

    if (result.success) {
        console.log(result.message);
    } else {
        console.error(result.message);
        process.exit(1);
    }
}

async function runMcpServer() {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    const { registerSaveTool } = await import('./tools/save.js');
    const { registerSearchTool } = await import('./tools/search.js');
    const { registerCompressTool } = await import('./tools/compress.js');
    const { registerGetTool } = await import('./tools/get.js');
    const { preloadEmbedding } = await import('./core/embedding.js');

    const server = new McpServer({
        name: 'mnemo',
        version: '0.1.0',
        description: 'Memory management for AI coding assistants',
    });

    // Register all tools (6 tools: save, search, get, compress, delete, compress_apply)
    registerSaveTool(server);
    registerSearchTool(server);
    registerGetTool(server);
    registerCompressTool(server);

    // Start loading the embedding model in the background immediately
    // so it's ready before the first tool call
    preloadEmbedding();

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Mnemo MCP server running on stdio');
}

// Route: CLI subcommand or MCP server
const subcommand = process.argv[2];

if (subcommand === 'setup') {
    runCLISetup(process.argv.slice(3)).catch((error) => {
        console.error('Setup failed:', error);
        process.exit(1);
    });
} else if (subcommand === '--help' || subcommand === '-h') {
    console.log(`Usage:
  mnemo              Start the MCP server (stdio mode)
  mnemo setup        Initialize Mnemo for your AI agent

Setup options:
  --agent <type>     Agent type: ${AGENT_TYPES.join(', ')}
  --scope <scope>    Storage scope: global (default), project
  --project-root <path>  Explicit project root (for project scope)`);
} else {
    runMcpServer().catch((error) => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}
