import { describe, it, expect, beforeAll, afterAll, type TaskContext } from 'vitest';
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
    findSimilar,
    DEDUP_SIMILARITY_THRESHOLD,
    recencyScore,
    TIME_DECAY_HALF_LIFE_DAYS,
    rebuildIndex,
} from '../src/core/embedding.js';
import { writeStorageConfig } from '../src/core/config.js';
import { saveNote, deleteNote } from '../src/core/notes.js';

let tmpDir: string;
let embeddingAvailable = false;

/** 在 embedding 模型不可用时跳过测试 */
function requireEmbedding(ctx: TaskContext) {
    if (!embeddingAvailable) ctx.skip();
}

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-emb-test-'));
    process.env.MNEMO_DATA_DIR = tmpDir;
    await writeStorageConfig('global');

    // 尝试预加载模型，网络不可用时标记为不可用而非让整个套件失败
    try {
        preloadEmbedding();
        await embed('warmup');
        embeddingAvailable = true;
    } catch {
        console.warn('Embedding model unavailable, skipping embedding-dependent tests');
    }
}, 60_000);

afterAll(async () => {
    delete process.env.MNEMO_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('embed', () => {
    it('应该返回 384 维向量', async (ctx) => {
        requireEmbedding(ctx);
        const vector = await embed('测试文本');
        expect(vector).toHaveLength(384);
        expect(typeof vector[0]).toBe('number');
    });

    it('相似文本的向量应该更接近', async (ctx) => {
        requireEmbedding(ctx);
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
    it('模型加载后应返回 true', (ctx) => {
        requireEmbedding(ctx);
        expect(isEmbeddingReady()).toBe(true);
    });
});

describe('indexNote / searchNotes / removeFromIndex', () => {
    it('应该能索引笔记并通过语义搜索找到', async (ctx) => {
        requireEmbedding(ctx);
        const note = await saveNote('用户偏好使用 Prettier 格式化代码', ['preference'], 'opencode');
        await indexNote(note);

        const results = await searchNotes('代码格式化工具', 5);
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].id).toBe(note.meta.id);

        // 清理
        await removeFromIndex(note.meta.id);
    });

    it('搜索结果应包含正确的元数据', async (ctx) => {
        requireEmbedding(ctx);
        const note = await saveNote('架构决策：使用 vectra 做向量检索', ['architecture'], 'opencode');
        await indexNote(note);

        const results = await searchNotes('向量搜索方案', 5);
        const found = results.find((r) => r.id === note.meta.id);
        expect(found).toBeDefined();
        expect(found!.source).toBe('opencode');
        expect(found!.tags).toContain('architecture');

        await removeFromIndex(note.meta.id);
    });

    it('搜索结果应包含 type 字段', async (ctx) => {
        requireEmbedding(ctx);
        const note = await saveNote('type 索引测试', ['emb-type'], 'opencode', 'decision');
        await indexNote(note);

        const results = await searchNotes('type 索引测试', 5);
        const found = results.find((r) => r.id === note.meta.id);
        expect(found).toBeDefined();
        expect(found!.type).toBe('decision');

        await removeFromIndex(note.meta.id);
    });

    it('无 type 的笔记搜索结果 type 应为空字符串', async (ctx) => {
        requireEmbedding(ctx);
        const note = await saveNote('无 type 索引测试 embNoType', ['emb-type'], 'opencode');
        await indexNote(note);

        const results = await searchNotes('embNoType', 5);
        const found = results.find((r) => r.id === note.meta.id);
        expect(found).toBeDefined();
        expect(found!.type).toBe('');

        await removeFromIndex(note.meta.id);
    });

    it('source_filter 应该过滤结果', async (ctx) => {
        requireEmbedding(ctx);
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

    it('removeFromIndex + 删除文件后搜索不应返回该笔记', async (ctx) => {
        requireEmbedding(ctx);
        const note = await saveNote('即将删除的笔记 uniqueDelTest', ['temp'], 'opencode');
        await indexNote(note);

        await removeFromIndex(note.meta.id);
        await deleteNote(note.meta.id);

        const results = await searchNotes('uniqueDelTest', 5);
        const ids = results.map((r) => r.id);
        expect(ids).not.toContain(note.meta.id);
    });

    it('removeMultipleFromIndex + 删除文件后应批量清除', async (ctx) => {
        requireEmbedding(ctx);
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
    it('关键词搜索应能找到精确匹配的笔记', async (ctx) => {
        requireEmbedding(ctx);
        const note = await saveNote('项目使用 unicornXYZ 作为唯一标识符方案', ['test'], 'opencode');
        // 不索引到 vectra，仅靠关键词搜索
        const results = await searchNotes('unicornXYZ', 5);
        expect(results.length).toBeGreaterThan(0);
        expect(results.some((r) => r.id === note.meta.id)).toBe(true);
    });

    it('混合搜索应合并两种来源的结果', async (ctx) => {
        requireEmbedding(ctx);
        const note = await saveNote('混合搜索测试笔记 hybridTestAlpha 格式化工具', ['hybrid'], 'opencode');
        await indexNote(note);

        // 这个查询既能通过语义（格式化工具）也能通过关键词（hybridTestAlpha）找到
        const results = await searchNotes('hybridTestAlpha', 5);
        expect(results.length).toBeGreaterThan(0);
        expect(results.some((r) => r.id === note.meta.id)).toBe(true);

        await removeFromIndex(note.meta.id);
    });
});

describe('findSimilar', () => {
    it('应该找到语义相似的已索引笔记', async (ctx) => {
        requireEmbedding(ctx);
        const note = await saveNote('用户偏好 Prettier 格式化代码，singleQuote tabWidth 4', ['pref'], 'opencode');
        await indexNote(note);

        const similar = await findSimilar('代码格式化使用 Prettier，配置 singleQuote tabWidth 4');
        expect(similar.length).toBeGreaterThan(0);
        expect(similar[0].id).toBe(note.meta.id);
        expect(similar[0].score).toBeGreaterThanOrEqual(DEDUP_SIMILARITY_THRESHOLD);

        await removeFromIndex(note.meta.id);
    });

    it('完全不相关的内容不应触发相似匹配', async (ctx) => {
        requireEmbedding(ctx);
        const note = await saveNote('量子计算在蛋白质折叠中的应用前景 quantumProteinUnique', ['sci'], 'opencode');
        await indexNote(note);

        const similar = await findSimilar('JavaScript 异步编程的最佳实践');
        const found = similar.find((s) => s.id === note.meta.id);
        expect(found).toBeUndefined();

        await removeFromIndex(note.meta.id);
    });

    it('DEDUP_SIMILARITY_THRESHOLD 应该是 0.85', () => {
        expect(DEDUP_SIMILARITY_THRESHOLD).toBe(0.85);
    });

    it('空索引时应返回空数组', async (ctx) => {
        requireEmbedding(ctx);
        // findSimilar 在 embedding ready 但索引可能有内容时仍能工作
        // 这里测试的是：即使有笔记，自定义高阈值也不应匹配
        const similar = await findSimilar('完全随机的内容 xkcd42 zzzqqq', 0.99);
        expect(similar).toEqual([]);
    });
});

describe('recencyScore', () => {
    it('TIME_DECAY_HALF_LIFE_DAYS 应该是 7', () => {
        expect(TIME_DECAY_HALF_LIFE_DAYS).toBe(7);
    });

    it('刚创建的笔记得分应接近 1', () => {
        const now = new Date().toISOString();
        const score = recencyScore(now);
        expect(score).toBeGreaterThan(0.99);
        expect(score).toBeLessThanOrEqual(1);
    });

    it('7 天前的笔记得分应接近 0.5（半衰期）', () => {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const score = recencyScore(sevenDaysAgo);
        expect(score).toBeCloseTo(0.5, 1);
    });

    it('14 天前的笔记得分应接近 0.25（两个半衰期）', () => {
        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const score = recencyScore(fourteenDaysAgo);
        expect(score).toBeCloseTo(0.25, 1);
    });

    it('很久以前的笔记得分应接近 0', () => {
        const longAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
        const score = recencyScore(longAgo);
        expect(score).toBeLessThan(0.001);
    });

    it('自定义半衰期应生效', () => {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        const score = recencyScore(threeDaysAgo, 3);
        expect(score).toBeCloseTo(0.5, 1);
    });

    it('未来时间戳得分应为 1（ageDays clamped to 0）', () => {
        const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const score = recencyScore(future);
        expect(score).toBe(1);
    });

    it('得分应随时间单调递减', () => {
        const now = Date.now();
        const scores = [0, 1, 3, 7, 14, 30, 60].map((days) =>
            recencyScore(new Date(now - days * 24 * 60 * 60 * 1000).toISOString()),
        );
        for (let i = 1; i < scores.length; i++) {
            expect(scores[i]).toBeLessThan(scores[i - 1]);
        }
    });
});

describe('rebuildIndex', () => {
    it('应该重建索引并返回正确的计数', async (ctx) => {
        requireEmbedding(ctx);
        // 先保存几条笔记并索引
        const n1 = await saveNote('rebuildTest 笔记一 alphaRebuild', ['rebuild'], 'opencode');
        const n2 = await saveNote('rebuildTest 笔记二 betaRebuild', ['rebuild'], 'opencode');
        await indexNote(n1);
        await indexNote(n2);

        // 验证索引前搜索能找到
        let results = await searchNotes('alphaRebuild', 5);
        expect(results.some((r) => r.id === n1.meta.id)).toBe(true);

        // 重建索引
        const stats = await rebuildIndex();
        expect(stats.indexed).toBeGreaterThanOrEqual(2);
        expect(stats.errors).toBe(0);

        // 重建后仍能搜索到（关键词搜索验证笔记仍在磁盘上）
        results = await searchNotes('betaRebuild', 5);
        expect(results.some((r) => r.id === n2.meta.id)).toBe(true);
    });

    it('重建后应清理孤立的 metadata JSON 文件', async (ctx) => {
        requireEmbedding(ctx);
        const { indexDir } = await import('../src/core/config.js').then((m) => m.resolveStorageContext());

        // 创建一个假的 metadata JSON 文件
        const fakeMetaPath = path.join(indexDir, 'fake-orphan-metadata.json');
        await fs.writeFile(fakeMetaPath, JSON.stringify({ id: 'fake' }));

        // 确认文件存在
        const existsBefore = await fs
            .access(fakeMetaPath)
            .then(() => true)
            .catch(() => false);
        expect(existsBefore).toBe(true);

        // 重建索引
        await rebuildIndex();

        // 孤立文件应被清理
        const existsAfter = await fs
            .access(fakeMetaPath)
            .then(() => true)
            .catch(() => false);
        expect(existsAfter).toBe(false);
    });
});
