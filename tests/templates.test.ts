import { describe, it, expect } from 'vitest';
import { buildMemoryPrompt } from '../src/prompts/templates.js';

describe('buildMemoryPrompt', () => {
    it('应该包含核心指引内容', () => {
        const prompt = buildMemoryPrompt();
        expect(prompt).toContain('high-value long-term context');
        expect(prompt).toContain('Save selectively');
    });

    it('不应包含已移除的 compress 工具引用', () => {
        const prompt = buildMemoryPrompt();
        expect(prompt).not.toContain('memory_compress');
        expect(prompt).not.toContain('memory_compress_apply');
    });

    it('不应包含搜索优先静态规则（已由 hook 机制取代）', () => {
        const prompt = buildMemoryPrompt();
        expect(prompt).not.toContain('Search first');
        expect(prompt).not.toContain('START of each conversation');
    });

    it('应该包含保存阈值与去重引导', () => {
        const prompt = buildMemoryPrompt();
        expect(prompt).toContain('useful across sessions');
        expect(prompt).toContain('affects future work');
        expect(prompt).toContain('Dedup before saving');
        expect(prompt).toContain('updating/replacing');
    });

    it('应该包含类型分类指引', () => {
        const prompt = buildMemoryPrompt();
        expect(prompt).toContain('Always specify type');
        expect(prompt).toContain('preference');
        expect(prompt).toContain('continuity');
        expect(prompt).toContain('decision');
        expect(prompt).toContain('rule');
        expect(prompt).toContain('experience');
    });

    it('应该包含生命周期演变规则', () => {
        const prompt = buildMemoryPrompt();
        expect(prompt).toContain('Lifecycle');
    });

    it('应该包含蒸馏而非转储的指引', () => {
        const prompt = buildMemoryPrompt();
        expect(prompt).toContain('Distill');
        expect(prompt).toContain('essence');
    });

    it('无 agentType 时应只包含 base prompt', () => {
        const prompt = buildMemoryPrompt();
        expect(prompt).not.toContain('OpenClaw Integration');
    });

    it('非 openclaw agent 应只包含 base prompt', () => {
        const prompt = buildMemoryPrompt('opencode');
        expect(prompt).not.toContain('OpenClaw Integration');
    });

    it('openclaw 应包含 base + 适配层', () => {
        const prompt = buildMemoryPrompt('openclaw');
        // base 内容
        expect(prompt).toContain('Save selectively');
        // 适配层内容
        expect(prompt).toContain('OpenClaw Integration');
        expect(prompt).toContain('daily memory file');
    });
});
