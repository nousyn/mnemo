# 018 - 第二批实现：type 字段引入

## 背景

第二批实现的核心任务：将最小约束机制中的 8 种记忆类型（preference、profile、goal、continuity、fact、decision、rule、experience）映射到代码中，通过 `type` 字段实现。

设计原则：软引导而非硬约束 — type 是可选字段，未指定时给出温和提示，不会阻断保存操作。

## 修改的源文件（8 个）

### 核心层

1. **`src/core/config.ts`** — 新增 `MEMORY_TYPES` 常量数组、`MemoryType` 类型、`NoteMeta` 接口新增 `type?: MemoryType`
2. **`src/core/notes.ts`** — `parseNote` 解析 type（验证合法性，无效值静默忽略）、`serializeNote` 条件输出 type 行、`saveNote` 接受可选 type 参数
3. **`src/core/embedding.ts`** — `indexNote` metadata 包含 type、`SearchResult` 接口新增 type 字段、所有结果映射（向量/关键词/合并）均包含 type

### 工具层

4. **`src/tools/save.ts`** — 新增 `type` 参数（z.enum 可选）、传递给 saveNote、输出显示 Type、未指定 type 时返回 soft hint
5. **`src/tools/search.ts`** — 新增 `type_filter` 参数、后置过滤逻辑、fetchK 补偿机制、搜索结果展示 Type
6. **`src/tools/get.ts`** — 获取结果展示 Type（有值时）
7. **`src/tools/compress.ts`** — review 输出展示 `[Type: xxx]`、`memory_compress_apply` notes schema 支持可选 type、传递给 saveNote

### 提示词层

8. **`src/prompts/templates.ts`** — save 触发条件标注建议类型（如 `→ type: decision`）、Guidelines 新增"Classify each memory with a type before saving"

## 测试覆盖（5 个测试文件，108 个测试全部通过）

### notes.test.ts（+7 个新测试）

- parseNote 解析 type / 无 type 向后兼容 / 无效 type 忽略
- serializeNote 带 type / 无 type 不输出 type 行
- saveNote 带 type 保存 + 磁盘读回验证 / 不传 type 时 undefined
- 带 type 的往返测试（serialize → parse）

### config.test.ts（+3 个新测试）

- MEMORY_TYPES 导出 8 种类型
- 包含所有预期类型名
- 是数组类型（as const 编译时约束，运行时为普通数组）

### tools.test.ts（+7 个新测试）

- save 指定 type 应保存并显示 / 未指定 type 应返回 soft hint
- search type_filter 按类型过滤 / 搜索结果显示 Type 字段
- get 有 type 的笔记显示 Type
- compress review 输出包含 [Type: xxx]
- compress_apply 蒸馏笔记支持 type 字段

### templates.test.ts（+2 个新测试）

- save 触发条件标注建议 type（preference/decision/goal/continuity/rule/experience）
- Guidelines 包含分类指引

### embedding.test.ts（+2 个新测试）

- 搜索结果包含 type 字段（有 type 时为对应值）
- 无 type 的笔记搜索结果 type 为空字符串

## 设计决策记录

1. **type 不做硬校验** — 未指定 type 时只给 soft hint，不拒绝保存。原因：硬约束会降低激活率，LLM 可能因不确定分类而跳过 memory_save
2. **type 独立于 tags** — type 是结构化的枚举字段，tags 是自由文本标签，两者正交
3. **无效 type 静默忽略** — parseNote 遇到不在 MEMORY_TYPES 中的值时，type 设为 undefined 而非报错。保证旧数据/手动编辑的兼容性
4. **向量索引中 type 存为空字符串而非 undefined** — vectra metadata 不支持 undefined 值，空字符串是最安全的缺省值
5. **type_filter 使用后置过滤** — 和 tag_filter 一致，先取 fetchK = topK \* 3 的结果再过滤，避免遗漏
6. **不做自动演化逻辑** — 记忆类型的演化（continuity→decision 等）由 LLM 在 compress 时驱动，代码不做自动推理

## 测试结果

```
Test Files  5 passed (5)
     Tests  108 passed (108)
  Duration  676ms
```

从 v1.2.0 的 55 个测试增长到 108 个测试。
