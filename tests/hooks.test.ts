import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
    REMINDERS,
    ACTIVATOR_SCRIPT,
    OPENCLAW_HOOK_MD,
    OPENCLAW_HANDLER_TS,
    OPENCODE_PLUGIN_TS,
    HOOK_CONFIGS,
} from '../src/hooks/reminders.js';
import { installHooks, hasHooksInstalled } from '../src/hooks/installer.js';
import type { AgentType } from '../src/core/config.js';

// ---------------------------------------------------------------------------
// reminders.ts — template content validation
// ---------------------------------------------------------------------------

describe('reminders.ts — REMINDERS object', () => {
    it('应该包含所有四种 reminder 文本', () => {
        expect(REMINDERS.perTurn).toBeDefined();
        expect(REMINDERS.sessionStart).toBeDefined();
        expect(REMINDERS.compaction).toBeDefined();
        expect(REMINDERS.sessionEnd).toBeDefined();
    });

    it('perTurn 应该使用 mnemo-reminder 标签', () => {
        expect(REMINDERS.perTurn).toContain('<mnemo-reminder>');
        expect(REMINDERS.perTurn).toContain('</mnemo-reminder>');
    });

    it('sessionStart 应该提醒搜索记忆', () => {
        expect(REMINDERS.sessionStart).toContain('memory_search');
    });

    it('compaction 应该提醒保存重要上下文', () => {
        expect(REMINDERS.compaction).toContain('memory_save');
        // compress 已移除，compaction 不再提及 memory_compress
        expect(REMINDERS.compaction).not.toContain('memory_compress');
    });

    it('sessionEnd 应该包含自检提示', () => {
        expect(REMINDERS.sessionEnd).toContain('memory_save');
    });

    it('每条 reminder 应该控制在合理长度内（< 500 字符）', () => {
        for (const text of Object.values(REMINDERS)) {
            expect(text.length).toBeLessThan(500);
        }
    });
});

