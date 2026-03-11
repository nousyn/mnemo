import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
    embed,
    indexNote,
    searchNotes,
    removeFromIndex,
    removeMultipleFromIndex,
    isEmbeddingReady,
    preloadEmbedding,
} from '../src/core/embedding.js';
import { writeStorageConfig } from '../src/core/config.js';
import { saveNote, deleteNote } from '../src/core/notes.js';

let tmpDir: string;

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-emb-test-'));
    process.env.MNEMO_DATA_DIR = tmpDir;
    await writeStorageConfig('global');

    // 预加载模型，等待就绪
    preloadEmbedding();
    // 通过执行一次 embed 来确保模型加载完毕
    await embed('warmup');
}, 60_000);

afterAll(async () => {
    delete process.env.MNEMO_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('embed', () => {
    it('应该返回 384 维向量', async () => {
        const vector = await embed('测试文本');
        expect(vector).toHaveLength(384);
        expect(typeof vector[0]).toBe('number');
    });

    it('相似文本的向量应该更接近', async () => {
        const v1 = await embed('TypeScript 严格模式配置');
        const v2 = await embed('TypeScript strict mode settings');
        const v3 = await embed('今天天气怎么样');

        // 余弦相似度（向量已归一化，点积即为余弦相似度）
        const sim12 = v1.reduce((sum, val, i) => sum + val * v2[i], 0);
        const sim13 = v1.reduce((sum, val, i) => sum + val * v3[i], 0);

        expect(sim12).toBeGreaterThan(sim13);
    });
});

describe('isEmbeddingReady', () => {
    it('模型加载后应返回 true', () => {
        expect(isEmbeddingReady()).toBe(true);
    });
});

describe('indexNote / searchNotes / removeFromIndex', () => {
    it('应该能索引笔记并通过语义搜索找到', async () => {
        const note = await saveNote('用户偏好使用 Prettier 格式化代码', ['preference'], 'opencode');
        await indexNote(note);

        const results = await searchNotes('代码格式化工具', 5);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].id).toBe(note.meta.id);

        // 清理
        await removeFromIndex(note.meta.id);
    });

    it('搜索结果应包含正确的元数据', async () => {
        const note = await saveNote('架构决策：使用 vectra 做向量检索', ['architecture'], 'opencode');
        await indexNote(note);

        const results = await searchNotes('向量搜索方案', 5);
        const found = results.find((r) => r.id === note.meta.id);
        expect(found).toBeDefined();
        expect(found!.source).toBe('opencode');
        expect(found!.tags).toContain('architecture');

        await removeFromIndex(note.meta.id);
    });

    it('搜索结果应包含 type 字段', async () => {
        const note = await saveNote('type 索引测试', ['emb-type'], 'opencode', 'decision');
        await indexNote(note);

        const results = await searchNotes('type 索引测试', 5);
        const found = results.find((r) => r.id === note.meta.id);
        expect(found).toBeDefined();
        expect(found!.type).toBe('decision');

        await removeFromIndex(note.meta.id);
    });

    it('无 type 的笔记搜索结果 type 应为空字符串', async () => {
        const note = await saveNote('无 type 索引测试 embNoType', ['emb-type'], 'opencode');
        await indexNote(note);

        const results = await searchNotes('embNoType', 5);
        const found = results.find((r) => r.id === note.meta.id);
        expect(found).toBeDefined();
        expect(found!.type).toBe('');

        await removeFromIndex(note.meta.id);
    });

    it('source_filter 应该过滤结果', async () => {
        const n1 = await saveNote('来自 opencode 的笔记', ['test'], 'opencode');
        const n2 = await saveNote('来自 claude 的笔记', ['test'], 'claude-code');
        await indexNote(n1);
        await indexNote(n2);

        const filtered = await searchNotes('笔记', 5, 'opencode');
        const ids = filtered.map((r) => r.id);
        expect(ids).toContain(n1.meta.id);
        expect(ids).not.toContain(n2.meta.id);

        await removeMultipleFromIndex([n1.meta.id, n2.meta.id]);
    });

    it('removeFromIndex + 删除文件后搜索不应返回该笔记', async () => {
        const note = await saveNote('即将删除的笔记 uniqueDelTest', ['temp'], 'opencode');
        await indexNote(note);

        await removeFromIndex(note.meta.id);
        await deleteNote(note.meta.id);

        const results = await searchNotes('uniqueDelTest', 5);
        const ids = results.map((r) => r.id);
        expect(ids).not.toContain(note.meta.id);
    });

    it('removeMultipleFromIndex + 删除文件后应批量清除', async () => {
        const n1 = await saveNote('批量删除测试1 batchDelAlpha', ['temp'], 'opencode');
        const n2 = await saveNote('批量删除测试2 batchDelBeta', ['temp'], 'opencode');
        await indexNote(n1);
        await indexNote(n2);

        await removeMultipleFromIndex([n1.meta.id, n2.meta.id]);
        await deleteNote(n1.meta.id);
        await deleteNote(n2.meta.id);

        const results = await searchNotes('batchDelAlpha batchDelBeta', 5);
        const ids = results.map((r) => r.id);
        expect(ids).not.toContain(n1.meta.id);
        expect(ids).not.toContain(n2.meta.id);
    });
});

describe('hybrid search (vector + keyword)', () => {
    it('关键词搜索应能找到精确匹配的笔记', async () => {
        const note = await saveNote('项目使用 unicornXYZ 作为唯一标识符方案', ['test'], 'opencode');
        // 不索引到 vectra，仅靠关键词搜索
        const results = await searchNotes('unicornXYZ', 5);
        expect(results.length).toBeGreaterThan(0);
        expect(results.some((r) => r.id === note.meta.id)).toBe(true);
    });

    it('混合搜索应合并两种来源的结果', async () => {
        const note = await saveNote('混合搜索测试笔记 hybridTestAlpha 格式化工具', ['hybrid'], 'opencode');
        await indexNote(note);

        // 这个查询既能通过语义（格式化工具）也能通过关键词（hybridTestAlpha）找到
        const results = await searchNotes('hybridTestAlpha', 5);
        expect(results.length).toBeGreaterThan(0);
        expect(results.some((r) => r.id === note.meta.id)).toBe(true);

        await removeFromIndex(note.meta.id);
    });
});
