import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
    parseNote,
    serializeNote,
    saveNote,
    readNote,
    readAllNotes,
    deleteNote,
    deleteNotes,
    getNoteStats,
    updateNoteMeta,
    archiveNote,
} from '../src/core/notes.js';
import { writeStorageConfig, type Note, MEMORY_TYPES } from '../src/core/config.js';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-test-'));
    process.env.MNEMO_DATA_DIR = tmpDir;
    await writeStorageConfig('global');
});

afterEach(async () => {
    delete process.env.MNEMO_DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('parseNote', () => {
    it('应该正确解析带 frontmatter 的笔记', () => {
        const raw = `---
id: abc12345
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
tags: [architecture, decision]
source: opencode
---

这是笔记内容。`;

        const note = parseNote(raw);
        expect(note).not.toBeNull();
        expect(note!.meta.id).toBe('abc12345');
        expect(note!.meta.tags).toEqual(['architecture', 'decision']);
        expect(note!.meta.source).toBe('opencode');
        expect(note!.content).toBe('这是笔记内容。');
    });

    it('应该正确解析空标签', () => {
        const raw = `---
id: abc12345
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
tags: []
source: opencode
---

内容`;

        const note = parseNote(raw);
        expect(note).not.toBeNull();
        expect(note!.meta.tags).toEqual([]);
    });

    it('无 frontmatter 时应返回 null', () => {
        const result = parseNote('没有 frontmatter 的内容');
        expect(result).toBeNull();
    });

    it('无 id 时应返回 null', () => {
        const raw = `---
created: 2026-01-01T00:00:00.000Z
tags: []
source: opencode
---

内容`;

        const result = parseNote(raw);
        expect(result).toBeNull();
    });

    it('应该正确处理包含冒号的 content', () => {
        const raw = `---
id: test1234
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
tags: [test]
source: opencode
---

键值对: value: nested: deep`;

        const note = parseNote(raw);
        expect(note).not.toBeNull();
        expect(note!.content).toBe('键值对: value: nested: deep');
    });

    it('应该正确解析带 type 的笔记', () => {
        const raw = `---
id: typed1234
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
tags: [test]
source: opencode
type: decision
---

带类型的笔记`;

        const note = parseNote(raw);
        expect(note).not.toBeNull();
        expect(note!.meta.type).toBe('decision');
    });

    it('无 type 时 meta.type 应为 undefined（向后兼容）', () => {
        const raw = `---
id: notype123
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
tags: []
source: opencode
---

无类型笔记`;

        const note = parseNote(raw);
        expect(note).not.toBeNull();
        expect(note!.meta.type).toBeUndefined();
    });

    it('无效 type 值应被忽略', () => {
        const raw = `---
id: badtype123
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
tags: []
source: opencode
type: invalid_type
---

无效类型笔记`;

        const note = parseNote(raw);
        expect(note).not.toBeNull();
        expect(note!.meta.type).toBeUndefined();
    });
});

describe('serializeNote', () => {
    it('应该正确序列化笔记', () => {
        const note: Note = {
            meta: {
                id: 'test1234',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                tags: ['tag1', 'tag2'],
                source: 'opencode',
            },
            content: '测试内容',
        };

        const result = serializeNote(note);
        expect(result).toContain('id: test1234');
        expect(result).toContain('tags: [tag1, tag2]');
        expect(result).toContain('source: opencode');
        expect(result).toContain('测试内容');
    });

    it('parse 和 serialize 应该互逆', () => {
        const note: Note = {
            meta: {
                id: 'round123',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-02T00:00:00.000Z',
                tags: ['a', 'b'],
                source: 'claude-code',
            },
            content: '往返测试内容',
        };

        const serialized = serializeNote(note);
        const parsed = parseNote(serialized);
        expect(parsed).not.toBeNull();
        expect(parsed!.meta.id).toBe(note.meta.id);
        expect(parsed!.meta.tags).toEqual(note.meta.tags);
        expect(parsed!.meta.source).toBe(note.meta.source);
        expect(parsed!.content).toBe(note.content);
    });

    it('带 type 时应正确序列化', () => {
        const note: Note = {
            meta: {
                id: 'typed1234',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                tags: ['arch'],
                source: 'opencode',
                type: 'decision',
            },
            content: '决策内容',
        };

        const result = serializeNote(note);
        expect(result).toContain('type: decision');
        expect(result).toContain('决策内容');
    });

    it('无 type 时序列化不应包含 type 行', () => {
        const note: Note = {
            meta: {
                id: 'notype123',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                tags: [],
                source: 'opencode',
            },
            content: '无类型内容',
        };

        const result = serializeNote(note);
        expect(result).not.toContain('type:');
    });

    it('带 type 时 parse 和 serialize 应该互逆', () => {
        const note: Note = {
            meta: {
                id: 'roundtype',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-02T00:00:00.000Z',
                tags: ['test'],
                source: 'opencode',
                type: 'rule',
            },
            content: '规则往返测试',
        };

        const serialized = serializeNote(note);
        const parsed = parseNote(serialized);
        expect(parsed).not.toBeNull();
        expect(parsed!.meta.type).toBe('rule');
        expect(parsed!.meta.id).toBe(note.meta.id);
        expect(parsed!.content).toBe(note.content);
    });
});

describe('saveNote / readNote', () => {
    it('应该保存并读取笔记', async () => {
        const note = await saveNote('保存测试', ['test'], 'opencode');

        expect(note.meta.id).toBeTruthy();
        // ID 格式: YYYYMMDD-HHmmss-xxxx
        expect(note.meta.id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{4}$/);
        expect(note.meta.tags).toEqual(['test']);
        expect(note.meta.source).toBe('opencode');
        expect(note.content).toBe('保存测试');

        // 从磁盘读回
        const read = await readNote(note.meta.id);
        expect(read).not.toBeNull();
        expect(read!.content).toBe('保存测试');
        expect(read!.meta.id).toBe(note.meta.id);
    });

    it('读取不存在的笔记应返回 null', async () => {
        const result = await readNote('nonexistent');
        expect(result).toBeNull();
    });

    it('默认 source 应为 unknown', async () => {
        const note = await saveNote('测试默认值');
        expect(note.meta.source).toBe('unknown');
        expect(note.meta.tags).toEqual([]);
    });

    it('应该保存带 type 的笔记', async () => {
        const note = await saveNote('决策测试', ['arch'], 'opencode', 'decision');

        expect(note.meta.type).toBe('decision');
        expect(note.content).toBe('决策测试');

        // 从磁盘读回验证 type 持久化
        const read = await readNote(note.meta.id);
        expect(read).not.toBeNull();
        expect(read!.meta.type).toBe('decision');
    });

    it('不传 type 时 meta.type 应为 undefined', async () => {
        const note = await saveNote('无类型保存');
        expect(note.meta.type).toBeUndefined();

        const read = await readNote(note.meta.id);
        expect(read).not.toBeNull();
        expect(read!.meta.type).toBeUndefined();
    });
});

describe('readAllNotes', () => {
    it('空目录应返回空数组', async () => {
        const notes = await readAllNotes();
        expect(notes).toEqual([]);
    });

    it('应该读取所有笔记并按创建时间倒序', async () => {
        await saveNote('笔记一', ['first']);
        // 确保时间戳不同
        await new Promise((r) => setTimeout(r, 10));
        await saveNote('笔记二', ['second']);

        const notes = await readAllNotes();
        expect(notes).toHaveLength(2);
        // 最新的在前
        expect(notes[0].content).toBe('笔记二');
        expect(notes[1].content).toBe('笔记一');
    });
});

describe('deleteNote / deleteNotes', () => {
    it('应该删除单条笔记', async () => {
        const note = await saveNote('待删除');
        const deleted = await deleteNote(note.meta.id);
        expect(deleted).toBe(true);

        const read = await readNote(note.meta.id);
        expect(read).toBeNull();
    });

    it('删除不存在的笔记应返回 false', async () => {
        const result = await deleteNote('nonexistent');
        expect(result).toBe(false);
    });

    it('应该批量删除多条笔记', async () => {
        const n1 = await saveNote('删除1');
        const n2 = await saveNote('删除2');
        const n3 = await saveNote('保留');

        const count = await deleteNotes([n1.meta.id, n2.meta.id]);
        expect(count).toBe(2);

        const remaining = await readAllNotes();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].content).toBe('保留');
    });
});

