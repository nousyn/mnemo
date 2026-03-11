import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
    getDataDir,
    getNotesDir,
    getIndexDir,
    getGlobalConfigPath,
    getProjectConfigPath,
    writeStorageConfig,
    resolveStorageContext,
    MEMORY_TYPES,
} from '../src/core/config.js';

let originalEnv: NodeJS.ProcessEnv;
let tmpDir: string;

beforeEach(async () => {
    originalEnv = { ...process.env };
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-config-test-'));
    process.env.MNEMO_DATA_DIR = path.join(tmpDir, 'global-data');
});

afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
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

describe('storage config', () => {
    it('global 初始化应写入全局 config.json', async () => {
        const configPath = await writeStorageConfig('global');
        expect(configPath).toBe(getGlobalConfigPath());

        const content = await fs.readFile(configPath, 'utf-8');
        expect(content).toContain('"scope": "global"');
    });

    it('project 初始化应写入项目 .mnemo/config.json', async () => {
        const projectRoot = path.join(tmpDir, 'project-a');
        await fs.mkdir(projectRoot, { recursive: true });

        const configPath = await writeStorageConfig('project', projectRoot);
        expect(configPath).toBe(getProjectConfigPath(projectRoot));

        const content = await fs.readFile(configPath, 'utf-8');
        expect(content).toContain('"scope": "project"');
    });
});

describe('resolveStorageContext', () => {
    it('应优先解析项目级存储', async () => {
        const projectRoot = path.join(tmpDir, 'repo');
        const nestedDir = path.join(projectRoot, 'packages', 'app');
        await fs.mkdir(nestedDir, { recursive: true });
        await writeStorageConfig('global');
        await writeStorageConfig('project', projectRoot);

        const context = await resolveStorageContext(nestedDir);
        expect(context.scope).toBe('project');
        expect(context.dataDir).toBe(path.join(projectRoot, '.mnemo'));
    });

    it('无项目 marker 时应回退到全局存储', async () => {
        const workDir = path.join(tmpDir, 'plain-dir');
        await fs.mkdir(workDir, { recursive: true });
        await writeStorageConfig('global');

        const context = await resolveStorageContext(workDir);
        expect(context.scope).toBe('global');
        expect(context.dataDir).toBe(getDataDir());
    });

    it('未初始化时应抛错', async () => {
        const workDir = path.join(tmpDir, 'empty-dir');
        await fs.mkdir(workDir, { recursive: true });

        await expect(resolveStorageContext(workDir)).rejects.toThrow('Run memory_setup first');
    });
});

describe('MEMORY_TYPES', () => {
    it('应该导出 8 种记忆类型', () => {
        expect(MEMORY_TYPES).toHaveLength(8);
    });

    it('应该包含所有预期的类型', () => {
        const expected = ['preference', 'profile', 'goal', 'continuity', 'fact', 'decision', 'rule', 'experience'];
        expect([...MEMORY_TYPES]).toEqual(expected);
    });

    it('应该是 readonly 数组（编译时类型约束）', () => {
        // as const 在 TypeScript 编译时约束为 readonly，运行时仍是普通数组
        // 验证它确实是一个数组且内容固定
        expect(Array.isArray(MEMORY_TYPES)).toBe(true);
        expect(MEMORY_TYPES).toHaveLength(8);
    });
});
