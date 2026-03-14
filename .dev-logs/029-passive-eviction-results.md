# 029 - 方案3：被动淘汰 — 实施结果

日期: 2026-03-14

## 概要

实施方案3（被动淘汰），移除 `memory_compress` / `memory_compress_apply` 工具，替换为内部被动淘汰机制。Agent 可见工具从 6 个减少到 4 个，per-turn token 开销从 1080 降至约 780（进一步减少约 300 tokens）。

## 背景

`memory_compress` 暴露给 agent 导致严重的 compaction 数据丢失问题：agent 在 OpenCode compaction 触发前会主动蒸馏，将正在进行的计划和方案误判为"已记录冗余信息"而丢弃。移除 mnemo 后 OpenCode 自身的 compaction 反而无缝。

结论：记忆蒸馏/压缩不应暴露为 agent 工具，改为 mnemo 内部数据驱动的被动淘汰。

## 实施内容

### 1. 移除 compress 工具

- `src/tools/compress.ts`: 整体重写，移除 `memory_compress` 和 `memory_compress_apply` 注册逻辑，只保留 `memory_delete`。导出从 `registerCompressTool` 改为 `registerDeleteTool`
- `src/index.ts`: 导入改为 `registerDeleteTool`，工具注册从 6 个减至 4 个
- `src/prompts/templates.ts`: BASE_MEMORY_PROMPT 删除 compress 规则；OpenClaw 集成 prompt 删除 compress 引用
- `src/hooks/reminders.ts`: perTurn 提醒删除 `memory_compress` 引用；compaction 事件提醒删除压缩建议
- `src/tools/save.ts`: 移除 `COMPRESS_THRESHOLDS` 导入和超限时的压缩提示逻辑；添加 `runEviction()` fire-and-forget 调用；去重警告改为引用 `memory_delete`

### 2. NoteMeta 扩展

`src/core/config.ts` 新增字段和配置：

```typescript
// NoteMeta 新增
accessCount?: number    // 累计访问次数
lastAccessed?: string   // 最后访问 ISO 时间戳

// EvictionConfig 接口
interface EvictionConfig {
  enabled: boolean      // 默认 true
  maxNotes: number      // 默认 100
  evictBatch: number    // 默认 10
  archive: boolean      // 默认 true
}
```

`src/core/notes.ts`: `parseNote` / `serializeNote` 支持新字段；新增 `updateNoteMeta()` 和 `archiveNote()` 函数。

### 3. 访问频次追踪

新增 `src/core/access-tracker.ts`：

- `recordAccess(dataDir, noteId)`: 向队列文件 `access_queue.tsv` 追加一行 `{id}\t{timestamp}`
- `recordAccessBatch(dataDir, noteIds)`: 批量追加多个 id
- `flushAccessQueue(dataDir)`: 原子 rename 队列文件 → processing 文件，按 id 聚合访问次数，批量更新 NoteMeta 的 accessCount / lastAccessed

并发安全：`rename` 是原子操作，两个 mnemo 进程共享同一 global scope 时，只有一个进程能成功 rename 并处理队列。

`src/tools/search.ts` 和 `src/tools/get.ts`: 在返回结果后 fire-and-forget 调用 `recordAccessBatch()`。

### 4. 被动淘汰引擎

新增 `src/core/eviction.ts`：

- `evictionScore(meta)`: 综合评分 = `recencyScore(created) * 0.4 + normalizedAccessCount * 0.6`
  - recencyScore 复用现有时间衰减函数（半衰期 7 天）
  - accessCount 归一化为 0-1 范围（除以所有记忆中的最大值）
  - 分数越低越优先被淘汰
- `runEviction(dataDir)`: 完整淘汰流程
  1. 检查是否启用、是否超过容量上限
  2. 调用 flushAccessQueue 更新访问计数
  3. 对所有记忆按淘汰分升序排列
  4. 淘汰分最低的 N 条（超出部分 + evictBatch 缓冲）
  5. archive=true 时移入 `{dataDir}/archive/`，否则直接删除

### 5. 文档更新

- `README.md` + `docs/README.zh-CN.md`:
  - Features: "Compression workflow" → "Passive eviction"
  - Tools 表格: 6 → 4 个工具，移除 compress/compress_apply 行
  - Memory Lifecycle: 步骤 3 从 "Compress" 改为 "Eviction"
  - 移除 "Compressing memories" 使用示例
