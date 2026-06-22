<div align="center">

# ai-draw Codex Plugin

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)
[![Codex Plugin](https://img.shields.io/badge/Codex-Plugin-111827)](./.codex-plugin/plugin.json)
[![MCP](https://img.shields.io/badge/MCP-Tools-2563eb)](./.mcp.json)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933)](./package.json)
[![lang](https://img.shields.io/badge/lang-中文-dc2626)](./使用说明.md)
[![lang](https://img.shields.io/badge/lang-English-0284c7)](./README.md)

[Install](./INSTALL.md) · [User Guide](./使用说明.md) · [Workflow](./自然语言工作流.md)

</div>

ai-draw is a Codex plugin that gives Codex a local infinite canvas for image generation, visual annotation, and iterative image editing.

ai-draw 是一个 Codex 插件，让 Codex 可以打开本地无限画布，生成图片，读取画布上的箭头/文字/圈选标注，并把修改后的新版本自动放到旧图右侧。

## Languages / 语言

- English: read this README and [INSTALL.md](./INSTALL.md).
- 中文：阅读本文中的中文部分，以及 [使用说明.md](./使用说明.md)、[自然语言工作流.md](./自然语言工作流.md)、[INSTALL.md](./INSTALL.md)。

## What It Does / 它能做什么

English:

- Opens a local tldraw-based canvas from Codex.
- Creates an image holder for a natural-language prompt.
- Helps Codex generate an image and insert it into the canvas.
- Reads arrows, text notes, circles, and rectangles as edit instructions.
- Creates revised image versions to the right of the original image.
- Supports a button-driven auto edit loop: annotate on the canvas, click `按标注修图`, and let Codex process the queued request.

中文：

- 从 Codex 打开一个本地 tldraw 无限画布。
- 根据自然语言需求创建图片框。
- 协助 Codex 生成图片，并插入画布。
- 读取箭头、文字、圆圈、矩形等标注作为修图指令。
- 把新版图片放到旧图右侧，保留历史版本。
- 支持按钮式自动修图：在画布标注后点击 `按标注修图`，Codex 会接收队列任务并继续处理。

## Quick Start / 快速开始

Prerequisites / 前置要求：

- Codex with plugin support / 支持插件的 Codex。
- Codex app installed, with the `codex` command available in your terminal / 已安装 Codex app，并且终端里可以运行 `codex` 命令。
- Node.js 20 or newer / Node.js 20 或更新版本。
- Git and network access for dependency installation / Git，以及安装依赖所需的网络访问。

Install directly into Codex app / 直接安装到 Codex app：

```bash
codex plugin marketplace add https://github.com/nan1888/ai-draw --ref main
codex plugin add ai-draw@ai-draw
```

Then restart Codex app or open a new chat, and try / 然后重启 Codex app 或新开一个对话，输入：

```text
@ai-draw 打开 AI 画布，帮我做一张拉面广告。
```

If Codex returns a local canvas link, the plugin is installed correctly. The command still uses `ai-draw@ai-draw` because that is the current plugin install identifier; the user-facing project name is `ai-draw`.

如果 Codex 返回本地画布链接，就说明安装成功。命令里的 `ai-draw@ai-draw` 是当前插件安装标识；用户看到的项目名是 `ai-draw`。

Clone and build / 克隆并构建：

```bash
git clone https://github.com/nan1888/ai-draw.git
cd ai-draw/ai-draw
npm run setup
```

Install into Codex from the repository root / 从仓库根目录安装到 Codex：

```bash
cd ..
codex plugin marketplace add .
codex plugin add ai-draw@ai-draw
```

Restart Codex or open a new chat, then try / 重启 Codex 或新建对话，然后输入：

```text
@ai-draw 打开 AI 画布，帮我做一张拉面广告。
```

For the full installation guide, including Git marketplace installs, updates, verification, and troubleshooting, see [INSTALL.md](./INSTALL.md).

完整安装说明，包括 Git marketplace 安装、更新、验证和排错，请看 [INSTALL.md](./INSTALL.md)。

## Daily Workflow / 日常使用流程

English:

1. Ask Codex to open ai-draw and generate an image.
2. Open the returned local canvas URL in the Codex side panel.
3. Annotate the image with arrows, text, circles, or rectangles.
4. Say `@ai-draw 开启自动修图模式` once.
5. Click `按标注修图` on the canvas after each batch of annotations.
6. Codex creates a new version on the right and keeps the original image.

中文：

1. 在 Codex 里要求 ai-draw 打开画布并生成图片。
2. 点击 Codex 返回的本地画布链接，在侧边栏打开。
3. 在图片上画箭头、写文字、圈出区域。
4. 第一次改图前说：`@ai-draw 开启自动修图模式`。
5. 每批标注完成后，在画布上点击 `按标注修图`。
6. Codex 会把新版放到右侧，并保留旧图。

Useful prompts / 常用提示词：

```text
@ai-draw 打开 AI 画布，帮我做一张小红书封面。
@ai-draw 生成一张竖版拉面广告，品牌叫拉面一番，要高级食物摄影风格。
@ai-draw 开启自动修图模式。
@ai-draw 按我画布上的标注修改。
```

## External Async Image API / 外部异步图片 API

ai-draw can call your NewAPI-style async image gateway directly. When configured, Codex no
longer needs to generate or edit images itself; the MCP server submits image tasks, polls for the
result, downloads the returned image, and inserts it into the canvas.

ai-draw 可以直接调用你们的 NewAPI 风格异步图片中转站。配置后，MCP server 会提交任务、轮询结果、下载图片，并自动插入画布。

Recommended setup / 推荐配置方式：

1. Open ai-draw from Codex.
2. In the right sidebar, open `更多操作`.
3. Fill `图片接口设置`: Base URL, API Key, model, size, quality, and output format.
4. Click `保存图片接口`.

The API key is saved locally in `.ai-draw/config.json` under the active workspace or `AI_DRAW_HOME`. The canvas settings UI never reads the saved API key back into the browser; it only shows whether a key has been saved.

推荐做法是在画布右侧 `更多操作` 里的 `图片接口设置` 填写接口地址、Key、模型和尺寸，然后点击 `保存图片接口`。API Key 会保存在当前工作区的 `.ai-draw/config.json`，或 `AI_DRAW_HOME` 指向的位置。画布界面不会回显已保存的 Key，只显示是否已保存。

Recommended third-party gateway / 推荐第三方网关：

- Base URL: `https://happyhorse.pics/v1`
- Models / 模型：`gpt-image-2`、`banana2`、`gemini-3.0-pro-image`
- Sizes / 尺寸：`1k`、`2k`、`4k`

If you need a third-party image API, you can use [happyhorse.pics](https://happyhorse.pics/) and paste its API key into `图片接口设置`. The canvas UI includes a `填入推荐` button that fills the recommended Base URL, model, and size.

如果需要填写第三方生图 API，可以使用 [happyhorse.pics](https://happyhorse.pics/)，把它提供的 API Key 填入 `图片接口设置`。画布里有 `填入推荐` 按钮，会自动填入推荐的 Base URL、模型和尺寸。

Environment variable fallback / 环境变量兜底：

```bash
export NEWAPI_BASE_URL="https://happyhorse.pics/v1"
export NEWAPI_API_KEY="REPLACE_WITH_YOUR_NEWAPI_KEY"
```

Optional environment variables / 可选环境变量：

```bash
export AI_CANVAS_IMAGE_MODEL="gpt-image-2"
export AI_CANVAS_IMAGE_SIZE="1k"
export AI_CANVAS_IMAGE_QUALITY="auto"
export AI_CANVAS_IMAGE_OUTPUT_FORMAT="png"
export AI_CANVAS_IMAGE_TIMEOUT_MS="420000"
export AI_CANVAS_IMAGE_POLL_INTERVAL_MS="5000"
```

Supported async endpoints / 已接入接口：

- `POST /v1/images/async/generations`
- `POST /v1/images/async/edits`
- `GET /v1/images/async/{task_id}`

New MCP workflow tools / 新增 MCP 工作流工具：

- `generate_image_into_holder`: generate an image through NewAPI and insert it into the current holder.
- `edit_image_from_annotations`: read canvas annotations, edit through NewAPI, and place a new version.
- `process_next_edit_request`: process the next `按标注修图` queue item through NewAPI.

If `NEWAPI_BASE_URL` and `NEWAPI_API_KEY` are not set, the older prompt-first Codex workflow still remains available through `prepare_image_generation` and `prepare_annotation_edit`.

## Installation Models / 安装方式

This repository supports two practical installation models.

本仓库支持两种实际安装方式。

### 1. Local Clone, Build, Then Install / 本地克隆、构建后安装

This is the safest path for users who download the repository themselves.

这是最稳妥的方式，适合用户自己下载仓库后安装。

```bash
git clone https://github.com/nan1888/ai-draw.git
cd ai-draw/ai-draw
npm run setup
cd ..
codex plugin marketplace add .
codex plugin add ai-draw@ai-draw
```

### 2. Git Marketplace Install / Git marketplace 安装

This is convenient for public distribution after the release branch includes built runtime files under `ai-draw/packages/*/dist`.

如果发布分支已经包含 `ai-draw/packages/*/dist` 运行时构建产物，可以使用这种方式直接从 Git marketplace 安装。

```bash
codex plugin marketplace add https://github.com/nan1888/ai-draw --ref main
codex plugin add ai-draw@ai-draw
```

If the plugin fails to start after a Git marketplace install, clone the repository, run `npm run setup` inside `ai-draw/`, then install from the repository root.

如果 Git marketplace 安装后插件启动失败，请改用本地克隆方式：克隆仓库，在 `ai-draw/` 里运行 `npm run setup`，再从仓库根目录安装。

## Development / 开发

Install and build / 安装并构建：

```bash
npm run setup
```

Run checks / 运行检查：

```bash
npm run typecheck
npm run test
npm run validate:plugin
```

Preview the canvas service / 预览画布服务：

```bash
NODE_ENV=production node packages/canvas-app/dist/server/server.js \
  --port 43218 \
  --workspace-root "<your workspace>"
```

Open / 打开：

```text
http://127.0.0.1:43218/
```

## Project Structure / 项目结构

```text
.codex-plugin/plugin.json       Codex plugin manifest
.agents/plugins/marketplace.json Git/Codex marketplace entry at the repository root
.mcp.json                       MCP server configuration
skills/                         Codex natural-language workflow skills
packages/shared/                Shared schemas, types, and annotation parsing
packages/canvas-app/            React + Vite + tldraw canvas service
packages/mcp-server/            MCP tools used by Codex
scripts/setup.mjs               Dependency install and build helper
scripts/validate-plugin.mjs     Lightweight release validation
```

## Local Data And Privacy / 本地数据与隐私

English:

- The canvas service runs locally on `127.0.0.1`, default port `43218`.
- ai-draw data is stored in `.ai-draw/` under the active workspace unless `AI_DRAW_HOME` is set.
- Generated and edited images are copied into the local canvas asset directory.
- `.ai-draw/`, `tmp/`, `node_modules/`, and TypeScript build info files are ignored by Git.

中文：

- 画布服务运行在本机 `127.0.0.1`，默认端口是 `43218`。
- 画布数据默认保存在当前工作区的 `.ai-draw/` 目录，除非设置了 `AI_DRAW_HOME`。
- 生成图和修图结果会复制到本地画布资源目录。
- `.ai-draw/`、`tmp/`、`node_modules/` 和 TypeScript 构建缓存不会提交到 Git。

## Troubleshooting / 常见问题

English:

- Codex cannot find ai-draw: restart Codex or open a new chat after installing the plugin.
- MCP tools are missing: reinstall the plugin with `codex plugin add ai-draw@ai-draw`.
- ai-draw does not open: check whether port `43218` is already used, or set `AI_DRAW_PORT`.
- Image edits do not start: say `@ai-draw 开启自动修图模式`, then click `按标注修图` on the canvas.

中文：

- Codex 找不到 ai-draw：安装后重启 Codex，或新开一个对话。
- MCP 工具没有加载：重新运行 `codex plugin add ai-draw@ai-draw`。
- 画布打不开：检查 `43218` 端口是否被占用，或设置 `AI_DRAW_PORT`。
- 点按钮后没有修图：先说 `@ai-draw 开启自动修图模式`，再在画布点击 `按标注修图`。

## Acknowledgements / 参考与致谢

ai-draw references code and implementation ideas from [binghe1980/AI-Canvas](https://github.com/binghe1980/AI-Canvas). Thanks to [binghe1980](https://github.com/binghe1980), the original source author, for the open-source work that helped establish the Codex-integrated local canvas, AI image generation, and annotation-driven editing workflow.

ai-draw 的代码实现参考了 [binghe1980/AI-Canvas](https://github.com/binghe1980/AI-Canvas)。感谢源代码作者 [binghe1980](https://github.com/binghe1980) 的开源工作，为 Codex 集成本地无限画布、AI 生图和标注修图流程提供了重要基础。

This project also thanks [tldraw](https://github.com/tldraw/tldraw) for the infinite-canvas foundation and the [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) for MCP tool integration.

本项目也感谢 [tldraw](https://github.com/tldraw/tldraw) 提供无限画布能力，以及 [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) 提供 MCP 工具接入基础。

## License / 许可证

MIT. See [LICENSE](./LICENSE).
