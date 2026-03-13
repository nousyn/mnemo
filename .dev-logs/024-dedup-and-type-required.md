# 024 - Dedup 检测 + type 参数设计

## 改动概要

两个 memory_save 质量提升一起实现：

### 1. Programmatic Dedup Detection

**位置：** `src/core/embedding.ts` + `src/tools/save.ts`

**新增函数：**

```typescript
// embedding.ts
export const DEDUP_SIMILARITY_THRESHOLD = 0.85;

export async function findSimilar(
  content: string,
  threshold: number = DEDUP_SIMILARITY_THRESHOLD,
  topK: number = 3,
): Promise<SimilarNote[]>;
```

**工作流程：**

1. `memory_save` handler 在保存到磁盘**之前**调用 `findSimilar(content)`
2. 如果 embedding 模型未加载完，跳过检查（不阻塞正常保存）
3. 找到相似度 ≥ 0.85 的已有笔记时，保存仍然执行，但返回中附带警告
4. 警告内容包括：相似笔记的 ID、相似度百分比、内容摘要前 100 字符
5. 建议 agent 用 `memory_get` 确认是否重复，或用 `memory_compress` 合并

**设计决策：**

- **不阻止保存，只警告** — 保持 agent 自主权。阻止可能误杀合理的「补充/更新」场景
- **阈值 0.85** — MiniLM-L6-v2 余弦相似度，0.85+ 基本是语义近似或重复
- **dedup 检查失败不影响保存** — best effort，try/catch 包裹

### 2. type 参数最终设计：optional + fallback + 强警告

**最终方案（经过三次迭代）：**

初始实现将 type 改为 required，但发现 MCP SDK 的 zod 验证会在 handler 之前拒绝缺少 required 参数的请求——mnemo 完全没有机会给出友好的 fallback 或提示。这会降低保存成功率，agent 可能因此放弃调用。

最终设计：

- **schema 层**：`z.enum(MEMORY_TYPES).optional()` — 不拒绝缺少 type 的调用
- **handler 层**：`const resolvedType = type || 'fact'` — 没传就默认 fact
- **警告**：未传 type 时返回强提示 "WARNING: No type specified — force-defaulted to 'fact'. Always specify the correct type before saving. Untyped memories degrade retrieval quality."
- **prompt 层**：templates.ts 有 "**Always specify a type when saving.**" 引导 agent 主动传 type

**三次 commit 记录：**

1. `2ad2f43` — type 改为 required（初始方案）
2. `45a724b` — type 改回 optional + fallback 为 fact + 提示
3. `0c2381e` + `0fee5b0` — 强化警告文案，最终精简为一句话

## 测试变更

**`tests/embedding.test.ts`：**

- 新增 `findSimilar` describe，4 个测试用例
  - 相似笔记检测
  - 不相关内容不触发
  - 阈值常量验证
  - 高阈值时返回空数组

**`tests/tools.test.ts`：**

- 新增 2 个 dedup 测试用例（近似重复警告 + 独特内容无警告）
- 移除 1 个旧测试（"未指定 type 时应返回 soft hint"）
- 所有 `memory_save` 调用补充 `type` 参数

**总计：** 162 测试通过（+5 net）

## 文件变更

- `src/core/embedding.ts` — 新增 `findSimilar`、`DEDUP_SIMILARITY_THRESHOLD`、`SimilarNote` 类型
- `src/tools/save.ts` — 加入 dedup 检查、type optional + fallback + 强警告
- `tests/embedding.test.ts` — 新增 findSimilar 测试
- `tests/tools.test.ts` — dedup 测试 + type 相关测试更新（新增 no-type fallback 测试）
