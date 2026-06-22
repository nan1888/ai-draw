<div align="center">

# ai-draw

### Codex 里的 AI 无限画布：自然语言生成图片，在画布上标注，再自动生成新版

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Codex Plugin](https://img.shields.io/badge/Codex-Plugin-111827)](#快速安装)
[![MCP](https://img.shields.io/badge/MCP-Tools-2563eb)](./ai-draw/.mcp.json)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933)](./ai-draw/package.json)
[![pnpm](https://img.shields.io/badge/pnpm-10.13.1-f69220)](./ai-draw/package.json)
[![中文](https://img.shields.io/badge/lang-中文-dc2626)](./README.md)
[![English](https://img.shields.io/badge/lang-English-0284c7)](./README.en.md)

**中文** · [English](./README.en.md)

[快速安装](#快速安装) · [界面展示](#界面展示) · [使用流程](#使用流程) · [适合谁用](#适合谁用) · [项目文档](#项目文档) · [隐私说明](#隐私说明)

</div>

---

## 这是什么？

ai-draw 是一个 Codex 插件 marketplace。它让 Codex 可以打开本地无限画布，生成图片，读取你在画布上的箭头、文字、圈选标注，并把修改后的新版本自动放到旧图右侧。

你可以把它理解成：

```text
Codex 里的 AI 画图白板。
```

普通用户不需要理解 MCP、holder、run metadata 或本地文件路径。你只需要说需求、打开画布、标注修改意见、点击按钮。

## 界面展示

<div align="center">
  <img src="./assets/ai-canvas-interface-preview.png" alt="ai-draw 操作界面展示：Codex 对话与本地画布联动" width="100%">
</div>

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 自然语言生成图片 | 让 Codex 直接生成广告图、封面、海报、产品图或视觉概念图。 |
| 本地无限画布 | 打开基于 tldraw 的本地画布，适合持续标注和对比版本。 |
| 标注驱动修图 | 箭头、文字、圆圈、矩形会被理解成修图意见。 |
| 保留历史版本 | 新版图片放在右侧，旧图保留，方便对比。 |
| Codex 插件工作流 | 内置 MCP 工具和 Codex skills，用户用自然语言即可操作。 |

## 快速安装

### 安装到 Codex app

1. 确认本机已经安装 Codex app，并且终端里可以运行 `codex` 命令。
2. 在终端执行下面两行，把 ai-draw 的 marketplace 加到 Codex app，并安装插件：

```bash
codex plugin marketplace add https://github.com/nan1888/ai-draw --ref main
codex plugin add ai-draw@ai-draw
```

3. 重启 Codex app，或在 Codex app 里新开一个对话。
4. 在新对话里输入下面这句验证插件是否加载成功：

```text
@ai-draw 打开 AI 画布，帮我做一张拉面广告。
```

如果 Codex 能返回本地画布链接，说明安装成功。命令里的 `ai-draw@ai-draw` 是当前插件安装标识；用户看到的项目名是 `ai-draw`。

### 开发者本地安装

如果你是从源码本地开发或修改插件，使用这一套：

```bash
git clone https://github.com/nan1888/ai-draw.git
cd ai-draw/ai-draw
npm run setup
cd ..
codex plugin marketplace add .
codex plugin add ai-draw@ai-draw
```

完整安装、更新和排错说明：

- [安装指南 INSTALL.md](./ai-draw/INSTALL.md)

## 使用流程

```mermaid
flowchart LR
  A["告诉 Codex<br/>生成一张广告图"] --> B["ai-draw 打开<br/>本地画布"]
  B --> C["Codex 创建图片框<br/>并生成图片"]
  C --> D["图片插入画布"]
  D --> E["用户画标注<br/>箭头 + 文字 + 圈选"]
  E --> F["点击<br/>按标注修图"]
  F --> G["Codex 读取标注<br/>并编辑图片"]
  G --> H["新版放到右侧<br/>旧图保留"]
  H --> E
```

一分钟日常使用：

1. 在 Codex 里说你想要什么图。
2. 打开 Codex 返回的本地画布链接。
3. 在图片上画箭头、写文字、圈出区域。
4. 第一次改图前说：`@ai-draw 开启自动修图模式`。
5. 每批标注完成后，在画布上点 `按标注修图`。
6. 在画布上对比旧版和新版，继续迭代。

## 常用提示词

```text
@ai-draw 打开 AI 画布，帮我做一张小红书封面。

@ai-draw 生成一张竖版拉面广告，品牌叫拉面一番，要高级食物摄影风格。

@ai-draw 开启自动修图模式。

@ai-draw 按我画布上的标注修改。
```

## 适合谁用

| 场景 | ai-draw 能帮你做什么 |
| --- | --- |
| 社媒封面 | 小红书封面、短视频封面、活动海报 |
| 广告物料 | 食物广告、产品广告、活动 banner、主视觉 |
| 产品概念 | 情绪板、包装方向、视觉草案、hero 图 |
| 反复修图 | 标一个区域，生成一版，保留旧图继续对比 |
| 视觉评审 | 把画布当成 Codex 里的视觉讨论工作台 |

## 项目文档

- [插件说明 README](./ai-draw/README.md)
- [安装指南 / Installation Guide](./ai-draw/INSTALL.md)
- [中文小白使用说明](./ai-draw/使用说明.md)
- [自然语言工作流](./ai-draw/自然语言工作流.md)
- [English README](./README.en.md)

## 仓库结构

```text
.agents/plugins/marketplace.json
ai-draw/
  .codex-plugin/plugin.json
  .mcp.json
  skills/
  packages/
    canvas-app/
    mcp-server/
    shared/
```

Codex 会读取仓库根目录的 `.agents/plugins/marketplace.json`，这个 marketplace 指向 `./ai-draw`。

## 隐私说明

- 画布服务运行在本机 `127.0.0.1`，默认端口 `43218`。
- 画布状态和生成资源默认保存在当前工作区的 `.ai-draw/`，除非设置了 `AI_DRAW_HOME`。
- 本地运行数据、临时 QA 数据、依赖目录、日志和环境变量文件都被 Git 忽略。
- 插件不包含托管后端，它是一个本地 Codex 插件工作流。

## 开发

```bash
cd ai-draw
npm run setup
npm run typecheck
npm run test
npm run validate:plugin
```

手动预览画布服务：

```bash
NODE_ENV=production node packages/canvas-app/dist/server/server.js \
  --port 43218 \
  --workspace-root "<your workspace>"
```

打开：

```text
http://127.0.0.1:43218/
```

## 许可证

MIT. See [LICENSE](./LICENSE).
