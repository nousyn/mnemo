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
        expect(block).toContain('memory_setup');
        expect(block).toContain('memory_save');
        expect(block).toContain('memory_search');
        expect(block).toContain('memory_get');
        expect(block).toContain('memory_compress');
        expect(block).toContain('context compaction or context window reset');
        expect(block).toContain('high-value long-term context');
    });

    it('应该包含初始化兜底与默认 global 策略', () => {
        const block = getPromptBlock();
        expect(block).toContain('Mnemo has not been initialized yet');
        expect(block).toContain('Default to global scope');
        expect(block).toContain('Use project scope only when the user explicitly wants isolated per-project memory');
    });

    it('应该包含新的触发顺序与保存边界', () => {
        const block = getPromptBlock();
        expect(block).toContain('memory_search -> do the work -> memory_save -> memory_compress');
        expect(block).toContain('Do not save routine task state');
        expect(block).toContain('stable preference');
        expect(block).toContain('continuity thread');
    });

    it('应该包含保存阈值与去重引导', () => {
        const block = getPromptBlock();
        expect(block).toContain('meets at least 2 of these 3 criteria');
        expect(block).toContain('useful across future sessions');
        expect(block).toContain('similar memory already exists');
        expect(block).toContain('updating or replacing existing memories');
    });

    it('save 触发条件应标注建议的 type', () => {
        const block = getPromptBlock();
        expect(block).toContain('→ type: preference');
        expect(block).toContain('→ type: decision');
        expect(block).toContain('→ type: goal');
        expect(block).toContain('→ type: continuity');
        expect(block).toContain('→ type: rule');
        expect(block).toContain('→ type: experience');
    });

    it('Guidelines 应包含分类指引', () => {
        const block = getPromptBlock();
        expect(block).toContain('Classify each memory with a type before saving');
        expect(block).toContain('preference, profile, goal, continuity, fact, decision, rule, or experience');
    });

    it('无 agentType 时应只包含 base prompt', () => {
        const block = getPromptBlock();
        expect(block).not.toContain('OpenClaw Integration');
    });

    it('非 openclaw agent 应只包含 base prompt', () => {
        const block = getPromptBlock('opencode');
        expect(block).not.toContain('OpenClaw Integration');
    });

    it('openclaw 应包含 base + 适配层', () => {
        const block = getPromptBlock('openclaw');
        // base 内容
        expect(block).toContain('memory_save');
        expect(block).toContain('memory_search');
        // 适配层内容
        expect(block).toContain('OpenClaw Integration');
        expect(block).toContain('daily memory file');
        expect(block).toContain('memory_compress to consolidate');
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

    it('openclaw 注入应包含适配层', () => {
        const result = injectPrompt('# 配置', 'openclaw');
        expect(result).toContain('OpenClaw Integration');
        expect(result).toContain('daily memory file');
    });

    it('非 openclaw 注入不应包含适配层', () => {
        const result = injectPrompt('# 配置', 'opencode');
        expect(result).not.toContain('OpenClaw Integration');
    });

    it('替换时应保留 agentType 适配层', () => {
        const first = injectPrompt('# 配置', 'openclaw');
        const second = injectPrompt(first, 'openclaw');
        expect(second).toContain('OpenClaw Integration');
        const startCount = (second.match(/<!-- mnemo:start -->/g) || []).length;
        expect(startCount).toBe(1);
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
