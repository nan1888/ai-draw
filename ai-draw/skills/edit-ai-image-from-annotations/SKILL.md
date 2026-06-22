---
name: edit-ai-image-from-annotations
description: "Use when the user has annotated an ai-draw image and asks for follow-up changes, including 要求后续变更, 后续修改, 按标注修改, 根据箭头修改, 照画布意见改图, or edit the selected image from canvas annotations."
---

# Edit AI Image From Annotations

This is the second-loop skill for ai-draw. It should feel like the reference flow: the user draws arrows/text/circles on the canvas, returns to Codex, says a short follow-up such as `要求后续变更`, and Codex handles the rest.

## Tool Availability Gate

This workflow must use the ai-draw MCP tools. If `edit_image_from_annotations` is available, prefer it because it reads annotations, calls the configured external async image API, and inserts the new version in one step. If it is not available, fall back to `prepare_annotation_edit`, `create_image_version`, and `save_snapshot`.

If neither `edit_image_from_annotations` nor the fallback tool set is callable in the current Codex thread, stop and tell the user:

```text
ai-draw 插件已经识别到，但修图工具没有加载出来。如果你刚安装或刚更新过插件，请完全退出并重新打开 Codex，再发送同一句需求；插件不需要重新安装。
```

Do not inspect plugin files, run `curl`, check ports, start local services by hand, or recreate HTTP calls during a normal edit request. Those actions are only for explicit plugin development/debugging.

## Trigger Behavior

When triggered from a short text prompt, do not ask the user to copy text from the canvas. Do not ask them to press the sidebar button first. The canvas autosaves state while open.

If the trigger came from auto mode or the user clicked the canvas button, prefer `watch_edit_requests` and use the queued request instead of preparing a fresh one.

## Workflow

1. If `edit_image_from_annotations` is callable, call it immediately. If it succeeds, tell the user the new version is placed to the right and the old image is preserved, then stop.
2. If `edit_image_from_annotations` is not callable, call `prepare_annotation_edit` immediately.
3. Inspect the returned result:
   - If there is no target image, ask the user to select the image on the canvas or clarify which image to edit.
   - If there are no annotations, ask the user to add arrows, text, circles, rectangles, or freehand marks on the image.
   - If confidence is low but the target image and user intent are still clear, proceed and mention the uncertain parts briefly.
   - If multiple target images are possible, ask one short clarification question.
4. Use `inputImagePath` as the source image and `editPrompt` as the edit instruction. Use `screenshotPath` as a visual reference when the image tool can accept an additional reference.
5. Edit the image with the available Codex image-editing capability.
6. Save the edited image under the canvas assets area when the image tool provides a file or downloadable result.
7. Call `create_image_version` so the new image appears to the right of the original. Never overwrite the original unless the user explicitly asks.
8. Call `save_snapshot`.
9. Reply briefly: new version created, placed to the right, old image preserved.

## Good User Phrases

Treat all of these as sufficient:

- `要求后续变更`
- `按标注改`
- `根据箭头修改`
- `照我画布上的意见改`
- `把这张图做一个新版`
- `继续修改当前图`

## User-Facing Tone

Use plain language:

- "我看到了画布上的标注，先读标注再做新版。"
- "这次我会保留旧图，新图放在右侧。"
- "有两处圈选不太明确，我会只按明确标注改，其余区域尽量保持不变。"

Do not show tool calls or raw annotation JSON unless the user asks to debug.
