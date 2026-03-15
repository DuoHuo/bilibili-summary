# Memflow Architecture

## 总览

Memflow 是基于 Plasmo 的 Chrome MV3 浏览器扩展，用于将 AI 平台对话导出到 Obsidian 的 Markdown 文件。整体架构分为内容脚本、数据处理、Obsidian 集成与弹窗 UI 四层，配置与类型定义贯穿其间。

## 核心流程

1. 内容脚本检测平台并注入导出按钮
2. 适配器抽取页面对话数据
3. 处理层生成 Markdown 与元数据
4. 通过 Obsidian URI 协议写入目标库
5. 弹窗 UI 提供配置与状态反馈

## 模块分层

### 1. Content Scripts（`src/contents/`）

- `index.tsx`：入口，负责按钮注入、平台检测与流程编排
- `adapters/`：平台适配器集合
  - `base-adapter.ts`：抽象基类与公共逻辑
  - `chatgpt.ts` / `deepseek.ts` / `kimi.ts`：具体平台实现
  - `index.ts`：适配器注册与选择

### 2. Processing（`src/processing/`）

- `markdown-builder.ts`：对话转 Markdown 结构
- `metadata-generator.ts`：标题、时间等元数据
- `local-algorithms.ts`：本地文本处理算法

### 3. Obsidian Integration（`src/obsidian/`）

- `uri-handler.ts`：将 Markdown 通过 Obsidian URI 发送

### 4. Popup UI（`src/popup.tsx`）

- 配置 Obsidian 参数、显示导出结果
- 使用内联样式与深色主题

### 5. 配置与类型

- `src/config/selectors.json`：平台 DOM 选择器
- `src/config/prompts.json`：提示模板
- `src/types/`：类型定义

## 关键设计点

- **适配器模式**：每个平台隔离实现，便于扩展
- **集中选择器配置**：避免硬编码 DOM 结构
- **严格错误处理**：异步逻辑统一 try/catch，并输出中文提示
- **UI 内联样式**：保持 Plasmo 约定与统一视觉

## 扩展指南

新增平台需要：
1. 添加选择器到 `selectors.json`
2. 新增适配器实现并注册
3. 更新内容脚本 URL 匹配与权限
