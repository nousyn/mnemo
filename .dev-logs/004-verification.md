# 004 - 全流程验证

**日期：** 2026-03-05

---

## 概要

通过 stdio 集成测试，对全部 5 个 MCP 工具进行端到端验证。

## 测试前修复

- **`.DS_Store` 误入 git**：用 `git rm --cached .DS_Store` 移除暂存，并加入 `.gitignore`。

## 协议发现

当前版本的 MCP SDK 的 stdio 传输使用**换行分隔 JSON**（newline-delimited JSON），而非 Content-Length 分帧。每条消息格式为 `JSON.stringify(msg) + '\n'`。

最初的测试脚本使用了 Content-Length 头，导致服务端静默忽略所有消息。在 `@modelcontextprotocol/sdk/dist/esm/shared/stdio.js` 中的 `ReadBuffer` 类确认了这一点——它按 `\n` 分割后逐行解析 JSON。

## 测试结果

全部 5 个工具测试通过：

| 工具              | 状态 | 备注                                                                                                                                              |
| ----------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory_setup`    | OK   | 已注册，schema 验证通过。测试中未实际调用（会写入 cwd 的 AGENTS.md）。                                                                            |
| `memory_save`     | OK   | 成功保存 2 条笔记，包含 tags 和 source。ID 正确返回。                                                                                             |
| `memory_search`   | OK   | 语义搜索返回两条笔记并按相关性排序。查询 "code style preferences" 正确将 user-preference 笔记排在第一（36.7%），architecture 笔记排第二（6.6%）。 |
| `memory_compress` | OK   | review 模式返回所有笔记及待删除 ID 列表，格式正确，可供 LLM 蒸馏。                                                                                |
| `memory_delete`   | OK   | 成功删除 2/2 条笔记，磁盘文件和向量索引均已清理。                                                                                                 |

## 观察记录

1. **Embedding 模型加载时间**：首次运行约 15 秒（模型下载后会缓存）。preload 机制工作正常——模型在第一次 `memory_save` 调用前已就绪。
2. **向量索引创建**：在首次 `indexNote()` 调用时自动创建，日志输出 "Mnemo: vector index created" 确认。
3. **语义相关性分数**：绝对值偏低（最佳匹配 36.7%），这是 MiniLM-L6 对短文本的典型表现。重要的是相对排序正确。
4. **协议版本**：服务端正确协商 `2025-11-25`。
5. **服务端信息**：正确上报 `mnemo v0.1.0`。

## 测试环境

- 使用 `MNEMO_DATA_DIR=/tmp/mnemo-test-3` 隔离测试数据
- 测试后已清理所有临时目录
- `~/.mnemo/`（旧路径）和 `~/Library/Application Support/mnemo/`（当前路径）均无残留数据
