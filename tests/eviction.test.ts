import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { evictionScore, runEviction } from '../src/core/eviction.js';
import { saveNote, readNote, readAllNotes } from '../src/core/notes.js';
import { writeStorageConfig, type EvictionConfig } from '../src/core/config.js';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-eviction-test-'));
    process.env.MNEMO_DATA_DIR = tmpDir;
    await writeStorageConfig('global');
});

afterEach(async () => {
    delete process.env.MNEMO_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('evictionScore', () => {
    it('刚创建且访问频繁的笔记应得高分', () => {
        const now = new Date().toISOString();
        const score = evictionScore(now, 10, 10);
        // recencyScore ≈ 1.0 * 0.4 + 1.0 * 0.6 = 1.0
        expect(score).toBeGreaterThan(0.9);
    });

    it('老旧且从未访问的笔记应得低分', () => {
        const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const score = evictionScore(oldDate, 0, 10);
        // recencyScore ≈ 0 * 0.4 + 0 * 0.6 = ~0
        expect(score).toBeLessThan(0.1);
    });

    it('maxAccessCount 为 0 时 access 分应为 0', () => {
        const now = new Date().toISOString();
        const score = evictionScore(now, 0, 0);
        // recencyScore ≈ 1.0 * 0.4 + 0 = 0.4
        expect(score).toBeCloseTo(0.4, 1);
    });

    it('得分应在 0-1 之间', () => {
        const scores = [
            evictionScore(new Date().toISOString(), 10, 10),
            evictionScore(new Date().toISOString(), 0, 0),
            evictionScore(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), 0, 100),
            evictionScore(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), 5, 10),
        ];
        for (const s of scores) {
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThanOrEqual(1);
        }
    });

    it('同等新旧条件下，访问次数越多分数越高', () => {
        const created = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        const scoreLow = evictionScore(created, 1, 10);
        const scoreHigh = evictionScore(created, 8, 10);
        expect(scoreHigh).toBeGreaterThan(scoreLow);
    });

    it('同等访问条件下，越新的笔记分数越高', () => {
        const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
        const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const scoreRecent = evictionScore(recent, 5, 10);
        const scoreOld = evictionScore(old, 5, 10);
        expect(scoreRecent).toBeGreaterThan(scoreOld);
    });
});

describe('runEviction', () => {
    it('enabled=false 时应跳过并返回 0', async () => {
        const config: EvictionConfig = {
            enabled: false,
            maxNotes: 1,
            evictBatch: 1,
            archive: true,
        };

        // 即使有笔记超过 maxNotes 也不淘汰
        await saveNote('笔记 1', ['test'], 'opencode');
        await saveNote('笔记 2', ['test'], 'opencode');

        const evicted = await runEviction(config);
        expect(evicted).toBe(0);

        const remaining = await readAllNotes();
        expect(remaining).toHaveLength(2);
    });

    it('笔记数未超过 maxNotes 时应返回 0', async () => {
        const config: EvictionConfig = {
            enabled: true,
            maxNotes: 10,
            evictBatch: 2,
            archive: true,
        };

        await saveNote('不会被淘汰', ['test'], 'opencode');

        const evicted = await runEviction(config);
        expect(evicted).toBe(0);
    });

    it('archive=true 时应将笔记移到 archive 目录', async () => {
        const config: EvictionConfig = {
            enabled: true,
            maxNotes: 2,
            evictBatch: 1,
            archive: true,
        };

        // 创建 3 条笔记（超过 maxNotes=2，应淘汰 overflow+batch = 1+1 = 2 条）
        const note1 = await saveNote('最老的笔记', ['test'], 'opencode');
        await new Promise((r) => setTimeout(r, 10));
        const note2 = await saveNote('中间的笔记', ['test'], 'opencode');
        await new Promise((r) => setTimeout(r, 10));
        const note3 = await saveNote('最新的笔记', ['test'], 'opencode');

        const evicted = await runEviction(config);
        expect(evicted).toBeGreaterThan(0);

        // archive 目录应存在淘汰的文件
        const archiveDir = path.join(tmpDir, 'archive');
        const archiveFiles = await fs.readdir(archiveDir);
        expect(archiveFiles.length).toBeGreaterThan(0);

        // 至少最新的笔记应该被保留
        const remaining = await readAllNotes();
        expect(remaining.length).toBeLessThan(3);
    });

    it('archive=false 时应直接删除笔记', async () => {
        const config: EvictionConfig = {
            enabled: true,
            maxNotes: 1,
            evictBatch: 0,
            archive: false,
        };

        await saveNote('保留', ['test'], 'opencode');
        await new Promise((r) => setTimeout(r, 10));
        await saveNote('淘汰', ['test'], 'opencode');

        const evicted = await runEviction(config);
        expect(evicted).toBeGreaterThan(0);

        // archive 目录不应存在（或为空）
        const archiveDir = path.join(tmpDir, 'archive');
        try {
            const files = await fs.readdir(archiveDir);
            expect(files).toHaveLength(0);
        } catch {
            // 目录不存在，符合预期
        }
    });

    it('淘汰的应该是得分最低的笔记', async () => {
        const config: EvictionConfig = {
            enabled: true,
            maxNotes: 2,
            evictBatch: 0,
            archive: true,
        };

        // 创建 3 条笔记，最老的应该最先被淘汰
        // 注意：没有访问记录时，分数完全由 recencyScore 决定
        const oldest = await saveNote('最老的', ['test'], 'opencode');
        await new Promise((r) => setTimeout(r, 20));
        await saveNote('中间的', ['test'], 'opencode');
        await new Promise((r) => setTimeout(r, 20));
        await saveNote('最新的', ['test'], 'opencode');

        await runEviction(config);

        // 最老的笔记应该被淘汰
        const read = await readNote(oldest.meta.id);
        expect(read).toBeNull();

        // 验证它在 archive 中
        const archivePath = path.join(tmpDir, 'archive', `${oldest.meta.id}.md`);
        const archived = await fs.readFile(archivePath, 'utf-8');
        expect(archived).toContain('最老的');
    });
});
