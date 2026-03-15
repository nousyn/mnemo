# 033 — 迁移至 @s_s/agent-kit 完成

## 概要

成功将 mnemo 的 agent 适配层代码迁移至 `@s_s/agent-kit` v1.1.0，净删除 **470 行**代码（663 删除，193 新增）。所有 187 个测试通过，`tsc` 编译通过。

## 改动汇总

| 文件                       | 操作           | 说明                                                                                                                                                                                                                          |
| -------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`             | 新增依赖       | `@s_s/agent-kit`                                                                                                                                                                                                              |
| `src/core/config.ts`       | re-export      | `AGENT_TYPES`, `CLIENT_NAME_MAP`, `AgentType` 改为从 agent-kit re-export，保留全部存储层代码                                                                                                                                  |
| `src/prompts/templates.ts` | 精简至 38 行   | 只保留 `buildMemoryPrompt()`，删除 AGENT_CONFIG/injectPrompt/hasPromptInjected/getAgentConfig/markers（~87 行）                                                                                                               |
| `src/hooks/reminders.ts`   | 重写尾部       | 删除 `HOOK_CONFIGS`/`HookScriptConfig`/`OPENCLAW_HOOK_MD`（~40 行），新增 `getHookSets()` 用 `defineHooks()` 包装各 agent hook 内容                                                                                           |
| `src/hooks/installer.ts`   | **整文件删除** | 158 行。`installHooks`/`hasHooksInstalled`/`mergeHookSettings` 全部由 agent-kit 的 `kit.installHooks()` 替代                                                                                                                  |
| `src/tools/setup.ts`       | 重写           | 105 行（原 205 行）。删除 `detectAgentTypeFromFiles`/`resolveProjectRoot`/`pathExists`/`detectGitRoot`/`findProjectRootFromMarkers`（~90 行），替换为 agent-kit 的 `detectAgent()`/`detectProjectRoot()`/`createKit('mnemo')` |
| `src/index.ts`             | 无变更         | import 路径不变（通过 config.ts re-export）                                                                                                                                                                                   |
| `tests/templates.test.ts`  | 重写           | 适配 `buildMemoryPrompt()` API，删除 `getPromptBlock`/`injectPrompt`/`hasPromptInjected`/`getAgentConfig` 测试                                                                                                                |
| `tests/hooks.test.ts`      | 重写           | 删除 `HOOK_CONFIGS`/`installer.ts` 测试，替换为 `getHookSets()` + `createKit().installHooks()` 集成测试                                                                                                                       |
| `tests/tools.test.ts`      | 微调 1 行      | setup 输出格式变更（不再包含文件路径）                                                                                                                                                                                        |

## 关键设计决策

1. **mnemo 的 `getDataDir()` 保留不替换** — mnemo 的数据目录存储笔记（`~/Library/Application Support/mnemo`），与 agent-kit 的通用工具数据目录用途不同
2. **OPENCLAW_HOOK_MD 不再由 mnemo 导出** — agent-kit 的 `installHooks()` 内部自动生成 HOOK.md（含 YAML frontmatter），mnemo 只提供 handler.ts 内容
3. **`getHookSets()` 函数封装** — 各 agent 的 hook 定义通过 `defineHooks()` 验证后返回 `HookSet[]`，传给 `kit.installHooks()`
4. **setup.ts 的 projectRoot 逻辑** — 显式参数优先于 `detectProjectRoot()` 自动检测

## 验证

```
npm test    → 187/187 passed (8 test files)
npm run build → tsc 编译通过
git diff --stat → 10 files changed, 193 insertions(+), 663 deletions(-)
```

## 后续

- 提交到 develop 分支
- 确认已部署的 `~/Desktop/plugins/mnemo-reminder.ts` 不受影响（运行时直接加载，不经过 installHooks）
