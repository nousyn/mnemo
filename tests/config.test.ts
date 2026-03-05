import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDataDir, getNotesDir, getIndexDir } from '../src/core/config.js';

let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
    originalEnv = { ...process.env };
});

afterEach(() => {
    process.env = originalEnv;
});

describe('getDataDir', () => {
    it('MNEMO_DATA_DIR 环境变量应覆盖默认路径', () => {
        process.env.MNEMO_DATA_DIR = '/custom/path';
        expect(getDataDir()).toBe('/custom/path');
    });

    it('macOS 默认应返回 ~/Library/Application Support/mnemo', () => {
        delete process.env.MNEMO_DATA_DIR;
        // 只在 macOS 上验证
        if (process.platform === 'darwin') {
            const result = getDataDir();
            expect(result).toMatch(/Library\/Application Support\/mnemo$/);
        }
    });
});

describe('getNotesDir', () => {
    it('应该在 dataDir 下加 notes/', () => {
        process.env.MNEMO_DATA_DIR = '/test/data';
        expect(getNotesDir()).toBe('/test/data/notes');
    });
});

describe('getIndexDir', () => {
    it('应该在 dataDir 下加 index/', () => {
        process.env.MNEMO_DATA_DIR = '/test/data';
        expect(getIndexDir()).toBe('/test/data/index');
    });
});