describe('getNoteStats', () => {
    it('空时 count 和 totalSize 都应为 0', async () => {
        const stats = await getNoteStats();
        expect(stats.count).toBe(0);
        expect(stats.totalSize).toBe(0);
    });

    it('应该正确统计数量和大小', async () => {
        await saveNote('短');
        await saveNote('稍微长一点的内容');

        const stats = await getNoteStats();
        expect(stats.count).toBe(2);
        expect(stats.totalSize).toBeGreaterThan(0);
    });
});

describe('parseNote — accessCount / lastAccessed', () => {
    it('应该正确解析带 accessCount 的笔记', () => {
        const raw = `---
id: access1234
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
tags: [test]
source: opencode
accessCount: 5
lastAccessed: 2026-01-10T12:00:00.000Z
---

带访问计数的笔记`;

        const note = parseNote(raw);
        expect(note).not.toBeNull();
        expect(note!.meta.accessCount).toBe(5);
        expect(note!.meta.lastAccessed).toBe('2026-01-10T12:00:00.000Z');
    });

    it('无 accessCount 时应为 undefined（向后兼容）', () => {
        const raw = `---
id: noaccess123
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
tags: []
source: opencode
---

无访问计数笔记`;

        const note = parseNote(raw);
        expect(note).not.toBeNull();
        expect(note!.meta.accessCount).toBeUndefined();
        expect(note!.meta.lastAccessed).toBeUndefined();
    });
});

