# 022 Hook 机制实现

## 概述

基于 021 的设计文档，完成了 hook 机制的完整实现。Hook 机制为四种 agent（Claude Code、Codex、OpenClaw、OpenCode）提供生命周期级别的记忆提醒注入，解决 agent 不主动调用 mnemo 工具的核心问题。

## 实现内容

### 新增文件

**`src/hooks/reminders.ts`（220 行）**

- `REMINDERS` 对象：四种提醒文本（perTurn / sessionStart / compaction / sessionEnd），每条控制在 ~50 token
- `ACTIVATOR_SCRIPT`：Claude Code / Codex 的 bash 脚本模板，通过 `UserPromptSubmit` hook 每轮输出 perTurn 提醒
- `OPENCLAW_HOOK_MD` + `OPENCLAW_HANDLER_TS`：OpenClaw 的 HOOK.md manifest 和 handler.ts，通过 `agent:bootstrap` 注入虚拟文件
- `OPENCODE_PLUGIN_TS`：OpenCode 的插件模板，订阅 `session.created` / `session.idle` / `experimental.session.compacting` 事件
- `HOOK_CONFIGS`：Agent → hook 配置的映射表，定义每个 agent 的 hookDir、files、settingsPath

**`src/hooks/installer.ts`（149 行）**

- `installHooks(agentType)`：主安装函数，生成 hook 文件到目标目录，shell 脚本自动 chmod 755
- `mergeHookSettings(settingsPath, activatorPath)`：Claude Code / Codex 的 settings.json 合并逻辑，读取已有配置 → 去重旧 mnemo 条目 → 添加新条目 → 写回
- `hasHooksInstalled(agentType)`：检查 hook 是否已安装

### 修改文件

**`src/tools/setup.ts`**

- `memory_setup` 流程新增 Step 2：调用 `installHooks()` 独立于 prompt 注入
- 输出报告包含 hook 安装结果（成功时显示路径和 notes，失败时显示错误但不影响 prompt 注入）

**`tests/tools.test.ts`**

- 3 个断言更新，适配 memory_setup 新的输出格式

### 新增测试

**`tests/hooks.test.ts`（36 个测试）**

三个测试组：

1. **reminders.ts 模板验证**（14 tests）
   - 四种 reminder 文本完整性和标签格式
   - ACTIVATOR_SCRIPT bash 脚本合法性
   - OpenClaw 模板的 frontmatter、事件处理、子 agent 跳过、虚拟文件注入
   - OpenCode 插件的事件订阅和 noReply 注入
   - HOOK_CONFIGS 映射完整性

2. **installer.ts 安装逻辑**（20 tests）
   - 四种 agent 的文件生成验证
   - shell 脚本可执行权限
   - settings.json 合并、保留已有配置、重复安装去重
   - OpenClaw 的手动激活提示 notes
   - `hasHooksInstalled()` 安装前后状态检测

3. **setup.ts hook 集成**（2 tests）
   - memory_setup 输出包含 Hooks 和 Prompt 状态

## 测试结果

```
6 个测试文件，154 个测试全部通过（原 118 + 新增 36）
```

## 设计决策回顾

- **模板作为字符串常量**：hook 脚本内容直接嵌入在 `reminders.ts` 中，不从外部文件读取，简化分发
- **mergeHookSettings 的去重策略**：通过检查 command 路径是否包含 'mnemo' 来识别旧条目，重复安装不会累加
- **OpenClaw 的手动激活**：安装后需用户手动运行 `openclaw hooks enable mnemo`，通过 notes 字段提示
- **测试隔离**：所有安装测试使用 tmpDir + mock `os.homedir()`，不影响真实环境
