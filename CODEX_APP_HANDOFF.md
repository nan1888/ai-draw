# Codex App Development Handoff

本文档用于把 ai-draw 后续开发、联调和发布交给 Codex app 端继续处理。

## 当前状态

- 公开仓库：`https://github.com/nan1888/ai-draw.git`
- 主分支：`main`
- 当前基线提交：`fe46a6b Add async image API provider`
- 插件名称：`ai-draw`
- Marketplace 名称：`ai-draw`
- 默认画布服务端口：`43218`

ai-draw 现在是一个 Codex 插件：Codex 通过 MCP 工具打开本地 tldraw 无限画布，创建图片框，调用外部异步图片 API 生成或编辑图片，并把图片插入画布。用户也可以在画布中标注后点击 `按标注修图`，由 Codex 继续处理队列任务。

## 已完成能力

- 接入 NewAPI 风格异步图片接口。
- 支持图片生成：`POST /v1/images/async/generations`。
- 支持图片编辑：`POST /v1/images/async/edits`。
- 支持任务轮询：`GET /v1/images/async/{task_id}`。
- 支持从画布右侧 UI 配置图片接口：
  - `Base URL`
  - `API Key`
  - `model`
  - `size`
  - `quality`
  - `outputFormat`
  - `pollIntervalMs`
  - `timeoutMs`
- 画布 UI 已内置 happyhorse.pics 推荐配置：
  - Base URL: `https://happyhorse.pics/v1`
  - 模型：`gpt-image-2`、`banana2`、`gemini-3.0-pro-image`
  - 尺寸：`1k`、`2k`、`4k`
- API Key 保存在本地 `.ai-draw/config.json`，不会回显到浏览器。
- 如果未配置外部图片 API，旧的 prompt-first Codex 工作流仍可用。
- 已构建并提交 `packages/*/dist`，支持 Codex Git marketplace 安装。

## 关键目录

```text
ai-draw/
  .codex-plugin/plugin.json             Codex 插件 manifest
  .mcp.json                             MCP server 启动配置
  packages/mcp-server/src/index.ts      MCP 工具注册和工作流编排
  packages/mcp-server/src/image/newApiAsyncImageAdapter.ts
                                         NewAPI 异步图片 API 适配器
  packages/canvas-app/src/App.tsx       画布前端 UI
  packages/canvas-app/src/server.ts     画布本地 HTTP/WebSocket 服务
  packages/shared/src/types.ts          共享类型
  packages/shared/src/schemas.ts        zod schema
  skills/                               Codex skills
```

## MCP 工具重点

主要新增或相关工具在 `packages/mcp-server/src/index.ts`：

- `prepare_image_generation`
- `generate_image_into_holder`
- `prepare_annotation_edit`
- `edit_image_from_annotations`
- `process_next_edit_request`
- `watch_edit_requests`
- `get_edit_request`
- `update_edit_request`

建议 Codex app 端调试时优先验证这三个外部 API 主流程：

1. `generate_image_into_holder`
2. `edit_image_from_annotations`
3. `process_next_edit_request`

## 外部图片 API 配置

推荐让用户在画布右侧配置：

```text
AI 操作 -> 更多操作 -> 图片接口设置
```

环境变量兜底：

```bash
export NEWAPI_BASE_URL="https://happyhorse.pics/v1"
export NEWAPI_API_KEY="REPLACE_WITH_YOUR_NEWAPI_KEY"
export AI_CANVAS_IMAGE_MODEL="gpt-image-2"
export AI_CANVAS_IMAGE_SIZE="1k"
export AI_CANVAS_IMAGE_QUALITY="auto"
export AI_CANVAS_IMAGE_OUTPUT_FORMAT="png"
export AI_CANVAS_IMAGE_TIMEOUT_MS="420000"
export AI_CANVAS_IMAGE_POLL_INTERVAL_MS="5000"
```

本地 UI 保存后会写入：

```text
.ai-draw/config.json
```

这个目录已被 `.gitignore` 排除，不要提交。

## API 返回格式假设

提交任务后需要返回：

```json
{
  "data": {
    "task_id": "task-id"
  }
}
```

轮询成功时需要返回：

```json
{
  "data": {
    "status": "SUCCESS",
    "data": {
      "data": [
        {
          "url": "https://example.com/image.png"
        }
      ]
    }
  }
}
```

