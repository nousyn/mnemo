import { describe, it, expect } from 'vitest';
import { getPromptBlock, hasPromptInjected, injectPrompt, getAgentConfig } from '../src/prompts/templates.js';

describe('getPromptBlock', () => {
    it('应该包含 mnemo 标记', () => {
        const block = getPromptBlock();
        expect(block).toContain('<!-- mnemo:start -->');
        expect(block).toContain('<!-- mnemo:end -->');
    });

    it('应该包含核心指引内容', () => {
        const block = getPromptBlock();
        expect(block).toContain('memory_save');
        expect(block).toContain('memory_search');
        expect(block).toContain('memory_get');
        expect(block).toContain('memory_compress');
        expect(block).toContain('context window is nearly full');
    });
});

describe('hasPromptInjected', () => {
    it('已注入时应返回 true', () => {
        const content = '一些内容\n<!-- mnemo:start -->\nprompt\n<!-- mnemo:end -->\n';
        expect(hasPromptInjected(content)).toBe(true);
    });

    it('未注入时应返回 false', () => {
        expect(hasPromptInjected('普通内容')).toBe(false);
        expect(hasPromptInjected('')).toBe(false);
    });
});

describe('injectPrompt', () => {
    it('空内容应直接注入', () => {
        const result = injectPrompt('');
        expect(result).toContain('<!-- mnemo:start -->');
        expect(result).toContain('<!-- mnemo:end -->');
    });

    it('有现有内容时应追加到末尾', () => {
        const result = injectPrompt('# 我的配置\n\n一些内容');
        expect(result).toContain('# 我的配置');
        expect(result).toContain('<!-- mnemo:start -->');
        // 原内容在前，注入内容在后
        const configIdx = result.indexOf('# 我的配置');
        const mnemoIdx = result.indexOf('<!-- mnemo:start -->');
        expect(mnemoIdx).toBeGreaterThan(configIdx);
    });

    it('已有注入时应替换而非重复', () => {
        const first = injectPrompt('# 配置');
        const second = injectPrompt(first);

        // 只出现一次标记
        const startCount = (second.match(/<!-- mnemo:start -->/g) || []).length;
        expect(startCount).toBe(1);
    });

    it('替换后应保留原有内容', () => {
        const original = '# 原有配置\n\n其他内容';
        const first = injectPrompt(original);
        const second = injectPrompt(first);

        expect(second).toContain('# 原有配置');
        expect(second).toContain('其他内容');
    });
});

describe('getAgentConfig', () => {
    it('opencode 应返回 AGENTS.md', () => {
        const config = getAgentConfig('opencode');
        expect(config.fileName).toBe('AGENTS.md');
        expect(config.projectPath('/project')).toBe('/project/AGENTS.md');
        expect(config.globalPath('/home/user')).toBe('/home/user/.config/opencode/AGENTS.md');
    });

    it('claude-code 应返回 CLAUDE.md', () => {
        const config = getAgentConfig('claude-code');
        expect(config.fileName).toBe('CLAUDE.md');
        expect(config.projectPath('/project')).toBe('/project/CLAUDE.md');
        expect(config.globalPath('/home/user')).toBe('/home/user/.claude/CLAUDE.md');
    });

    it('openclaw 应返回 AGENTS.md', () => {
        const config = getAgentConfig('openclaw');
        expect(config.fileName).toBe('AGENTS.md');
        expect(config.projectPath('/project')).toBe('/project/AGENTS.md');
        expect(config.globalPath('/home/user')).toBe('/home/user/.openclaw/workspace/AGENTS.md');
    });

    it('codex 应返回 AGENTS.md', () => {
        const config = getAgentConfig('codex');
        expect(config.fileName).toBe('AGENTS.md');
        expect(config.projectPath('/project')).toBe('/project/AGENTS.md');
        expect(config.globalPath('/home/user')).toBe('/home/user/.codex/AGENTS.md');
    });

    it('所有 agent 类型都应有配置', () => {
        const types = ['opencode', 'claude-code', 'openclaw', 'codex'] as const;
        for (const t of types) {
            const config = getAgentConfig(t);
            expect(config.fileName).toBeTruthy();
            expect(config.projectPath).toBeTypeOf('function');
            expect(config.globalPath).toBeTypeOf('function');
        }
    });
});
