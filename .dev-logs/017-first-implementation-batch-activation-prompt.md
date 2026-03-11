# 017 - 第一批实现：重写 Mnemo prompt 触发与长期上下文定位

## 背景

在完成以下设计阶段后：

- 通用层记忆模型 v2
- 开发领域层模型 v1
- 最小约束机制
- 触发机制 v1

Mnemo 终于进入第一批实际实现。

这批实现刻意不贪多，而是先做最直接、最能影响使用率的问题：

- 让 injected prompt 更明确地表达 Mnemo 的产品定位
- 让 `memory_search` / `memory_save` / `memory_compress` 的触发条件更具体
- 让 tool 描述和新的产品语义保持一致

## 这批实现的目标

本轮不涉及底层存储、去重、压缩算法，也不涉及新的 tool。

目标只有一个：

- 先让 Mnemo 从提示词层和工具描述层，真正变成“高价值长期上下文系统”

## 实际改动

### `src/prompts/templates.ts`

对 base prompt 做了第一轮重写，重点包括：

- 明确写入：
  - `Mnemo is not a full transcript archive`
  - `It is a system for preserving high-value long-term context`
- `memory_save` 触发条件从原来的泛化描述，改成更明确的事件触发：
  - 稳定偏好
  - 明确决策
  - 长期目标
  - continuity thread
  - 可复用规则
  - 已验证的高价值经验
- `memory_search` 增加：
  - 在 ongoing topic / long-running discussion 上重大工作前先搜索
- `memory_compress` 增加：
  - continuity thread 已经沉淀成 decision / rule / fact 时，适合做收敛
- `Guidelines` 增加：
  - 推荐顺序：`memory_search -> do the work -> memory_save -> memory_compress`
  - 不应保存 routine task state、ordinary command output、one-off debugging noise

这一步的本质，是把 Mnemo 从“泛泛的记忆工具”推进成“有明确保存边界和触发顺序的长期上下文系统”。

### `src/tools/save.ts`

更新 `memory_save` 的描述：

- 从“保存重要信息”收敛为“保存高价值长期上下文”
- 明确提到：
  - stable preferences
  - important decisions
  - long-term goals
  - reusable rules
  - continuity

同时更新 `content` 字段说明，让输入更强调“未来仍然会重要的 durable essence”。

### `src/tools/search.ts`

更新 `memory_search` 的描述：

- 从“语义搜索 persistent memories”收敛为“搜索 persistent high-value long-term context”
- 更明确它的作用是：
  - 在继续工作前恢复相关背景

### `src/tools/compress.ts`

更新 `memory_compress` 的描述：

- 不再只是“压缩已有 notes”
- 而是强调其作用是：
  - 让知识库保持聚焦在 durable high-value context，而不是碎片化历史

## 测试更新

### `tests/templates.test.ts`

新增断言，确保 prompt 中包含：

- `high-value long-term context`
- 新的默认顺序：`memory_search -> do the work -> memory_save -> memory_compress`
- 保存边界：不保存 routine task state
- 更具体的触发词：`stable preference`、`continuity thread`

### `tests/tools.test.ts`

新增工具描述断言，确保：

- `memory_save` 描述包含 `high-value long-term context`
- `memory_search` 描述包含 `long-term context`
- `memory_compress` 描述包含 `durable high-value context`

## 验证

执行测试：

```bash
npm test -- tests/templates.test.ts tests/tools.test.ts
```

结果：

- 2 个测试文件通过
- 49 个测试通过

## 结果

这一批实现虽然不大，但它完成了一个很关键的转向：

- Mnemo 的产品定位不再只存在于讨论中
- 而是已经进入 prompt 与 tool description
- 后续 agent 是否更稳定触发 Mnemo，将开始建立在更清晰的语义基础上

这可以视为 Mnemo 新阶段的第一批真正实现，而不是继续停留在抽象规划层。