describe('serializeNote — accessCount / lastAccessed', () => {
    it('带 accessCount > 0 时应正确序列化', () => {
        const note: Note = {
            meta: {
                id: 'access1234',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                tags: ['test'],
                source: 'opencode',
                accessCount: 3,
                lastAccessed: '2026-01-10T12:00:00.000Z',
            },
            content: '访问计数序列化测试',
        };

        const result = serializeNote(note);
        expect(result).toContain('accessCount: 3');
        expect(result).toContain('lastAccessed: 2026-01-10T12:00:00.000Z');
    });

    it('accessCount 为 0 或 undefined 时不应序列化', () => {
        const note: Note = {
            meta: {
                id: 'noaccess123',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-01T00:00:00.000Z',
                tags: [],
                source: 'opencode',
            },
            content: '无访问计数',
        };

        const result = serializeNote(note);
        expect(result).not.toContain('accessCount');
        expect(result).not.toContain('lastAccessed');
    });

    it('accessCount 的 parse/serialize 应互逆', () => {
        const note: Note = {
            meta: {
                id: 'roundaccess',
                created: '2026-01-01T00:00:00.000Z',
                updated: '2026-01-02T00:00:00.000Z',
                tags: ['test'],
                source: 'opencode',
                type: 'fact',
                accessCount: 7,
                lastAccessed: '2026-01-15T08:00:00.000Z',
            },
            content: '访问计数往返测试',
        };

        const serialized = serializeNote(note);
        const parsed = parseNote(serialized);
        expect(parsed).not.toBeNull();
        expect(parsed!.meta.accessCount).toBe(7);
        expect(parsed!.meta.lastAccessed).toBe('2026-01-15T08:00:00.000Z');
    });
});

describe('updateNoteMeta', () => {
    it('应该更新 accessCount 和 lastAccessed', async () => {
        const note = await saveNote('更新元数据测试', ['test'], 'opencode');

        const success = await updateNoteMeta(note.meta.id, {
            accessCount: 3,
            lastAccessed: '2026-02-01T00:00:00.000Z',
        });
        expect(success).toBe(true);

        const read = await readNote(note.meta.id);
        expect(read).not.toBeNull();
        expect(read!.meta.accessCount).toBe(3);
        expect(read!.meta.lastAccessed).toBe('2026-02-01T00:00:00.000Z');
    });

    it('应该只更新指定的字段', async () => {
        const note = await saveNote('部分更新测试', ['test'], 'opencode', 'fact');

        await updateNoteMeta(note.meta.id, { accessCount: 1 });

        const read = await readNote(note.meta.id);
        expect(read).not.toBeNull();
        expect(read!.meta.accessCount).toBe(1);
        expect(read!.meta.lastAccessed).toBeUndefined();
        // 原有字段应保持不变
        expect(read!.meta.type).toBe('fact');
        expect(read!.meta.source).toBe('opencode');
        expect(read!.content).toBe('部分更新测试');
    });

    it('不存在的笔记应返回 false', async () => {
        const result = await updateNoteMeta('nonexistent-id', { accessCount: 1 });
        expect(result).toBe(false);
    });
});

describe('archiveNote', () => {
    it('应该将笔记移到 archive 目录', async () => {
        const note = await saveNote('归档测试', ['test'], 'opencode');

        const success = await archiveNote(note.meta.id);
        expect(success).toBe(true);

        // 原位置不再存在
        const read = await readNote(note.meta.id);
        expect(read).toBeNull();

        // archive 目录应有文件
        const archivePath = path.join(tmpDir, 'archive', `${note.meta.id}.md`);
        const content = await fs.readFile(archivePath, 'utf-8');
        expect(content).toContain('归档测试');
    });

    it('不存在的笔记应返回 false', async () => {
        const result = await archiveNote('nonexistent-id');
        expect(result).toBe(false);
    });
});
