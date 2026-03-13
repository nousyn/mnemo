import { describe, it, expect, beforeAll, afterAll, vi, type TaskContext } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerSaveTool } from '../src/tools/save.js';
import { registerSearchTool } from '../src/tools/search.js';
import { registerGetTool } from '../src/tools/get.js';
import { registerCompressTool } from '../src/tools/compress.js';
import { registerSetupTool } from '../src/tools/setup.js';
import { preloadEmbedding, embed } from '../src/core/embedding.js';
import { extractSummary } from '../src/tools/search.js';
import { writeStorageConfig } from '../src/core/config.js';

let tmpDir: string;
let client: Client;
let server: McpServer;
let embeddingAvailable = false;

/** 在 embedding 模型不可用时跳过测试 */
function requireEmbedding(ctx: TaskContext) {
    if (!embeddingAvailable) ctx.skip();
}

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-tools-test-'));
    process.env.MNEMO_DATA_DIR = tmpDir;
    await writeStorageConfig('global');

    // 尝试预加载 embedding 模型，网络不可用时标记为不可用
    try {
        preloadEmbedding();
        await embed('warmup');
        embeddingAvailable = true;
    } catch {
        console.warn('Embedding model unavailable, skipping embedding-dependent tests');
    }

    // 创建 MCP server + client（不依赖 embedding）
    server = new McpServer({ name: 'mnemo-test', version: '0.1.0' });
    registerSaveTool(server);
    registerSearchTool(server);
    registerGetTool(server);
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
    it('应该列出所有 7 个工具', async () => {
        const { tools } = await client.listTools();
        const names = tools.map((t) => t.name).sort();
        expect(names).toEqual([
            'memory_compress',
            'memory_compress_apply',
            'memory_delete',
            'memory_get',
            'memory_save',
            'memory_search',
            'memory_setup',
        ]);
    });

    it('关键工具描述应体现长期上下文定位', async () => {
        const { tools } = await client.listTools();
        const saveTool = tools.find((t) => t.name === 'memory_save');
        const searchTool = tools.find((t) => t.name === 'memory_search');
        const compressTool = tools.find((t) => t.name === 'memory_compress');

        expect(saveTool?.description).toContain('high-value long-term context');
        expect(searchTool?.description).toContain('long-term context');
        expect(compressTool?.description).toContain('durable high-value context');
    });
});

describe('memory_save 工具', () => {
    it('应该成功保存笔记并返回 ID', async () => {
        const result = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '工具测试：用户偏好 4 空格缩进',
                type: 'preference',
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
                type: 'fact',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('Memory saved successfully');
        expect(text).toContain('Type: fact');
    });

    it('不传 type 应 fallback 为 fact 并给出提示', async () => {
        const result = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '无 type 的保存测试',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('Memory saved successfully');
        expect(text).toContain('Type: fact');
        expect(text).toContain('No type specified');
        expect(text).toContain('force-defaulted to "fact"');
    });

    it('指定 type 应保存并显示类型', async () => {
        const result = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '架构决策：使用 MCP 作为通信协议',
                type: 'decision',
                tags: ['architecture'],
                source: 'opencode',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('Memory saved successfully');
        expect(text).toContain('Type: decision');
    });

    it('保存近似重复内容时应返回去重警告', async (ctx) => {
        requireEmbedding(ctx);
        // 先保存一条笔记
        await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '项目使用 Prettier 进行代码格式化，配置 singleQuote 和 tabWidth 4',
                type: 'rule',
                tags: ['dedup-test'],
                source: 'opencode',
            },
        });

        // 保存语义近似的内容
        const result = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '代码格式化使用 Prettier，配置为 singleQuote 和 tabWidth 4',
                type: 'rule',
                tags: ['dedup-test'],
                source: 'opencode',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('Memory saved successfully');
        // 应该有去重警告
        expect(text).toContain('Similar memories already exist');
    });

    it('保存完全不同的内容时不应触发去重警告', async (ctx) => {
        requireEmbedding(ctx);
        const result = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '完全独特的内容：量子计算在密码学中的应用前景 uniqueQuantumCrypto',
                type: 'fact',
                tags: ['unique-test'],
                source: 'opencode',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('Memory saved successfully');
        expect(text).not.toContain('Similar memories already exist');
    });
});

