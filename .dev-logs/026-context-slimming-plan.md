# 026 上下文瘦身计划（方案C）

## 背景

通过 tiktoken 精确量化了 Mnemo 每轮固定的上下文开销：

| 组件                           |    Token |     占比 |
| ------------------------------ | -------: | -------: |
| AGENTS.md (BASE_MEMORY_PROMPT) |     1515 |    60.2% |
| Hook perTurn reminder          |       74 |     2.9% |
| 7 个 tool schema               |      929 |    36.9% |
| **总计**                       | **2518** | **100%** |

关键发现：

- AGENTS.md 占 60%，是最大优化目标
- AGENTS.md 与 tool schema description 存在大量重复内容
- 低频工具（compress/delete/apply/setup）占 schema 开销的 50%（444 token），但使用频率极低
- memory_setup 只在首次安装时用一次，之后每轮白占 146 token

## 方案选择

| 方案                                 | 每轮 token | 相比现在省 |
| ------------------------------------ | ---------: | ---------: |
| 当前                                 |       2518 |          — |
| A: 合并低频工具                      |      ~2400 |        ~5% |
| B: 仅精简 AGENTS.md                  |      ~1500 |       ~40% |
| **C: 精简 AGENTS.md + setup 改 CLI** |  **~1350** |   **~46%** |

合并工具方案（A）收益极低——减少工具数量会增加单个工具 description 的复杂度，净省 token 极少甚至可能反增。

**选定方案C。**

## 实施计划

### 任务 1：精简 BASE_MEMORY_PROMPT（目标 1515 → ~400-500 token）

文件：`src/prompts/templates.ts`

删除策略：

- 删除"触发短语"示例（"I prefer...", "let's go with..." 等）—— 模型不需要被教这些
- 删除 Quick Reference 表格 —— 和 tool description 重复
- 删除详细的 "When to search/save/compress" 段落 —— tool schema 已包含
- 删除 Memory Lifecycle 演化路径 —— 可移到 tool description 中
- 保留：type 分类列表、save 质量门槛（2/3 criteria）、核心规则（dedup、distill、不存临时信息）

### 任务 2：memory_setup 从 MCP tool 改为 CLI 命令

涉及文件：

- `src/tools/setup.ts` → 删除 MCP tool 注册
- `src/index.ts` → 移除 setup tool 注册调用
- 新增 CLI 入口（`src/cli.ts` 或在 `src/index.ts` 中添加 CLI 模式）
- `package.json` → bin 命令支持 `npx @s_s/mnemo setup`
- 用法：`npx @s_s/mnemo setup --agent opencode --scope global`

### 任务 3：更新测试

- 更新/移除 setup 相关的 MCP tool 测试
- 添加 CLI setup 的测试
- 确保所有现有测试通过

### 任务 4：验证

- 用 tiktoken 对比精简前后的 token 数
- 目标：每轮固定开销从 2518 降到 ~1350 token（降幅 46%）
- 运行完整测试套件

## 预期效果

- 每轮节省 ~1168 token（46%）
- tool 调用可靠性不受影响（schema 保持不变）
- setup 功能不丢失，只是从 tool 变为 CLI
