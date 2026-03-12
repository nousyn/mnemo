# 020 - Prompt 优化 v2：触发机制落地与约束机制补全

## 背景

v1.3.0 的 prompt 重写解决了产品定位问题（从全量记录转向高价值长期上下文），但实际使用中发现：

- 整轮对话中零次自动触发 mnemo 工具
- 所有 memory_save 都是用户手动要求的
- prompt 中的规则是抽象的（"重要信息时保存"），LLM 容易跳过

同时，015（最小约束机制）和 016（触发机制 v1）的设计只有部分实现在 prompt 中：

- 约束规则 3（演化与沉淀）❌ 未在 prompt 中
- 约束规则 5（闭环机制）❌ 未在 prompt 中
- 约束规则 6（经验进入门槛）❌ 只有一句话
- 016 的用户话语模式 ❌ 未在 prompt 中
- 016 的优先级区分 ❌ 未在 prompt 中

此外，分析了 self-improving-agent skill（v3.0.0）的 prompt 结构，发现其三个关键技巧：

1. Quick Reference 查找表（situation → action）—— 可扫描性极高
2. 具体用户话语模式（"No, that's wrong..."）—— LLM 几乎条件反射地匹配
3. 自我评估问题（"Was there a non-obvious solution?"）—— 促发反思而非依赖规则遵守

## 优化策略

### 核心原则

不改变 prompt 的基本结构和 tool 描述，只优化 BASE_MEMORY_PROMPT 的内容，让 LLM 更容易触发 mnemo 工具。

### 具体改动

#### 1. 新增 Quick Reference 表（最顶部）

在 prompt 最顶部（产品定位说明之后）添加一张 situation → action → type 的快速查找表。

设计理由：

- 位于 prompt 最前面，注意力权重最高
- 表格格式比列表更可扫描
- 涵盖 search/save/compress 三类动作
- 包括 continuity 闭环场景

#### 2. memory_search 强化为最高优先级

将 memory_search 提到 memory_save 之前（原 prompt 中 save 在前），并加粗强调"会话开始时搜索是最高优先级动作"。

添加具体用户话语模式：

- "do you remember..."
- "we discussed before..."
- "last time we..."
- "didn't we decide..."
- "what was the conclusion on..."
- "as we agreed..."
- "going back to..."

#### 3. memory_save 按类型分组 + 话语模式

将原来的平铺列表改为按类型分组，每组包含：

- 典型用户话语模式（具体字符串匹配）
- 抽象描述（作为兜底）

这是从 self-improving-agent 学到的最重要技巧：给出具体话语模式比给出抽象规则有效得多。

#### 4. 新增 experience 进入门槛（约束规则 6）

将 experience 的保存条件从一句话扩展为三个必须同时满足的条件：

1. 已被验证
2. 可复用
3. 会影响未来工作

并明确说明不保存的内容：单次错误、未确认的 workaround 等。

#### 5. 新增 Memory Lifecycle 章节（约束规则 3 + 5）

新增独立章节覆盖：

**演化路径（规则 3）**：

- `continuity → decision`
- `decision → rule`
- `continuity → fact`
- `experience → rule`

**闭环机制（规则 5）**：

- continuity 解决后必须转化或移除
- 明确说"悬挂的 continuity 会污染记忆系统"

**去重收敛（规则 4 强化）**：

- 从原来的一句话扩展为优先级顺序：补充 → 更新 → 替换 → 新增

#### 6. 新增 Self-Check 章节

在 prompt 末尾添加三个自我评估问题：

- 这轮对话是否产生了持久的结论、偏好或决策？
- 是否有重要线头未闭环，需要保存为 continuity？
- 是否学到了可复用的东西，不保存会丢失？

设计理由：

- 问题比规则更容易触发反思
- 放在末尾，作为每轮任务完成后的 checkpoint
- 与 self-improving-agent 的 activator.sh 思路一致，但不依赖 hook 机制

### 未做的改动

- 未引入 hook 机制（这是独立任务）
- 未修改 tool descriptions（不在本次范围）
- 未修改 agent 适配层（openclaw 适配层保持不变）
- 未添加优先级标记（一级/二级）—— 判断这会增加 prompt 复杂度但收益有限，用话语模式的具体性来隐式实现优先级

## 结构对比

### 旧 prompt 结构（v1.3.0）

```
产品定位
When to save (平铺列表)
When to initialize
When to search
When to get
When to compress
Guidelines (混合规则)
```

### 新 prompt 结构（v2）

```
产品定位
Quick Reference 表（最高注意力位置）
When to search（提前 + 话语模式 + 强调最高优先级）
When to save（按类型分组 + 话语模式 + experience 高门槛）
When to initialize
When to get
When to compress
Memory Lifecycle（演化 + 闭环 + 去重）
Guidelines（保留核心规则）
Self-Check（自我评估问题）
```

## 实现

- 修改文件：`src/prompts/templates.ts` 中的 `BASE_MEMORY_PROMPT`
- 全部 118 个测试通过
- 未引入新的导出或接口变更

## 约束机制落地状态

| 约束规则     | 015 编号 | 状态                                       |
| ------------ | -------- | ------------------------------------------ |
| 保存阈值     | 1        | ✅ 已在 prompt（Guidelines 中的 2/3 标准） |
| 分类边界     | 2        | ✅ 已在 prompt（强制分类 + type 参数）     |
| 演化与沉淀   | 3        | ✅ 新增 Memory Lifecycle 章节              |
| 去重与收敛   | 4        | ✅ 强化为优先级顺序                        |
| 闭环机制     | 5        | ✅ 新增 continuity closure 段落            |
| 经验进入门槛 | 6        | ✅ 新增三条件门槛 + 排除列表               |

## 触发机制落地状态

| 016 设计项                     | 状态                                    |
| ------------------------------ | --------------------------------------- |
| 会话开始搜索                   | ✅ 强化为最高优先级                     |
| 用户引用过去讨论               | ✅ 7 种具体话语模式                     |
| 进入长期主题                   | ✅ Quick Reference 表                   |
| 偏好/决策/规则/目标/连续性触发 | ✅ 按类型分组 + 话语模式                |
| 经验谨慎保存                   | ✅ 高门槛三条件                         |
| 触发顺序                       | ✅ 保持 search → work → save → compress |
| 优先级区分（一级/二级）        | ⚠️ 隐式实现（通过话语模式的具体性）     |
| 自我评估检查点                 | ✅ Self-Check 章节                      |

## 下一步

- 需要在实际使用中验证触发率是否提升
- 如果 prompt 优化仍不够，考虑引入 hook 机制（companion script）
- 更新 mnemo 自身的 AGENTS.md 中注入的 prompt（通过 memory_setup 重新注入）
