import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { recordAccess, recordAccessBatch, flushAccessQueue } from '../src/core/access-tracker.js';
import { saveNote, readNote } from '../src/core/notes.js';
import { writeStorageConfig } from '../src/core/config.js';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-access-test-'));
    process.env.MNEMO_DATA_DIR = tmpDir;
    await writeStorageConfig('global');
});

afterEach(async () => {
    delete process.env.MNEMO_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('recordAccess', () => {
    it('应该创建 queue 文件并写入一条记录', async () => {
        await recordAccess('test-note-id');

        const queuePath = path.join(tmpDir, 'access_queue.tsv');
        const content = await fs.readFile(queuePath, 'utf-8');
        expect(content).toContain('test-note-id');
        expect(content).toContain('\t');

        // 每行应是 noteId\ttimestamp\n 格式
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(1);
        const [id, timestamp] = lines[0].split('\t');
        expect(id).toBe('test-note-id');
        expect(new Date(timestamp).getTime()).not.toBeNaN();
    });

    it('多次调用应追加到同一文件', async () => {
        await recordAccess('note-a');
        await recordAccess('note-b');
        await recordAccess('note-a');

        const queuePath = path.join(tmpDir, 'access_queue.tsv');
        const content = await fs.readFile(queuePath, 'utf-8');
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(3);
    });
});

describe('recordAccessBatch', () => {
    it('应该一次写入多条记录', async () => {
        await recordAccessBatch(['note-1', 'note-2', 'note-3']);

        const queuePath = path.join(tmpDir, 'access_queue.tsv');
        const content = await fs.readFile(queuePath, 'utf-8');
        const lines = content.trim().split('\n');
        expect(lines).toHaveLength(3);
        expect(content).toContain('note-1');
        expect(content).toContain('note-2');
        expect(content).toContain('note-3');
    });

    it('空数组应该不写入任何内容', async () => {
        await recordAccessBatch([]);

        const queuePath = path.join(tmpDir, 'access_queue.tsv');
        try {
            await fs.access(queuePath);
            // 如果文件存在，应该为空
            const content = await fs.readFile(queuePath, 'utf-8');
            expect(content).toBe('');
        } catch {
            // 文件不存在，符合预期
        }
    });
});

describe('flushAccessQueue', () => {
    it('无 queue 文件时应返回 0', async () => {
        const result = await flushAccessQueue();
        expect(result).toBe(0);
    });

    it('应该聚合访问计数并更新笔记元数据', async () => {
        // 先创建笔记
        const note = await saveNote('flush 测试笔记', ['test'], 'opencode');

        // 记录多次访问
        await recordAccess(note.meta.id);
        await recordAccess(note.meta.id);
        await recordAccess(note.meta.id);

        // 刷新
        const updated = await flushAccessQueue();
        expect(updated).toBe(1);

        // 验证元数据已更新
        const read = await readNote(note.meta.id);
        expect(read).not.toBeNull();
        expect(read!.meta.accessCount).toBe(3);
        expect(read!.meta.lastAccessed).toBeTruthy();
    });

    it('刷新后 queue 文件和 processing 文件都应被清理', async () => {
        const note = await saveNote('清理测试', ['test'], 'opencode');
        await recordAccess(note.meta.id);

        await flushAccessQueue();

        const queuePath = path.join(tmpDir, 'access_queue.tsv');
        const processingPath = path.join(tmpDir, 'access_queue.processing.tsv');

        // 两个文件都不应存在
        await expect(fs.access(queuePath)).rejects.toThrow();
        await expect(fs.access(processingPath)).rejects.toThrow();
    });

    it('不存在的笔记 ID 应被跳过', async () => {
        await recordAccess('nonexistent-note-id');

        const updated = await flushAccessQueue();
        expect(updated).toBe(0);
    });

    it('混合存在和不存在的笔记 ID 应只更新存在的', async () => {
        const note = await saveNote('混合测试', ['test'], 'opencode');
        await recordAccessBatch([note.meta.id, 'nonexistent-1', note.meta.id]);

        const updated = await flushAccessQueue();
        expect(updated).toBe(1); // 只有一个笔记被更新

        const read = await readNote(note.meta.id);
        expect(read!.meta.accessCount).toBe(2); // 两次访问被聚合
    });

    it('多次刷新应累计访问计数', async () => {
        const note = await saveNote('累计测试', ['test'], 'opencode');

        // 第一轮访问
        await recordAccessBatch([note.meta.id, note.meta.id]);
        await flushAccessQueue();

        // 第二轮访问
        await recordAccessBatch([note.meta.id, note.meta.id, note.meta.id]);
        await flushAccessQueue();

        const read = await readNote(note.meta.id);
        expect(read!.meta.accessCount).toBe(5); // 2 + 3
    });
});
