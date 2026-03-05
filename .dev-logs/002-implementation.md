# 002 - 项目初始化与核心实现

**日期：** 2026-03-05

---

## 完成内容

### 项目结构

```
mnemo/
  src/
    index.ts              # MCP 服务入口，注册所有工具
    core/
      config.ts           # 配置常量、类型定义、路径管理
      notes.ts            # 便签文件读写（Markdown + frontmatter）
      embedding.ts        # 向量化与语义检索（vectra + transformers.js）
    tools/
      setup.ts            # memory_setup: 初始化，写入提示词
      save.ts             # memory_save: 保存记忆便签
      search.ts           # memory_search: 语义检索
      compress.ts         # memory_compress + memory_delete: 蒸馏压缩
    prompts/
      templates.ts        # 提示词模板与注入逻辑
  .dev-logs/
    001-design-decisions.md
    002-implementation.md
```

### 技术选型

| 组件           | 选择                      | 版本          |
| -------------- | ------------------------- | ------------- |
| MCP SDK        | @modelcontextprotocol/sdk | latest (v1.x) |
| Schema 校验    | zod                       | ^3.25         |
| 向量存储       | vectra (LocalIndex)       | 0.12.3        |
| 本地 embedding | @huggingface/transformers | latest        |
| Embedding 模型 | Xenova/all-MiniLM-L6-v2   | 384 维，~33MB |

### 实现的 MCP 工具

| 工具            | 功能                                                        |
| --------------- | ----------------------------------------------------------- |
| memory_setup    | 自动检测或手动指定 agent 类型，将记忆管理提示词注入配置文件 |
| memory_save     | 保存记忆便签到 Markdown 文件 + 向量索引，超阈值时提示压缩   |
| memory_search   | 语义相似度检索，支持 top_k 和 source 过滤                   |
| memory_compress | 返回所有便签供 LLM 蒸馏，或统计标签分布                     |
| memory_delete   | 删除指定便签（压缩后清理用）                                |

### 关键实现细节

- **提示词注入**：使用 `<!-- mnemo:start -->` / `<!-- mnemo:end -->` 标记包裹，支持重复执行时原地更新
- **Agent 类型检测**：优先使用用户指定的枚举值，其次自动检测配置文件存在性
- **压缩兜底**：memory_save 每次执行时检查便签总数和总大小，超阈值在返回中提示压缩
- **Embedding 懒加载**：首次调用时才加载模型，避免启动开销
- **向量索引**：source 字段设为 indexed，支持按来源过滤

### 数据存储

默认路径：`~/.mnemo/memory/`

- `notes/` - Markdown 便签文件
- `index/` - vectra 向量索引

可通过 `MNEMO_DATA_DIR` 环境变量自定义。
