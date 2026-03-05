# 005 - 新增 memory_compress_apply 工具

**日期：** 2026-03-05

---

## 背景

原有的压缩流程存在原子性问题：`memory_compress` 返回所有笔记后，LLM 需要依次调用 `memory_save` 保存蒸馏笔记、再调用 `memory_delete` 删除旧笔记。这个两步流程有风险——LLM 可能忘记执行删除步骤，导致旧笔记残留。

## 解决方案

新增 `memory_compress_apply` 工具，将"保存新笔记 + 删除旧笔记"合并为一个原子操作。

### 工具设计

**输入参数：**

- `notes`: 蒸馏后的笔记数组，每条包含 `content`（内容）和可选的 `tags`（标签）
- `old_ids`: 需要删除的原始笔记 ID 数组（来自 `memory_compress` 的输出）
- `source`: 可选的来源标识

**执行流程：**

1. 保存所有新笔记到磁盘
2. 为新笔记建立向量索引（索引失败不阻塞，降级为警告）
3. 从向量索引中移除旧笔记
4. 从磁盘删除旧笔记

**返回信息：** 包含新笔记数量/ID、删除数量，以及可能的索引警告。

## 代码变更

### `src/tools/compress.ts`

- 在 `registerCompressTool` 函数内新增第三个工具注册 `memory_compress_apply`
- `memory_compress` 的 review 策略返回文本已更新，引导 LLM 使用 `memory_compress_apply` 而非手动 save+delete

### `src/prompts/templates.ts`

- 更新 MEMORY_PROMPT 中的压缩工作流说明，描述新的三步流程：compress → 蒸馏 → compress_apply

### `tests/tools.test.ts`

- 工具列表断言从 5 个更新为 6 个（新增 `memory_compress_apply`）
- compress review 策略的断言更新为检查 `memory_compress_apply` 引导文本
- 新增 `memory_compress_apply` 测试组（3 个测试）：
  - 原子性保存+删除正常流程
  - 旧 ID 不存在时的容错处理
  - 多条蒸馏笔记保存

## 测试结果

全部 55 个测试通过（原 52 个 + 新增 3 个）：

- `tests/templates.test.ts` — 11 tests
- `tests/config.test.ts` — 4 tests
- `tests/notes.test.ts` — 17 tests
- `tests/embedding.test.ts` — 8 tests
- `tests/tools.test.ts` — 15 tests（原 12 + 新增 3）

## 构建验证

`npm run build`（tsc）编译通过，无错误。
