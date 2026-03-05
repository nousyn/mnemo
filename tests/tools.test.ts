import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerSaveTool } from '../src/tools/save.js';
import { registerSearchTool } from '../src/tools/search.js';
import { registerCompressTool } from '../src/tools/compress.js';
import { registerSetupTool } from '../src/tools/setup.js';
import { preloadEmbedding, embed } from '../src/core/embedding.js';

let tmpDir: string;
let client: Client;
let server: McpServer;

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-tools-test-'));
    process.env.MNEMO_DATA_DIR = tmpDir;

    // 预加载 embedding 模型
    preloadEmbedding();
    await embed('warmup');

    // 创建 MCP server + client
    server = new McpServer({ name: 'mnemo-test', version: '0.1.0' });
    registerSaveTool(server);
    registerSearchTool(server);
    registerCompressTool(server);
    registerSetupTool(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: 'test-client', version: '1.0' });
    await client.connect(clientTransport);
}, 60_000);

afterAll(async () => {
    await client.close();
    await server.close();
    delete process.env.MNEMO_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
});

function getResponseText(result: any): string {
    return result.content?.[0]?.text || '';
}

describe('tools/list', () => {
    it('应该列出所有 6 个工具', async () => {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name).sort();
        expect(names).toEqual([
            'memory_compress',
            'memory_compress_apply',
            'memory_delete',
            'memory_save',
            'memory_search',
            'memory_setup',
        ]);
    });
});

describe('memory_save 工具', () => {
    it('应该成功保存笔记并返回 ID', async () => {
        const result = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '工具测试：用户偏好 4 空格缩进',
                tags: ['test', 'preference'],
                source: 'opencode',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('Memory saved successfully');
        expect(text).toMatch(/ID: \d{8}-\d{6}-[a-f0-9]{4}/);
        expect(text).toContain('test');
        expect(text).toContain('preference');
    });

    it('无 tags 和 source 也应成功', async () => {
        const result = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '最简保存测试',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('Memory saved successfully');
    });
});

describe('memory_search 工具', () => {
    it('应该能搜索到之前保存的笔记', async () => {
        // 先保存一条有特征的笔记
        await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '项目使用 Vitest 作为测试框架，配合 TypeScript 使用',
                tags: ['tooling'],
                source: 'opencode',
            },
        });

        const result = await client.callTool({
            name: 'memory_search',
            arguments: {
                query: '测试框架选择',
                top_k: 3,
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('relevant memories');
        expect(text).toContain('Vitest');
    });

    it('source_filter 应该过滤结果', async () => {
        await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '独特的 claude 测试笔记 xyzzy',
                tags: ['filter-test'],
                source: 'claude-code',
            },
        });

        const result = await client.callTool({
            name: 'memory_search',
            arguments: {
                query: 'xyzzy',
                top_k: 10,
                source_filter: 'opencode',
            },
        });

        const text = getResponseText(result);
        // 过滤了 claude-code 来源，不应出现该笔记
        expect(text).not.toContain('xyzzy');
    });
});

describe('memory_compress 工具', () => {
    it('review 策略应返回所有笔记供蒸馏', async () => {
        const result = await client.callTool({
            name: 'memory_compress',
            arguments: { strategy: 'review' },
        });

        const text = getResponseText(result);
        expect(text).toContain('memories to compress');
        expect(text).toContain('memory_compress_apply');
        expect(text).toContain('Original note IDs to delete');
    });

    it('auto_tag 策略应返回标签统计', async () => {
        const result = await client.callTool({
            name: 'memory_compress',
            arguments: { strategy: 'auto_tag' },
        });

        const text = getResponseText(result);
        expect(text).toContain('Memory statistics');
        expect(text).toContain('Tag distribution');
    });

    it('older_than_days 过滤应生效', async () => {
        // 所有笔记都是刚创建的，用 1 天过滤应该找不到
        const result = await client.callTool({
            name: 'memory_compress',
            arguments: { strategy: 'review', older_than_days: 1 },
        });

        const text = getResponseText(result);
        expect(text).toContain('No memories older than');
    });
});

