import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
    REMINDERS,
    ACTIVATOR_SCRIPT,
    OPENCLAW_HANDLER_TS,
    OPENCODE_PLUGIN_TS,
    getHookSets,
} from '../src/hooks/reminders.js';
import { createKit } from '@s_s/agent-kit';
import type { AgentType } from '../src/core/config.js';

// ---------------------------------------------------------------------------
// reminders.ts — template content validation
// ---------------------------------------------------------------------------

describe('reminders.ts — REMINDERS object', () => {
    it('应该包含三种 reminder 文本（compaction 已移除）', () => {
        expect(REMINDERS.perTurn).toBeDefined();
        expect(REMINDERS.sessionStart).toBeDefined();
        expect(REMINDERS.sessionEnd).toBeDefined();
    });

    it('perTurn 应该使用 mnemo-reminder 标签', () => {
        expect(REMINDERS.perTurn).toContain('<mnemo-reminder>');
        expect(REMINDERS.perTurn).toContain('</mnemo-reminder>');
    });

    it('sessionStart 应该提醒搜索记忆', () => {
        expect(REMINDERS.sessionStart).toContain('memory_search');
    });

    it('不应该包含 compaction reminder（各 agent 的 compaction hook 均无法有效注入）', () => {
        expect((REMINDERS as any).compaction).toBeUndefined();
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

    it('不应该处理 experimental.session.compacting 事件（干扰 compaction 摘要质量）', () => {
        expect(OPENCODE_PLUGIN_TS).not.toContain('experimental.session.compacting');
    });

    it('应该在 compaction 后跳过所有注入', () => {
        expect(OPENCODE_PLUGIN_TS).toContain('isPostCompaction');
        expect(OPENCODE_PLUGIN_TS).toContain('type === "compaction"');
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

describe('reminders.ts — getHookSets()', () => {
    it('应该为所有四种 agent 类型返回 HookSet 数组', () => {
        const types: AgentType[] = ['claude-code', 'codex', 'openclaw', 'opencode'];
        for (const t of types) {
            const sets = getHookSets(t);
            expect(Array.isArray(sets)).toBe(true);
            expect(sets.length).toBeGreaterThan(0);
        }
    });

    it('claude-code HookSet 应该包含 UserPromptSubmit 事件', () => {
        const sets = getHookSets('claude-code');
        const def = sets[0].definitions[0];
        expect(def.events).toContain('UserPromptSubmit');
    });

    it('codex HookSet 应该包含 UserPromptSubmit 事件', () => {
        const sets = getHookSets('codex');
        const def = sets[0].definitions[0];
        expect(def.events).toContain('UserPromptSubmit');
    });

    it('openclaw HookSet 应该包含 agent:bootstrap 事件', () => {
        const sets = getHookSets('openclaw');
        const def = sets[0].definitions[0];
        expect(def.events).toContain('agent:bootstrap');
    });

    it('opencode HookSet 应该包含 experimental.chat.messages.transform 事件', () => {
        const sets = getHookSets('opencode');
        const def = sets[0].definitions[0];
        expect(def.events).toContain('experimental.chat.messages.transform');
    });

    it('HookSet 的 agent 字段应与请求的 agent 类型匹配', () => {
        const types: AgentType[] = ['claude-code', 'codex', 'openclaw', 'opencode'];
        for (const t of types) {
            const sets = getHookSets(t);
            for (const s of sets) {
                expect(s.agent).toBe(t);
            }
        }
    });
});

// ---------------------------------------------------------------------------
// agent-kit installHooks — via createKit('mnemo').installHooks()
// ---------------------------------------------------------------------------

describe('agent-kit installHooks() 集成', () => {
    let tmpHome: string;

    beforeEach(async () => {
        tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-hooks-test-'));
        vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterAll(async () => {
        vi.restoreAllMocks();
    });

    it('应该为 claude-code 安装 activator 脚本', async () => {
        const kit = createKit('mnemo');
        const hookSets = getHookSets('claude-code');
        const result = await kit.installHooks('claude-code', hookSets);

        expect(result.success).toBe(true);
        expect(result.filesWritten.length).toBeGreaterThan(0);
        expect(result.settingsUpdated).toBe(true);

        // Verify a shell script was written
        const scriptPath = result.filesWritten.find((f) => f.endsWith('.sh'));
        expect(scriptPath).toBeDefined();
        const content = await fs.readFile(scriptPath!, 'utf-8');
        expect(content).toContain('#!/bin/bash');

        // Verify it's executable
        const stats = await fs.stat(scriptPath!);
        expect(stats.mode & 0o755).toBe(0o755);
    });

    it('应该为 codex 安装 activator 脚本', async () => {
        const kit = createKit('mnemo');
        const hookSets = getHookSets('codex');
        const result = await kit.installHooks('codex', hookSets);

        expect(result.success).toBe(true);
        expect(result.settingsUpdated).toBe(true);
        expect(result.hookDir).toContain('.codex');
    });

    it('应该为 claude-code 正确合并 settings.json', async () => {
        const kit = createKit('mnemo');
        const hookSets = getHookSets('claude-code');
        const result = await kit.installHooks('claude-code', hookSets);
        expect(result.success).toBe(true);

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
        const settingsDir = path.join(tmpHome, '.claude');
        await fs.mkdir(settingsDir, { recursive: true });
        await fs.writeFile(
            path.join(settingsDir, 'settings.json'),
            JSON.stringify({ permissions: { allow: ['Read'] }, hooks: { Stop: [{ matcher: '', hooks: [] }] } }),
        );

        const kit = createKit('mnemo');
        const hookSets = getHookSets('claude-code');
        const result = await kit.installHooks('claude-code', hookSets);
        expect(result.success).toBe(true);

        const raw = await fs.readFile(path.join(settingsDir, 'settings.json'), 'utf-8');
        const settings = JSON.parse(raw);

        expect(settings.permissions.allow).toContain('Read');
        expect(settings.hooks.Stop).toBeDefined();
        expect(settings.hooks.UserPromptSubmit.length).toBe(1);
    });

    it('重复安装应该替换旧的 mnemo 条目而不是累加', async () => {
        const kit = createKit('mnemo');
        const hookSets = getHookSets('claude-code');
        await kit.installHooks('claude-code', hookSets);
        await kit.installHooks('claude-code', hookSets);

        const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
        const raw = await fs.readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(raw);

        const mnemoEntries = settings.hooks.UserPromptSubmit.filter((e: any) =>
            e.hooks?.some((h: any) => h.command?.includes('mnemo')),
        );
        expect(mnemoEntries).toHaveLength(1);
    });

    it('应该为 openclaw 安装 HOOK.md 和 handler.ts', async () => {
        const kit = createKit('mnemo');
        const hookSets = getHookSets('openclaw');
        const result = await kit.installHooks('openclaw', hookSets);

        expect(result.success).toBe(true);
        expect(result.settingsUpdated).toBe(false);
        expect(result.notes.length).toBeGreaterThan(0);
        expect(result.notes[0]).toContain('openclaw hooks enable');

        const hookDir = result.hookDir;
        const hookMd = await fs.readFile(path.join(hookDir, 'HOOK.md'), 'utf-8');
        expect(hookMd).toContain('name: mnemo');

        const handler = await fs.readFile(path.join(hookDir, 'handler.ts'), 'utf-8');
        expect(handler).toContain('export default handler');
    });

    it('应该为 opencode 安装 plugin 文件', async () => {
        const kit = createKit('mnemo');
        const hookSets = getHookSets('opencode');
        const result = await kit.installHooks('opencode', hookSets);

        expect(result.success).toBe(true);
        expect(result.settingsUpdated).toBe(false);

        // OpenCode: filename is mnemo-experimental-chat-messages-transform-plugin.ts
        const pluginFile = result.filesWritten.find((f) => f.includes('mnemo'));
        expect(pluginFile).toBeDefined();
        const content = await fs.readFile(pluginFile!, 'utf-8');
        expect(content).toContain('MnemoReminder');
    });
});

describe('agent-kit hasHooksInstalled() 集成', () => {
    let tmpHome: string;

    beforeEach(async () => {
        tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mnemo-hooks-check-'));
        vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
    });

    afterAll(async () => {
        vi.restoreAllMocks();
    });

    it('未安装时应该返回 false', async () => {
        const kit = createKit('mnemo');
        expect(await kit.hasHooksInstalled('claude-code')).toBe(false);
        expect(await kit.hasHooksInstalled('opencode')).toBe(false);
    });

    it('安装后应该返回 true', async () => {
        const kit = createKit('mnemo');
        const hookSets = getHookSets('opencode');
        await kit.installHooks('opencode', hookSets);
        expect(await kit.hasHooksInstalled('opencode')).toBe(true);
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