describe('reminders.ts — ACTIVATOR_SCRIPT', () => {
    it('应该是合法的 bash 脚本', () => {
        expect(ACTIVATOR_SCRIPT).toMatch(/^#!\/bin\/bash/);
    });

    it('应该包含 perTurn 的 reminder 内容', () => {
        expect(ACTIVATOR_SCRIPT).toContain('<mnemo-reminder>');
    });

    it('应该包含 set -e', () => {
        expect(ACTIVATOR_SCRIPT).toContain('set -e');
    });
});

describe('reminders.ts — OpenClaw templates', () => {
    it('HOOK.md 应该包含正确的 frontmatter', () => {
        expect(OPENCLAW_HOOK_MD).toContain('name: mnemo');
        expect(OPENCLAW_HOOK_MD).toContain('agent:bootstrap');
    });

    it('handler.ts 应该导出 default handler', () => {
        expect(OPENCLAW_HANDLER_TS).toContain('export default handler');
    });

    it('handler.ts 应该处理 agent:bootstrap 事件', () => {
        expect(OPENCLAW_HANDLER_TS).toContain("event.action !== 'bootstrap'");
    });

    it('handler.ts 应该跳过 sub-agent sessions', () => {
        expect(OPENCLAW_HANDLER_TS).toContain(':subagent:');
    });

    it('handler.ts 应该注入 MNEMO_REMINDER.md 虚拟文件', () => {
        expect(OPENCLAW_HANDLER_TS).toContain('MNEMO_REMINDER.md');
        expect(OPENCLAW_HANDLER_TS).toContain('bootstrapFiles');
    });
});

describe('reminders.ts — OpenCode plugin template', () => {
    it('应该导出 MnemoReminder', () => {
        expect(OPENCODE_PLUGIN_TS).toContain('export const MnemoReminder');
    });

    it('应该使用 experimental.chat.messages.transform 进行隐形注入', () => {
        expect(OPENCODE_PLUGIN_TS).toContain('experimental.chat.messages.transform');
    });

    it('应该处理 experimental.session.compacting 事件', () => {
        expect(OPENCODE_PLUGIN_TS).toContain('experimental.session.compacting');
    });

    it('应该包含会话跟踪逻辑（seenSessions）', () => {
        expect(OPENCODE_PLUGIN_TS).toContain('seenSessions');
    });

    it('不应该使用 client.session.prompt（旧的可见注入方式）', () => {
        expect(OPENCODE_PLUGIN_TS).not.toContain('client.session.prompt');
        expect(OPENCODE_PLUGIN_TS).not.toContain('noReply');
    });

    it('不应该监听 session.idle 事件（触发过于频繁）', () => {
        expect(OPENCODE_PLUGIN_TS).not.toContain('session.idle');
    });

    it('应该区分新会话（sessionStart）和后续轮次（perTurn）', () => {
        expect(OPENCODE_PLUGIN_TS).toContain('SESSION_START_REMINDER');
        expect(OPENCODE_PLUGIN_TS).toContain('PER_TURN_REMINDER');
        expect(OPENCODE_PLUGIN_TS).toContain('isNewSession');
    });

    it('不应该需要 client 参数（无需 SDK 调用）', () => {
        expect(OPENCODE_PLUGIN_TS).toContain('async () =>');
        expect(OPENCODE_PLUGIN_TS).not.toContain('{ client }');
    });
});

describe('reminders.ts — HOOK_CONFIGS', () => {
    it('应该包含所有四种 agent 类型', () => {
        expect(HOOK_CONFIGS['claude-code']).toBeDefined();
        expect(HOOK_CONFIGS['codex']).toBeDefined();
        expect(HOOK_CONFIGS['openclaw']).toBeDefined();
        expect(HOOK_CONFIGS['opencode']).toBeDefined();
    });

    it('claude-code 和 codex 应该有 getSettingsPath', () => {
        expect(HOOK_CONFIGS['claude-code'].getSettingsPath).toBeDefined();
        expect(HOOK_CONFIGS['codex'].getSettingsPath).toBeDefined();
    });

    it('openclaw 和 opencode 不应有 getSettingsPath', () => {
        expect(HOOK_CONFIGS['openclaw'].getSettingsPath).toBeUndefined();
        expect(HOOK_CONFIGS['opencode'].getSettingsPath).toBeUndefined();
    });

    it('claude-code 应该安装 mnemo-activator.sh', () => {
        expect(HOOK_CONFIGS['claude-code'].files).toHaveProperty('mnemo-activator.sh');
    });

    it('openclaw 应该安装 HOOK.md 和 handler.ts', () => {
        expect(HOOK_CONFIGS['openclaw'].files).toHaveProperty('HOOK.md');
        expect(HOOK_CONFIGS['openclaw'].files).toHaveProperty('handler.ts');
    });

    it('opencode 应该安装 mnemo-reminder.ts', () => {
        expect(HOOK_CONFIGS['opencode'].files).toHaveProperty('mnemo-reminder.ts');
    });

    it('hookDir 路径应该包含 agent 标识', () => {
        const home = '/home/test';
        expect(HOOK_CONFIGS['claude-code'].getHookDir(home)).toContain('.claude');
        expect(HOOK_CONFIGS['codex'].getHookDir(home)).toContain('.codex');
        expect(HOOK_CONFIGS['openclaw'].getHookDir(home)).toContain('.openclaw');
        expect(HOOK_CONFIGS['opencode'].getHookDir(home)).toContain('opencode');
    });
});

// ---------------------------------------------------------------------------
// installer.ts — hook installation logic
// ---------------------------------------------------------------------------

describe('installer.ts — installHooks()', () => {
    let tmpHome: string;
    let originalHome: string;

    beforeEach(async () => {
        tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-hooks-test-'));
        originalHome = os.homedir();
        // Mock os.homedir to return tmpHome
        vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterAll(async () => {
        vi.restoreAllMocks();
    });

    it('应该为 claude-code 安装 activator 脚本', async () => {
        const result = await installHooks('claude-code');

        expect(result.success).toBe(true);
        expect(result.filesWritten.length).toBeGreaterThan(0);
        expect(result.settingsUpdated).toBe(true);
        expect(result.notes).toHaveLength(0);

        // Verify the shell script was written
        const scriptPath = result.filesWritten.find((f) => f.endsWith('mnemo-activator.sh'));
        expect(scriptPath).toBeDefined();
        const content = await fs.readFile(scriptPath!, 'utf-8');
        expect(content).toContain('#!/bin/bash');

        // Verify it's executable
        const stats = await fs.stat(scriptPath!);
        expect(stats.mode & 0o755).toBe(0o755);
    });

    it('应该为 codex 安装 activator 脚本', async () => {
        const result = await installHooks('codex');

        expect(result.success).toBe(true);
        expect(result.settingsUpdated).toBe(true);

        // Check the hook dir is under .codex
        expect(result.hookDir).toContain('.codex');
    });

    it('应该为 claude-code 正确合并 settings.json', async () => {
        const result = await installHooks('claude-code');
        expect(result.success).toBe(true);

        // Read the generated settings.json
        const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
        const raw = await fs.readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(raw);

        expect(settings.hooks).toBeDefined();
        expect(settings.hooks.UserPromptSubmit).toBeInstanceOf(Array);
        expect(settings.hooks.UserPromptSubmit.length).toBe(1);

        const entry = settings.hooks.UserPromptSubmit[0];
        expect(entry.hooks[0].type).toBe('command');
        expect(entry.hooks[0].command).toContain('mnemo');
    });

    it('应该保留 settings.json 中的已有配置', async () => {
        // Pre-create a settings.json with existing content
        const settingsDir = path.join(tmpHome, '.claude');
        await fs.mkdir(settingsDir, { recursive: true });
        await fs.writeFile(
            path.join(settingsDir, 'settings.json'),
            JSON.stringify({ permissions: { allow: ['Read'] }, hooks: { Stop: [{ matcher: '', hooks: [] }] } }),
        );

        const result = await installHooks('claude-code');
        expect(result.success).toBe(true);

        const raw = await fs.readFile(path.join(settingsDir, 'settings.json'), 'utf-8');
        const settings = JSON.parse(raw);

        // Original content preserved
        expect(settings.permissions.allow).toContain('Read');
        expect(settings.hooks.Stop).toBeDefined();
        // Mnemo hook added
        expect(settings.hooks.UserPromptSubmit.length).toBe(1);
    });

    it('重复安装应该替换旧的 mnemo 条目而不是累加', async () => {
        await installHooks('claude-code');
        await installHooks('claude-code');

        const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
        const raw = await fs.readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(raw);

        // Should only have one mnemo entry, not two
        const mnemoEntries = settings.hooks.UserPromptSubmit.filter((e: any) =>
            e.hooks?.some((h: any) => h.command?.includes('mnemo')),
        );
        expect(mnemoEntries).toHaveLength(1);
    });

    it('应该为 openclaw 安装 HOOK.md 和 handler.ts', async () => {
        const result = await installHooks('openclaw');

        expect(result.success).toBe(true);
        expect(result.settingsUpdated).toBe(false);
        expect(result.notes.length).toBeGreaterThan(0);
        expect(result.notes[0]).toContain('openclaw hooks enable');

        // Verify files exist
        const hookDir = result.hookDir;
        const hookMd = await fs.readFile(path.join(hookDir, 'HOOK.md'), 'utf-8');
        expect(hookMd).toContain('name: mnemo');

        const handler = await fs.readFile(path.join(hookDir, 'handler.ts'), 'utf-8');
        expect(handler).toContain('export default handler');
    });

    it('应该为 opencode 安装 plugin 文件', async () => {
        const result = await installHooks('opencode');

        expect(result.success).toBe(true);
        expect(result.settingsUpdated).toBe(false);
        expect(result.notes).toHaveLength(0);

        const pluginPath = path.join(result.hookDir, 'mnemo-reminder.ts');
        const content = await fs.readFile(pluginPath, 'utf-8');
        expect(content).toContain('MnemoReminder');
    });
});

describe('installer.ts — hasHooksInstalled()', () => {
    let tmpHome: string;

    beforeEach(async () => {
        tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-hooks-check-'));
        vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterAll(async () => {
        vi.restoreAllMocks();
    });

    it('未安装时应该返回 false', async () => {
        expect(await hasHooksInstalled('claude-code')).toBe(false);
        expect(await hasHooksInstalled('opencode')).toBe(false);
    });

    it('安装后应该返回 true', async () => {
        await installHooks('opencode');
        expect(await hasHooksInstalled('opencode')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// setup.ts — hook integration in memory_setup output
// ---------------------------------------------------------------------------

describe('setup.ts — memory_setup hook 集成', () => {
    let tmpDir: string;
    let tmpHome: string;

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-setup-hook-'));
        tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-home-hook-'));
    });

    afterAll(async () => {
        delete process.env.MNEMO_DATA_DIR;
        vi.restoreAllMocks();
        await fs.rm(tmpDir, { recursive: true, force: true });
        await fs.rm(tmpHome, { recursive: true, force: true });
    });

    it('memory_setup 输出应该包含 hook 安装结果', async () => {
        const { runSetup } = await import('../src/tools/setup.js');
        const { writeStorageConfig } = await import('../src/core/config.js');

        process.env.MNEMO_DATA_DIR = tmpDir;
        await writeStorageConfig('global');
        vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);

        // Create agent config file so file-based detection works
        const configDir = path.join(tmpHome, '.config', 'opencode');
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(path.join(configDir, 'opencode.json'), '{}');

        const result = await runSetup({ agentType: 'opencode', scope: 'global' });

        // Should contain hook status
        expect(result.message).toContain('Hooks:');
        expect(result.message).toContain('installed');
        expect(result.message).toContain('Prompt:');
    });
});
