# 030 - 索引完整性检查 + 自动重建 & 移除 Search-first 静态规则

日期: 2026-03-14

## 概要

修复 vectra 向量索引与磁盘笔记文件长期不同步的根本问题：新增进程级索引完整性检查和自动重建机制。同时移除 BASE_MEMORY_PROMPT 中冗余的 "Search first" 静态规则（已由 SESSION_START_REMINDER hook 机制取代）。对实际数据目录执行重建，23 条笔记全部成功索引。

## 背景

### 索引不同步问题

`memory_get` 返回 "No memories found" 的根因：vectra 向量索引与 `notes/` 文件存储完全脱节（零重叠）。27 条索引条目全部指向已删除的笔记文件；23 条磁盘笔记无任何索引条目。

根本原因链：

1. 旧 `memory_compress_apply` 成功删除旧笔记文件，但 `indexNote` 失败被 try/catch 静默吞掉
2. `removeFromIndex` 在 item 不存在时静默跳过，不报错不日志
3. vectra 的 `deleteItem` 不清理外部 metadata JSON 文件（设计缺陷），导致 43 个孤立 metadata 文件

### Search-first 冗余

`BASE_MEMORY_PROMPT` 中的 "Search first: At the START of each conversation, call memory_search..." 规则与 `SESSION_START_REMINDER` hook 功能重复。hook 机制在新会话启动时注入搜索提醒，静态规则不再必要。

## 实施内容

### 1. 索引完整性检查 (`ensureIndexIntegrity`)

`src/core/embedding.ts` 新增私有函数：

- **`ensureIndexIntegrity()`**: 进程级一次性检查（`integrityChecked` Set 防重入），在读路径入口（`searchNotes`、`findSimilar`）调用，而非写路径（`save`/`indexNote`），避免正常保存流程中笔记先写盘再索引的时序导致误报
- **`checkAndRepairIndex(index, indexDir)`**: 收集磁盘笔记 ID 集合和索引条目 ID 集合，两个集合不完全匹配即视为不一致，触发全量重建

索引条目 ID 提取需处理 vectra 的 `metadata_config: { indexed: ['source'] }` 特性：非 indexed 字段（包括 id）存储在外部 JSON 文件中，需逐个读取解析。

### 2. 全量重建 (`rebuildIndex`)

`src/core/embedding.ts` 新增导出函数 `rebuildIndex(existingIndex?, indexDir?)`：

1. 清理所有外部 metadata JSON 文件（`*.json` 除 `index.json`）
2. 删除并重建空索引
3. 读取磁盘上所有笔记，逐条生成 embedding 并插入索引
4. 返回 `{ indexed, errors }` 统计

### 3. `removeFromIndex` 改进

- item 不存在时输出 `console.error` 日志（之前静默跳过）
- 删除 item 后清理对应的外部 metadata JSON 文件（绕过 vectra 不清理的缺陷）

### 4. `searchNotes` 文件存在性验证

向量搜索返回结果后，逐条验证对应 `.md` 文件是否存在于磁盘（`fs.access`），过滤掉陈旧的索引条目。作为重建机制之外的额外安全层。

### 5. 移除 "Search first" 静态规则

`src/prompts/templates.ts`: `BASE_MEMORY_PROMPT` 删除 `- **Search first**: At the START of each conversation, call memory_search based on the user's message before doing work.`

### 6. 改进 `save.ts` 索引失败提示

`src/tools/save.ts`: indexNote 失败的 warning 文案从 "will be available via memory_search after the embedding model finishes loading" 改为 "is safely persisted and will be automatically indexed on next search via integrity repair"，准确反映新的自动修复机制。

## 测试

8 个测试文件，202 个测试全部通过：

| 测试文件               | 测试数 | 变更说明                                                                     |
| ---------------------- | -----: | ---------------------------------------------------------------------------- |
| embedding.test.ts      |     26 | 新增 rebuildIndex 2 个测试（重建计数 + 清理孤立 metadata）                   |
| templates.test.ts      |     24 | "应该包含搜索优先规则" → "不应包含搜索优先静态规则"；移除 memory_search 断言 |
| tools.test.ts          |     34 | 无变更                                                                       |
| hooks.test.ts          |     39 | 无变更                                                                       |
| notes.test.ts          |     35 | 无变更                                                                       |
| config.test.ts         |     23 | 无变更                                                                       |
| access-tracker.test.ts |     10 | 无变更                                                                       |
| eviction.test.ts       |     11 | 无变更                                                                       |

### 测试设计决策

不为 `ensureIndexIntegrity`（私有函数）导出测试辅助 reset 函数。理由：integrity check 的核心逻辑是"检测不一致 → 调 rebuildIndex"，而 rebuildIndex 已通过公共 API 直接测试。测试应通过可观察行为验证，不依赖内部状态操作。

## 实际数据修复

对 `~/Library/Application Support/mnemo/` 执行 `rebuildIndex()`：

- 清理 43 个孤立 metadata JSON 文件
- 删除包含 27 条陈旧条目的旧索引
- 重新索引 23 条磁盘笔记，0 错误
- 重建后：24 个文件（23 metadata JSON + index.json），与 23 个笔记完全匹配

## 变更文件清单

```
# 源代码
src/core/embedding.ts     # 新增 ensureIndexIntegrity, checkAndRepairIndex, rebuildIndex;
                          # 改进 removeFromIndex (日志 + metadata 清理);
                          # searchNotes 添加文件存在性验证 + integrity check 调用;
                          # findSimilar 添加 integrity check 调用
src/prompts/templates.ts  # BASE_MEMORY_PROMPT 移除 Search first 规则
src/tools/save.ts         # indexNote 失败提示改进

# 测试
tests/embedding.test.ts   # 新增 rebuildIndex 测试 (2 个)
tests/templates.test.ts   # 适配 Search first 移除 (3 个测试更新)
```

## 决策记录

- **读路径检查 > 写路径检查**: integrity check 放在 search/findSimilar 而非 save/indexNote，避免正常保存时序（先写盘后索引）导致误报
- **全量重建 > 增量修复**: 不一致一旦检测到，直接重建整个索引而非尝试增量补丁，简单可靠
- **进程级一次性 > 每次调用**: 用 Set 记录已检查的目录，避免重复检查的性能开销
- **不导出测试辅助函数**: 私有状态不通过 `_reset*` 暴露，测试通过公共 API 可观察行为验证
- **hook > 静态规则**: SESSION_START_REMINDER 已覆盖"新会话搜索"场景，静态 "Search first" 规则冗余且在 compaction 后误导 agent
