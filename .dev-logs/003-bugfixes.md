# 003 - Bug 修复与优化

**日期：** 2026-03-05

---

## 修复内容

### 1. memory_setup 返回文案优化

- 移除了多余的 "作用范围: 项目级别 (project)" 信息
- 用户不需要关心这个技术细节

### 2. Embedding 模型超时问题

**问题：** 首次调用 memory_search/memory_save 时，embedding 模型需要下载 ~33MB，导致 MCP 请求超时。

**修复方案：**

- 服务启动时立即在后台预加载 embedding 模型（`preloadEmbedding()`）
- 添加 `isEmbeddingReady()` 检查，模型未就绪时返回友好提示而非超时
- 使用 Promise 去重，避免并发重复加载

### 3. memory_save 部分失败处理

**问题：** 便签文件写入成功但向量索引失败时，整体报错，用户以为保存失败。

**修复方案：**

- 拆分为两步：先写文件（快速可靠），再索引（可能失败）
- 索引失败时仍返回成功，附带警告信息
- 移除了返回中的 source 字段（多余信息）

### 4. 数据目录遵循平台最佳实践

**之前：** `~/.mnemo/`

**之后：**

- macOS: `~/Library/Application Support/mnemo/`
- Linux: `$XDG_DATA_HOME/mnemo/` (默认 `~/.local/share/mnemo/`)
- Windows: `%APPDATA%/mnemo/`

仍可通过 `MNEMO_DATA_DIR` 环境变量覆盖。

### 5. 目录结构简化

**之前：** `{dataDir}/memory/notes/` 和 `{dataDir}/memory/index/`

**之后：** `{dataDir}/notes/` 和 `{dataDir}/index/`

去掉了多余的 `memory` 层级。

---

## 注意事项

- 旧数据（如果有）位于 `~/.mnemo/memory/`，不会自动迁移
- 新数据将写入平台规范路径