也支持 `b64_json`：

```json
{
  "data": {
    "status": "SUCCESS",
    "data": {
      "data": [
        {
          "b64_json": "..."
        }
      ]
    }
  }
}
```

失败状态目前按 `status === "FAILURE"` 处理，并读取 `fail_reason`。

## 本地开发

从公开仓库开始：

```bash
git clone https://github.com/nan1888/ai-draw.git
cd ai-draw/ai-draw
npm run setup
```

常用检查：

```bash
npm run typecheck
npm run test
npm run build
npm run validate:plugin
```

启动画布服务用于本地调试：

```bash
npm run dev:canvas
```

也可以跑构建后的服务：

```bash
NODE_ENV=production node packages/canvas-app/dist/server/server.js \
  --port 43218 \
  --workspace-root "<your workspace>"
```

打开：

```text
http://127.0.0.1:43218/
```

## Codex 插件安装

Git marketplace 安装：

```bash
codex plugin marketplace add https://github.com/nan1888/ai-draw --ref main
codex plugin add ai-draw@ai-draw
```

本地开发安装，从仓库根目录执行：

```bash
codex plugin marketplace add .
codex plugin add ai-draw@ai-draw
```

安装后重启 Codex，或新开一个对话。

## 建议给 Codex App 的接手 Prompt

```text
请继续开发和调试 ai-draw 插件。
先阅读 CODEX_APP_HANDOFF.md、README.md、ai-draw/README.md。
重点检查外部 NewAPI 异步图片接口的生成、编辑、队列修图三个流程。
不要提交 .env、.ai-draw、output、tmp、node_modules 或真实 API Key。
每次修改后运行 npm run typecheck、npm run test、npm run build、npm run validate:plugin。
```

## 联调清单

1. 打开 Codex app，安装插件。
2. 输入：

```text
@ai-draw 打开 AI 画布，帮我做一张竖版海报。
```

3. 在画布右侧 `图片接口设置` 填写测试网关和测试 Key。
   - 推荐网关可用 `https://happyhorse.pics/v1`。
   - 推荐模型：`gpt-image-2`、`banana2`、`gemini-3.0-pro-image`。
   - 支持尺寸：`1k`、`2k`、`4k`。
4. 让 Codex 调用 `generate_image_into_holder`。
5. 确认生成图片保存到 `.ai-draw/canvases/<canvas-id>/assets/images/`。
6. 确认图片被插入 holder。
7. 在图片上画箭头、文字、圈选。
8. 点击 `按标注修图`。
9. 让 Codex 运行 `process_next_edit_request`。
10. 确认新版图片被放到旧图右侧。

## 重点风险

- 外部网关返回格式如果和当前假设不同，需要优先改 `newApiAsyncImageAdapter.ts`。
- `Base URL` 会自动补 `/v1`，如果网关不是这个路径规则，需要调整 `normalizeBaseUrl`。
- 图片编辑目前用 `FormData` 上传原图，字段名是 `image`，mask 字段名是 `mask`。
- 画布 UI 不回显 API Key，调试时只能看 `hasApiKey` 状态。
- Vite 构建产物较大，目前只是 warning，不影响构建。
- `dist` 文件需要随源码一起提交，否则 Git marketplace 安装时用户可能无法直接运行。

## 后续建议

- 增加 `测试连接` 按钮，验证 Base URL、Key 和模型是否可用。
- 增加真实网关的集成测试脚本，但不要提交真实 Key。
- 在 UI 中展示更详细的异步任务状态，例如 task id、进度、失败原因。
- 补充 Playwright 或浏览器端 E2E，覆盖设置保存、生成图片、提交修图任务。
- 根据真实网关返回值补齐图片宽高读取，当前 `ImageResult.width/height` 暂为 `0`。
- 如需发布新版本，建议每次变更后更新插件版本或 cachebuster，并重新构建 `dist`。

## 发布前脱敏检查

每次提交前建议跑：

```bash
rg -n --hidden -g '!**/node_modules/**' -g '!**/.git/**' \
  '<old repo owner>|<local absolute path>|<real API key or token pattern>|<private key marker>' .

git diff --check
git status --ignored --short
```

确认不要提交：

```text
.env
.env.*
.ai-draw/
output/
tmp/
node_modules/
*.tsbuildinfo
```