describe('memory_delete 工具', () => {
    it('应该成功删除指定笔记', async () => {
        const saveResult = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '待删除的工具测试笔记',
                tags: ['delete-test'],
                source: 'opencode',
            },
        });

        const id = getResponseText(saveResult).match(/ID: ([\w-]+)/)?.[1];
        expect(id).toBeTruthy();

        const deleteResult = await client.callTool({
            name: 'memory_delete',
            arguments: { ids: [id!] },
        });

        const text = getResponseText(deleteResult);
        expect(text).toContain('Deleted 1 of 1');
    });

    it('删除不存在的 ID 应该返回 0', async () => {
        const result = await client.callTool({
            name: 'memory_delete',
            arguments: { ids: ['nonexistent'] },
        });

        const text = getResponseText(result);
        expect(text).toContain('Deleted 0 of 1');
    });
});

describe('memory_compress_apply 工具', () => {
    it('应该原子性地保存新笔记并删除旧笔记', async () => {
        // 先保存两条笔记
        const save1 = await client.callTool({
            name: 'memory_save',
            arguments: { content: '压缩测试笔记 A', tags: ['compress-test'], source: 'opencode' },
        });
        const save2 = await client.callTool({
            name: 'memory_save',
            arguments: { content: '压缩测试笔记 B', tags: ['compress-test'], source: 'opencode' },
        });

        const id1 = getResponseText(save1).match(/ID: ([\w-]+)/)?.[1];
        const id2 = getResponseText(save2).match(/ID: ([\w-]+)/)?.[1];
        expect(id1).toBeTruthy();
        expect(id2).toBeTruthy();

        // 用 compress_apply 把两条蒸馏成一条
        const result = await client.callTool({
            name: 'memory_compress_apply',
            arguments: {
                notes: [{ content: '蒸馏后的合并笔记 AB', tags: ['compressed'] }],
                old_ids: [id1!, id2!],
                source: 'opencode',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('Compression applied successfully');
        expect(text).toContain('New notes saved: 1');
        expect(text).toContain('Old notes deleted: 2 of 2');
    });

    it('旧 ID 不存在时也应成功（删除 0 条）', async () => {
        const result = await client.callTool({
            name: 'memory_compress_apply',
            arguments: {
                notes: [{ content: '新笔记', tags: ['test'] }],
                old_ids: ['nonexistent-id-1', 'nonexistent-id-2'],
                source: 'opencode',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('Compression applied successfully');
        expect(text).toContain('New notes saved: 1');
        expect(text).toContain('Old notes deleted: 0 of 2');
    });

    it('应该可以保存多条蒸馏笔记', async () => {
        const result = await client.callTool({
            name: 'memory_compress_apply',
            arguments: {
                notes: [
                    { content: '蒸馏笔记 1', tags: ['a'] },
                    { content: '蒸馏笔记 2', tags: ['b'] },
                    { content: '蒸馏笔记 3', tags: ['c'] },
                ],
                old_ids: [],
                source: 'opencode',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('New notes saved: 3');
        expect(text).toContain('Old notes deleted: 0 of 0');
    });
});

describe('memory_setup 工具', () => {
    it('指定 agent_type 应该成功写入配置文件', async () => {
        // 使用 claude-code 以避免与项目自身的 AGENTS.md 冲突
        // scope=global 写入临时 home 目录
        const fakeHome = path.join(tmpDir, 'home');
        await fs.mkdir(path.join(fakeHome, '.claude'), { recursive: true });

        // 临时覆盖 cwd 不影响其他测试，直接用 project scope 测试 claude-code
        const result = await client.callTool({
            name: 'memory_setup',
            arguments: {
                agent_type: 'claude-code',
                scope: 'project',
            },
        });

        const text = getResponseText(result);
        // 首次写入应返回 initialized 或 updated（取决于文件是否已存在）
        expect(text).toMatch(/initialized successfully|updated/);
    });

    it('重复调用应该更新而非报错', async () => {
        const result = await client.callTool({
            name: 'memory_setup',
            arguments: {
                agent_type: 'claude-code',
                scope: 'project',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('updated');
    });
});
