# 025 - compress_apply 参数格式引导 + 搜索时间衰减

## 改动概要

两个改进：修复 compress_apply 工具调用失败的 UX 问题，以及为搜索结果引入时间衰减排序。

---

### 1. compress_apply 参数格式引导

**问题诊断：**

`memory_compress_apply` 工具调用一直失败，不是服务端 bug，而是 LLM 构造参数的 UX 问题：

- 工具需要 `notes`（对象数组 + content/tags/type）+ `old_ids`（ID 数组），全部在一次调用中传递
- `memory_compress` 返回的文本只说"use memory_compress_apply"，没有给出参数格式
- LLM 知道应该调用但不知道怎么构造参数 → 调用失败或空参数

**验证过程：**

- 用 `memory_save` + `memory_delete` 逐条操作可以成功（8 条新笔记 + 删除 54 条旧笔记）
- 原始 JSON-RPC 测试确认空参数会正确返回 zod 验证错误
- 说明 LLM 能蒸馏内容，但无法组装 compress_apply 的复杂参数

**修改位置：** `src/tools/compress.ts` ~行 101-130

**修改内容：**

compress 返回文本重构为结构化格式：

1. **Instructions** 部分 — 解释工作流：蒸馏 → 调用 compress_apply
2. **JSON 参数示例** — 展示 `notes` 数组和 `old_ids` 数组的完整格式
3. **字段说明** — content（必填）、tags（可选）、type（可选）、source（可选）
4. **预填充 old_ids** — 直接在返回中列出所有原始笔记 ID 数组，LLM 可以直接复制

**测试更新：** `tests/tools.test.ts` compress 测试断言从检查 `"Original note IDs to delete"` 改为检查 `'"old_ids"'`

---

### 2. 搜索时间衰减（Search Time Decay）

**动机：**

`memory_search` 返回的结果中，不同项目/时期的笔记得分相近时，agent 无法判断优先级。例如当前活跃项目 vs 一个月前暂停的项目，语义相似度可能一样，但 PM 的直觉会优先关注最近的。

**修改位置：** `src/core/embedding.ts`

**新增：**

```typescript
export const TIME_DECAY_HALF_LIFE_DAYS = 7;

export function recencyScore(created: string, halfLifeDays: number = TIME_DECAY_HALF_LIFE_DAYS): number {
  const ageMs = Date.now() - new Date(created).getTime();
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
  return Math.pow(2, -ageDays / halfLifeDays);
}
```

**衰减曲线：**

- 刚创建 → 1.0
- 7 天 → 0.5
- 14 天 → 0.25
- 30 天 → ~0.06
- 未来时间戳 → 1.0（ageDays clamp 到 0）

**搜索权重调整：**

| 搜索模式                     | 之前                       | 之后                                     |
| ---------------------------- | -------------------------- | ---------------------------------------- |
| 混合搜索（vector + keyword） | semantic 0.7 + keyword 0.3 | semantic 0.6 + keyword 0.2 + recency 0.2 |
| 仅关键词回退                 | keyword 1.0                | keyword 0.8 + recency 0.2                |

**mergeResults() 逻辑：**

- vector-only 结果：`score * 0.6 + recency * 0.2`
- keyword-only 结果：`score * 0.2 + recency * 0.2`
- 两者都匹配：vector 分 + keyword 分叠加（recency 只算一次）

**测试新增：** `tests/embedding.test.ts` 新增 `describe('recencyScore')` 块，8 个测试用例：

- 常量值检查
- 刚创建 → 接近 1
- 半衰期验证（7 天 → ~0.5，14 天 → ~0.25）
- 远古笔记 → 接近 0
- 自定义半衰期
- 未来时间戳处理
- 单调递减性

---

### 3. 测试韧性（Test Resilience）

**问题：** 当网络不可用时（无法从 huggingface.co 下载 embedding 模型），`embedding.test.ts` 和 `tools.test.ts` 的 `beforeAll` 抛出异常，导致 vitest 将整个测试套件标记为 "failed"（而非 "skipped"），pre-commit hook 因此失败。

**修改：**

1. `beforeAll` 中的模型加载改为 try/catch，网络失败时设 `embeddingAvailable = false`
2. 新增 `requireEmbedding(ctx: TaskContext)` 辅助函数，在 embedding 不可用时调用 `ctx.skip()`
3. 每个依赖 embedding 的测试在执行前调用 `requireEmbedding(ctx)`
4. 纯数学测试（`recencyScore`、常量检查）不依赖 embedding，始终运行

**影响的测试：**

- `embedding.test.ts`：15 个测试需要 embedding（跳过），9 个始终运行（recencyScore 8 + DEDUP_SIMILARITY_THRESHOLD 1）
- `tools.test.ts`：3 个测试需要 embedding（去重 2 + 语义搜索 1），38 个通过 MCP client 正常运行

**效果：** 网络不可用时 vitest 返回 exit code 0（全部 passed/skipped），pre-commit hook 不再被阻塞。

---

## 设计决策

- **半衰期 7 天**：平衡周粒度的项目切换和月粒度的长期记忆。一个月前的笔记不会消失（~0.06），只是排名更低
- **recency 占比 0.2**：不能喧宾夺主。语义相关性仍然是搜索的主要信号（0.6），时间只是 tiebreaker
- **导出 recencyScore 和常量**：方便测试和未来可能的外部使用