- `.dev-logs/mnemo-roadmap.md`: 添加方案1/2/3 条目和 compress 移除记录

### 6. 测试

8 个测试文件，197 个测试全部通过：

| 测试文件               | 测试数 | 变更说明                                                                |
| ---------------------- | -----: | ----------------------------------------------------------------------- |
| tools.test.ts          |     34 | 移除 compress 测试，工具数 6→4                                          |
| templates.test.ts      |     24 | compress 断言反转（toContain → not.toContain）                          |
| hooks.test.ts          |     39 | compaction 提醒不再包含压缩建议                                         |
| notes.test.ts          |     35 | 新增 accessCount/lastAccessed、updateNoteMeta、archiveNote 测试         |
| config.test.ts         |     20 | 新增 EvictionConfig / DEFAULT_EVICTION_CONFIG 测试                      |
| access-tracker.test.ts |     10 | **新增** — recordAccess、recordAccessBatch、flushAccessQueue            |
| eviction.test.ts       |     11 | **新增** — evictionScore、runEviction（启用/禁用、归档/删除、评分排序） |
| embedding.test.ts      |     24 | 无变更                                                                  |

## Token 对比

| 组件                           | Before (027 后) |          After |                       变化 |
| ------------------------------ | --------------: | -------------: | -------------------------: |
| AGENTS.md (BASE_MEMORY_PROMPT) |             223 |           ~200 |    ~-23 (去 compress 规则) |
| Hook perTurn reminder          |              74 |            ~60 |    ~-14 (去 compress 引用) |
| Tool schemas                   |   783 (6 tools) | ~520 (4 tools) | ~-263 (移除 2 工具 schema) |
| **合计**                       |        **1080** |       **~780** |          **~-300 (27.8%)** |

累计优化：从最初 2518 tokens/turn 降至 ~780 tokens/turn，总减少约 69%。

## 变更文件清单

```
# 源代码
src/index.ts              # registerDeleteTool 替换 registerCompressTool
src/core/config.ts        # NoteMeta 扩展, EvictionConfig, DEFAULT_EVICTION_CONFIG
src/core/notes.ts         # parse/serialize 新字段, updateNoteMeta(), archiveNote()
src/core/access-tracker.ts  # 新增 — 访问频次队列追踪
src/core/eviction.ts        # 新增 — 被动淘汰引擎
src/tools/compress.ts     # 重写为只导出 registerDeleteTool
src/tools/save.ts         # 移除压缩提示, 添加 runEviction() 调用
src/tools/search.ts       # 添加 recordAccessBatch() 调用
src/tools/get.ts          # 添加 recordAccessBatch() 调用
src/prompts/templates.ts  # 移除 compress 规则
src/hooks/reminders.ts    # 移除 compress 引用

# 测试
tests/tools.test.ts       # compress 测试移除, 工具数更新
tests/templates.test.ts   # compress 断言反转
tests/hooks.test.ts       # compaction 提醒更新
tests/notes.test.ts       # 新增 meta 字段测试
tests/config.test.ts      # 新增 eviction 配置测试
tests/access-tracker.test.ts  # 新增
tests/eviction.test.ts        # 新增

# 文档
README.md
docs/README.zh-CN.md
.dev-logs/mnemo-roadmap.md
.dev-logs/028-passive-eviction-plan.md
```

## 决策记录

- **被动淘汰 > 主动压缩**: Agent 不应决定丢弃哪些记忆，数据驱动的访问频次 + 时间衰减更可靠
- **队列文件 > 内存队列**: MCP stdio server 进程生命周期不可控，队列文件确保重启不丢数据
- **append + atomic rename**: 并发安全且零锁开销，适合多进程共享 global scope 场景
- **归档而非删除**: 淘汰的记忆移入 archive/ 目录，保留恢复可能性（手动操作）
- **评分权重 0.4/0.6**: 访问频次权重高于时间衰减，因为被频繁访问的记忆价值更高
- **COMPRESS_THRESHOLDS 保留未清理**: config.ts 中仍存在但无引用，作为 dead code 暂时保留
