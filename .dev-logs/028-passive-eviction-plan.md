# 028 - 方案3：被动淘汰 — 实施计划

## 背景

`memory_compress` / `memory_compress_apply` 暴露给 agent 导致严重问题：agent 在 compaction 前主动蒸馏时，会将正在讨论的方案和进行中的计划误判为冗余信息而丢弃，导致 compaction 后关键上下文不可恢复。移除 mnemo 后 OpenCode 自身的 compaction 恢复反而无缝。

结论：记忆蒸馏不应暴露为 agent 工具，改为 mnemo 内部的被动淘汰机制。

## 整体架构

```
search/get 命中 → append 到队列文件（轻量 IO）
       ↓
save 触发 → 检查记忆总数是否超过容量上限
       ↓ 是
  rename 队列文件为临时文件（原子操作）
       ↓
  读取临时文件，按 id 聚合访问次数
       ↓
  批量更新记忆文件的 accessCount / lastAccessed
       ↓
  计算淘汰评分（时间衰减 + 访问频次）
       ↓
  淘汰评分最低的记忆 → 移入 archive/
```

## 一、移除 compress 系列工具

**目标**：agent 可见工具从 6 个降到 4 个（memory_save / memory_search / memory_get / memory_delete），消除 agent 主动蒸馏导致的记忆丢失风险，同时进一步减少 per-turn token 开销（~300 tokens）。

改动文件：

- `src/tools/compress.ts` — 移除 `memory_compress` 和 `memory_compress_apply` 的注册，只保留 `memory_delete`
- `src/index.ts` — 调整工具注册
- `src/prompts/templates.ts` — BASE_MEMORY_PROMPT 删除 compress 规则
- `src/hooks/reminders.ts` — perTurn 提醒删除 `memory_compress` 相关内容；compaction 事件提醒删除压缩建议
- `src/tools/save.ts` — 移除保存后的压缩阈值提示（当前超过 50 条会提醒 agent 压缩）

## 二、访问频次追踪

**目标**：为淘汰决策提供数据基础。访问频次是判断记忆是否有用的核心维度。

### 数据结构变更

`NoteMeta` 新增字段：

```typescript
accessCount: number; // 累计被 search/get 命中的次数
lastAccessed: string; // 最后一次被访问的 ISO 时间戳
```

### 队列文件机制

为避免每次 search/get 都直接写记忆文件，采用队列文件缓冲：

**写入（search/get 命中时）**：

- 向队列文件 `{dataDir}/access_queue.tsv` 追加一行：`{id}\t{timestamp}\n`
- 使用 `fs.appendFile`，文件不存在时自动创建
- 零读取开销，只有 append

**处理（save 触发淘汰前）**：

1. `rename` 队列文件为临时文件 `access_queue.processing.tsv`（原子操作）
2. rename 失败说明文件不存在或被另一个进程抢先处理，跳过
3. 读取临时文件，按 id 聚合访问次数
4. 批量更新对应记忆 .md 文件的 frontmatter（accessCount 累加，lastAccessed 更新为最新时间戳）
5. 删除临时文件

### 并发安全

两个 mnemo 进程（如 OpenCode + OpenClaw 共享 global scope）各自独立运行此逻辑。rename 是原子操作，保证同一份队列文件只被一个进程处理。另一个进程的后续 append 会自动创建新的队列文件。rename 失败（ENOENT）说明被另一个进程抢先处理或队列为空，直接跳过。

## 三、被动淘汰机制

**触发时机**：`memory_save` 成功后，检查当前记忆总数是否超过容量上限。

**淘汰评分公式**：

```
淘汰分 = recencyScore(created) * W1 + accessFrequency * W2
```

- `recencyScore`：复用现有时间衰减函数（半衰期 7 天）
- `accessFrequency`：`accessCount` 归一化后的值
- W1、W2 权重待实现时确定，初步考虑 0.4 / 0.6（访问频次权重更高）
- 分数越低越优先被淘汰

**淘汰流程**：

1. 处理访问计数队列（步骤二）
2. 读取所有记忆的 meta
3. 按淘汰分升序排列
4. 淘汰分最低的记忆移入归档：从向量索引中删除，将 .md 文件移动到 `{dataDir}/archive/`
5. 淘汰数量 = 超出上限的部分 + 缓冲（如超了 5 条则淘汰 10 条，避免频繁触发）

## 四、归档

被淘汰的记忆不直接删除，移动到 `{dataDir}/archive/{id}.md`：

- 保留原始文件内容，仅从活跃存储和向量索引中移除
- 不占向量索引空间，不影响搜索性能
- 不做程序化的恢复功能——极端情况下用户可手动将 .md 文件移回 `notes/` 目录

## 五、配置项

```typescript
eviction: {
  enabled: true,      // 是否启用被动淘汰，默认 true
  maxNotes: 100,      // 容量上限，默认 100
  evictBatch: 10,     // 每次淘汰缓冲量，默认 10
  archive: true       // 归档而非直接删除，默认 true
}
```

## 六、测试

- 访问计数队列的写入、处理、并发安全
- 淘汰触发条件、评分排序准确性
- 归档文件生成和向量索引清理
- 现有 compress 相关测试移除或改写
- 端到端：save 超限后自动淘汰的完整流程

## 七、文档更新

- README / README.zh-CN：工具表从 6 个更新到 4 个，新增淘汰机制说明
- dev-log：记录实施结果