describe('memory_search 工具', () => {
    it('应该能搜索到之前保存的笔记（返回摘要）', async (ctx) => {
        requireEmbedding(ctx);
        // 先保存一条有特征的笔记
        await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '项目使用 Vitest 作为测试框架，配合 TypeScript 使用',
                type: 'fact',
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
        expect(text).toContain('memory_get');
        expect(text).toContain('Summary:');
    });

    it('source_filter 应该过滤结果', async () => {
        await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '独特的 claude 测试笔记 xyzzy',
                type: 'fact',
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

    it('tag_filter 应该只返回包含指定标签的笔记', async () => {
        // 保存一条有特殊 tag 的笔记
        await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '架构决策：使用 vectra 做本地向量存储 qwerty',
                type: 'decision',
                tags: ['architecture', 'decision'],
                source: 'opencode',
            },
        });

        // 用 tag_filter 搜索
        const result = await client.callTool({
            name: 'memory_search',
            arguments: {
                query: '向量存储',
                top_k: 10,
                tag_filter: ['architecture'],
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('architecture');
    });

    it('tag_filter 不匹配时应返回空结果', async () => {
        const result = await client.callTool({
            name: 'memory_search',
            arguments: {
                query: '向量存储 qwerty',
                top_k: 10,
                tag_filter: ['nonexistent-tag-xyz'],
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('No relevant memories found');
    });

    it('type_filter 应该按类型过滤结果', async () => {
        // 保存一条 decision 类型的笔记
        await client.callTool({
            name: 'memory_save',
            arguments: {
                content: 'type_filter 测试：选择 PostgreSQL 作为数据库 typeFilterPgTest',
                type: 'decision',
                tags: ['type-filter-test'],
                source: 'opencode',
            },
        });
        // 保存一条 rule 类型的笔记
        await client.callTool({
            name: 'memory_save',
            arguments: {
                content: 'type_filter 测试：所有 SQL 查询必须参数化 typeFilterSqlRule',
                type: 'rule',
                tags: ['type-filter-test'],
                source: 'opencode',
            },
        });

        // 用 type_filter=decision 搜索
        const result = await client.callTool({
            name: 'memory_search',
            arguments: {
                query: 'typeFilterPgTest typeFilterSqlRule',
                top_k: 10,
                type_filter: 'decision',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('typeFilterPgTest');
        expect(text).not.toContain('typeFilterSqlRule');
    });

    it('搜索结果有 type 时应显示 Type 字段', async () => {
        await client.callTool({
            name: 'memory_save',
            arguments: {
                content: 'type 显示测试 typeDisplaySearchTest',
                type: 'preference',
                tags: ['type-display-test'],
                source: 'opencode',
            },
        });

        const result = await client.callTool({
            name: 'memory_search',
            arguments: {
                query: 'typeDisplaySearchTest',
                top_k: 5,
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('**Type:** preference');
    });
});

describe('memory_get 工具', () => {
    it('应该通过 ID 获取完整笔记内容', async () => {
        const saveResult = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: 'memory_get 测试：完整内容应该在这里可见',
                type: 'fact',
                tags: ['get-test'],
                source: 'opencode',
            },
        });

        const id = getResponseText(saveResult).match(/ID: ([\w-]+)/)?.[1];
        expect(id).toBeTruthy();

        const getResult = await client.callTool({
            name: 'memory_get',
            arguments: { ids: [id!] },
        });

        const text = getResponseText(getResult);
        expect(text).toContain('memory_get 测试：完整内容应该在这里可见');
        expect(text).toContain(id!);
        expect(text).toContain('get-test');
    });

    it('应该能同时获取多条笔记', async () => {
        const save1 = await client.callTool({
            name: 'memory_save',
            arguments: { content: '多条获取测试 A alpha', type: 'fact', tags: ['multi-get'], source: 'opencode' },
        });
        const save2 = await client.callTool({
            name: 'memory_save',
            arguments: { content: '多条获取测试 B beta', type: 'fact', tags: ['multi-get'], source: 'opencode' },
        });

        const id1 = getResponseText(save1).match(/ID: ([\w-]+)/)?.[1];
        const id2 = getResponseText(save2).match(/ID: ([\w-]+)/)?.[1];
        expect(id1).toBeTruthy();
        expect(id2).toBeTruthy();

        const getResult = await client.callTool({
            name: 'memory_get',
            arguments: { ids: [id1!, id2!] },
        });

        const text = getResponseText(getResult);
        expect(text).toContain('alpha');
        expect(text).toContain('beta');
    });

    it('不存在的 ID 应返回未找到提示', async () => {
        const result = await client.callTool({
            name: 'memory_get',
            arguments: { ids: ['nonexistent-id-get-test'] },
        });

        const text = getResponseText(result);
        expect(text).toContain('No memories found');
        expect(text).toContain('nonexistent-id-get-test');
    });

    it('混合存在与不存在的 ID 应部分返回', async () => {
        const saveResult = await client.callTool({
            name: 'memory_save',
            arguments: { content: '部分获取测试内容 gamma', type: 'fact', tags: ['partial-get'], source: 'opencode' },
        });

        const id = getResponseText(saveResult).match(/ID: ([\w-]+)/)?.[1];
        expect(id).toBeTruthy();

        const getResult = await client.callTool({
            name: 'memory_get',
            arguments: { ids: [id!, 'nonexistent-xyz'] },
        });

        const text = getResponseText(getResult);
        expect(text).toContain('gamma');
        expect(text).toContain('nonexistent-xyz');
    });

    it('有 type 的笔记应显示 Type 字段', async () => {
        const saveResult = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: 'get type 显示测试 getTypeDisplay',
                type: 'fact',
                tags: ['get-type-test'],
                source: 'opencode',
            },
        });

        const id = getResponseText(saveResult).match(/ID: ([\w-]+)/)?.[1];
        expect(id).toBeTruthy();

        const getResult = await client.callTool({
            name: 'memory_get',
            arguments: { ids: [id!] },
        });

        const text = getResponseText(getResult);
        expect(text).toContain('getTypeDisplay');
        expect(text).toContain('**Type:** fact');
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
        expect(text).toContain('"old_ids"');
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

    it('review 输出应包含有 type 的笔记的类型信息', async () => {
        // 先保存一条有 type 的笔记
        await client.callTool({
            name: 'memory_save',
            arguments: {
                content: 'compress type 显示测试 compressTypeDisplay',
                type: 'goal',
                tags: ['compress-type-test'],
                source: 'opencode',
            },
        });

        const result = await client.callTool({
            name: 'memory_compress',
            arguments: { strategy: 'review' },
        });

        const text = getResponseText(result);
        expect(text).toContain('compressTypeDisplay');
        expect(text).toContain('[Type: goal]');
    });
});

describe('memory_delete 工具', () => {
    it('应该成功删除指定笔记', async () => {
        const saveResult = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: '待删除的工具测试笔记',
                type: 'fact',
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
            arguments: { content: '压缩测试笔记 A', type: 'fact', tags: ['compress-test'], source: 'opencode' },
        });
        const save2 = await client.callTool({
            name: 'memory_save',
            arguments: { content: '压缩测试笔记 B', type: 'fact', tags: ['compress-test'], source: 'opencode' },
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

    it('蒸馏笔记应支持 type 字段', async () => {
        const save1 = await client.callTool({
            name: 'memory_save',
            arguments: {
                content: 'compress_apply type 测试原始笔记',
                type: 'fact',
                tags: ['ca-type'],
                source: 'opencode',
            },
        });
        const id1 = getResponseText(save1).match(/ID: ([\w-]+)/)?.[1];
        expect(id1).toBeTruthy();

        const result = await client.callTool({
            name: 'memory_compress_apply',
            arguments: {
                notes: [
                    { content: '蒸馏后的决策笔记', tags: ['compressed'], type: 'decision' },
                    { content: '蒸馏后的规则笔记', tags: ['compressed'], type: 'rule' },
                ],
                old_ids: [id1!],
                source: 'opencode',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('Compression applied successfully');
        expect(text).toContain('New notes saved: 2');
        expect(text).toContain('Old notes deleted: 1 of 1');
    });
});

describe('memory_setup 工具', () => {
    let cwdSpy: ReturnType<typeof vi.spyOn>;
    let homeSpy: ReturnType<typeof vi.spyOn>;
    let fakeHome: string;

    beforeAll(async () => {
        // mock process.cwd() 指向临时目录，避免在项目根目录产生 CLAUDE.md 副作用
        cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
        fakeHome = path.join(tmpDir, 'fake-home');
        await fs.mkdir(fakeHome, { recursive: true });
        homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    });

    afterAll(() => {
        cwdSpy.mockRestore();
        homeSpy.mockRestore();
    });

    it('默认应初始化为 global 存储', async () => {
        const result = await client.callTool({
            name: 'memory_setup',
            arguments: {
                agent_type: 'claude-code',
            },
        });

        const text = getResponseText(result);
        expect(text).toContain('Prompt: installed');
        expect(text).toContain('Storage scope: global');

        const written = await fs.readFile(path.join(fakeHome, '.claude', 'CLAUDE.md'), 'utf-8');
        expect(written).toContain('mnemo');
    });

    it('指定 project scope 应该写入项目配置和项目 marker', async () => {
        const result = await client.callTool({
            name: 'memory_setup',
            arguments: {
                agent_type: 'claude-code',
                scope: 'project',
            },
        });

        const text = getResponseText(result);
        expect(text).toMatch(/initialized successfully|updated successfully/);
        expect(text).toContain('Prompt:');
        expect(text).toContain('Storage scope: project');

        // 验证文件写到了临时目录而非项目根目录
        const written = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
        expect(written).toContain('mnemo');

        const marker = await fs.readFile(path.join(tmpDir, '.mnemo', 'config.json'), 'utf-8');
        expect(marker).toContain('"scope": "project"');
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

    it('project_root 应优先于 cwd', async () => {
        const explicitRoot = path.join(tmpDir, 'explicit-root');
        await fs.mkdir(explicitRoot, { recursive: true });

        const result = await client.callTool({
            name: 'memory_setup',
            arguments: {
                agent_type: 'claude-code',
                scope: 'project',
                project_root: explicitRoot,
            },
        });

        const text = getResponseText(result);
        expect(text).toContain(`Prompt: installed → ${path.join(explicitRoot, 'CLAUDE.md')}`);
        expect(text).toContain(`Storage path: ${path.join(explicitRoot, '.mnemo')}`);
    });
});

describe('memory_setup MCP 协议级 agent 检测', () => {
    let cwdSpy: ReturnType<typeof vi.spyOn>;
    let homeSpy: ReturnType<typeof vi.spyOn>;
    let fakeHome: string;
    let fakeCwd: string;

    beforeAll(async () => {
        fakeHome = path.join(tmpDir, 'fake-home-mcp');
        fakeCwd = path.join(tmpDir, 'fake-cwd-mcp');
        await fs.mkdir(fakeHome, { recursive: true });
        await fs.mkdir(fakeCwd, { recursive: true });
        cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(fakeCwd);
        homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    });

    afterAll(() => {
        cwdSpy.mockRestore();
        homeSpy.mockRestore();
    });

    it('MCP clientInfo.name 为 opencode 时应自动检测为 opencode', async () => {
        // 创建独立的 server/client 对，client 标识为 opencode
        const testServer = new McpServer({ name: 'mnemo-test', version: '0.1.0' });
        registerSetupTool(testServer);

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await testServer.connect(serverTransport);

        const testClient = new Client({ name: 'opencode', version: '1.0.0' });
        await testClient.connect(clientTransport);

        try {
            const result = await testClient.callTool({
                name: 'memory_setup',
                arguments: {},
            });

            const text = getResponseText(result);
            expect(text).toContain('Agent type: opencode');
            expect(text).toMatch(/initialized successfully|updated successfully/);
        } finally {
            await testClient.close();
            await testServer.close();
        }
    });

    it('MCP clientInfo.name 为 openclaw-acp-client 时应自动检测为 openclaw', async () => {
        const testServer = new McpServer({ name: 'mnemo-test', version: '0.1.0' });
        registerSetupTool(testServer);

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await testServer.connect(serverTransport);

        const testClient = new Client({ name: 'openclaw-acp-client', version: '2026.3.7' });
        await testClient.connect(clientTransport);

        try {
            const result = await testClient.callTool({
                name: 'memory_setup',
                arguments: {},
            });

            const text = getResponseText(result);
            expect(text).toContain('Agent type: openclaw');
        } finally {
            await testClient.close();
            await testServer.close();
        }
    });

    it('未知 clientInfo.name 且无文件标记时应报错', async () => {
        const testServer = new McpServer({ name: 'mnemo-test', version: '0.1.0' });
        registerSetupTool(testServer);

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await testServer.connect(serverTransport);

        const testClient = new Client({ name: 'unknown-agent', version: '1.0.0' });
        await testClient.connect(clientTransport);

        try {
            const result = await testClient.callTool({
                name: 'memory_setup',
                arguments: {},
            });

            const text = getResponseText(result);
            expect(text).toContain('Could not auto-detect agent type');
            expect((result as any).isError).toBe(true);
        } finally {
            await testClient.close();
            await testServer.close();
        }
    });

    it('显式 agent_type 参数应优先于 MCP 检测', async () => {
        // client 标识为 opencode，但显式指定 claude-code
        const testServer = new McpServer({ name: 'mnemo-test', version: '0.1.0' });
        registerSetupTool(testServer);

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await testServer.connect(serverTransport);

        const testClient = new Client({ name: 'opencode', version: '1.0.0' });
        await testClient.connect(clientTransport);

        try {
            const result = await testClient.callTool({
                name: 'memory_setup',
                arguments: {
                    agent_type: 'claude-code',
                },
            });

            const text = getResponseText(result);
            expect(text).toContain('Agent type: claude-code');
        } finally {
            await testClient.close();
            await testServer.close();
        }
    });
});

describe('extractSummary', () => {
    it('短文本应原样返回', () => {
        expect(extractSummary('短内容')).toBe('短内容');
    });

    it('多行文本应只返回第一行', () => {
        expect(extractSummary('第一行\n第二行\n第三行')).toBe('第一行');
    });

    it('超长第一行应截断并加省略号', () => {
        const longLine = 'a'.repeat(300);
        const result = extractSummary(longLine, 200);
        expect(result).toHaveLength(203); // 200 + '...'
        expect(result.endsWith('...')).toBe(true);
    });

    it('空内容应返回空字符串', () => {
        expect(extractSummary('')).toBe('');
    });
});
