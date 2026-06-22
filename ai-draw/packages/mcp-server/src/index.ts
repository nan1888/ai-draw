import {
  collectAnnotationsInputSchema,
  createImageHolderInputSchema,
  createImageVersionInputSchema,
  editImageFromAnnotationsInputSchema,
  generateImageIntoHolderInputSchema,
  getEditRequestEventsInputSchema,
  getEditRequestInputSchema,
  insertImageIntoHolderInputSchema,
  openCanvasInputSchema,
  prepareAnnotationEditInputSchema,
  prepareImageGenerationInputSchema,
  processNextEditRequestInputSchema,
  saveSnapshotInputSchema,
  updateEditRequestInputSchema,
  watchEditRequestsInputSchema,
  NewApiAsyncImageAdapter
} from '@ai-canvas/shared'
import type {
  AnnotationInstruction,
  CanvasEditRequest,
  CanvasStatePayload,
  EditRequestPollResult,
  ImageGenerationProviderOptions,
  PreparedAnnotationEdit,
  PreparedImageGeneration,
  ShapeSummary
} from '@ai-canvas/shared'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import path from 'node:path'
import { z } from 'zod'
import { parseAnnotations } from './annotations/parseAnnotations.js'
import { fetchJson, getCanvasState, getSelection, openCanvas, postJson } from './canvas/client.js'
import { assertReadableFile } from './utils/paths.js'

function asToolResult(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(value, null, 2)
      }
    ],
    structuredContent: value as Record<string, unknown>
  }
}

const server = new McpServer({
  name: 'ai-draw-mcp',
  version: '0.1.0'
})

function holderSize(aspectRatio: string, input?: { w?: number; h?: number }) {
  if (input?.w && input?.h) return { w: input.w, h: input.h }
  const [rawW, rawH] = aspectRatio.split(':').map((part) => Number(part))
  if (Number.isFinite(rawW) && Number.isFinite(rawH) && rawW > 0 && rawH > 0) {
    const base = 420
    return { w: base, h: Math.round((base * rawH) / rawW) }
  }
  return { w: 420, h: 588 }
}

function findPreferredHolder(state: CanvasStatePayload) {
  const selectedHolder = state.selection.shapes.find((shape) => shape.role === 'image_holder')
  if (selectedHolder) return selectedHolder
  const holders = state.shapes.filter((shape) => shape.role === 'image_holder')
  if (holders.length === 1) return holders[0]
  return undefined
}

function generationPrompt(input: {
  request: string
  aspectRatio: string
  intendedUse?: string
}) {
  return [
    `请生成一张图片。`,
    ``,
    `用户需求：${input.request}`,
    `画面比例：${input.aspectRatio}`,
    input.intendedUse ? `用途：${input.intendedUse}` : undefined,
    `构图要求：主体明确，适合放入画布继续标注修改。`,
    `文字策略：如果用户要求标题、广告语或字体风格，请把文字作为画面创意的一部分直接设计进图片，充分发挥字体设计和排版能力。`,
    `避免：低清晰度、错乱文字、水印、畸形主体、杂乱背景。`
  ]
    .filter(Boolean)
    .join('\n')
}

function formatAnnotation(annotation: AnnotationInstruction, index: number) {
  const region = annotation.region
  return `${index + 1}. 在图片相对区域 x=${region.x.toFixed(2)}, y=${region.y.toFixed(
    2
  )}, w=${region.w.toFixed(2)}, h=${region.h.toFixed(2)}：${annotation.instruction}`
}

function editPrompt(input: {
  userRequest?: string
  annotations: AnnotationInstruction[]
}) {
  const annotationList = input.annotations.length
    ? input.annotations.map(formatAnnotation).join('\n')
    : '没有可靠的结构化标注。请优先保持原图不变，等待用户补充说明。'
  return [
    `基于输入图片进行编辑。保持整体构图、主体位置、光影风格、画面质感和品牌视觉风格不变。`,
    input.userRequest ? `用户补充要求：${input.userRequest}` : undefined,
    ``,
    `请根据以下画布标注进行修改：`,
    annotationList,
    ``,
    `不要改变：`,
    `- 未标注区域。`,
    `- 品牌名和主要标题，除非用户明确要求。`,
    `- 原图整体比例、风格和主体识别度。`,
    ``,
    `输出要求：与原图相同比例；修改自然；如果某条标注意图不明确，优先保持原样。`
  ]
    .filter((line) => line !== undefined)
    .join('\n')
}

function imagePathFromState(state: CanvasStatePayload, shape?: ShapeSummary) {
  if (!shape?.assetPath) return undefined
  return path.join(state.storagePath, shape.assetPath)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createImageAdapter(workspaceRoot?: string) {
  return new NewApiAsyncImageAdapter({ workspaceRoot })
}

function outputName(prefix: string) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const random = Math.random().toString(36).slice(2, 7)
  return `${prefix}_${stamp}_${random}`
}

function workspaceRootFromStoragePath(storagePath?: string) {
  return storagePath ? path.resolve(storagePath, '../../..') : undefined
}

async function imageProviderContext(provider?: ImageGenerationProviderOptions, workspaceRoot?: string) {
  const providerConfigured = await NewApiAsyncImageAdapter.isConfigured(
    workspaceRoot ?? process.env.AI_CANVAS_WORKSPACE_ROOT ?? process.cwd()
  )
  return {
    providerConfigured,
    providerModel: provider?.model ?? process.env.AI_CANVAS_IMAGE_MODEL ?? 'gpt-image-2-max'
  }
}

function fallbackImageGenerationResult(input: {
  opened: { url: string; canvasId: string; storagePath: string }
  holder: ShapeSummary
  aspectRatio: string
  outputDir: string
  prompt: string
}) {
  return {
    ok: false,
    needsFallback: true,
    fallback: 'codex-image',
    readyToGenerate: true,
    needsCanvasOpen: false,
    message:
      '未配置外部图片 API。请使用 Codex 自带图片生成能力生成图片，并用 insert_image_into_holder 插入 holder。',
    url: input.opened.url,
    canvasId: input.opened.canvasId,
    storagePath: input.opened.storagePath,
    holderShapeId: input.holder.id,
    holderBounds: input.holder.bounds,
    aspectRatio: input.aspectRatio,
    outputDir: input.outputDir,
    suggestedPrompt: input.prompt,
    providerConfigured: false
  }
}

async function insertGeneratedImage(input: {
  holderShapeId: string
  imagePath: string
  title: string
}) {
  return postJson('/api/canvas/asset', input)
}

async function insertEditedVersion(input: {
  sourceShapeId: string
  imagePath: string
  placement: 'right' | 'replace'
  title: string
  runId?: string
}) {
  return postJson('/api/canvas/version', input)
}

async function prepareAnnotationEditFromCanvas(input: {
  workspaceRoot?: string
  canvasId?: string
  port?: number
  targetShapeId?: string
  userRequest?: string
  radius: number
  includeScreenshot: boolean
}) {
  if (input.workspaceRoot || input.canvasId || input.port) {
    await openCanvas(input)
  }
  const state = await getCanvasState()
  const plan = parseAnnotations({
    state,
    targetShapeId: input.targetShapeId,
    radius: input.radius
  })
  const target = state.shapes.find((shape) => shape.id === plan.targetShapeId)
  if (input.includeScreenshot && plan.targetShapeId) {
    const shapeIds = [
      plan.targetShapeId,
      ...plan.annotationPlan.flatMap((annotation) => annotation.sourceShapeIds)
    ]
    const exported = await postJson<{ screenshotPath: string; absolutePath: string }>(
      '/api/canvas/export',
      { shapeIds }
    )
    plan.screenshotPath = exported.screenshotPath
  }

  const result: PreparedAnnotationEdit = {
    ...plan,
    readyToEdit: !plan.needsClarification && Boolean(plan.targetImagePath),
    storagePath: state.storagePath,
    url: undefined,
    inputImagePath: imagePathFromState(state, target),
    editPrompt: editPrompt({
      userRequest: input.userRequest,
      annotations: plan.annotationPlan
    })
  }
  return result
}

async function editPreparedImage(input: {
  prepared: PreparedAnnotationEdit
  provider?: ImageGenerationProviderOptions
  placement: 'right' | 'replace'
  title: string
  autoSave: boolean
  outputNamePrefix?: string
  runId?: string
}) {
  if (!input.prepared.readyToEdit || !input.prepared.inputImagePath || !input.prepared.targetShapeId) {
    throw new Error(
      input.prepared.clarificationReason ??
        'ai-draw annotations are not ready for automatic image editing.'
    )
  }
  const adapter = createImageAdapter(workspaceRootFromStoragePath(input.prepared.storagePath))
  const image = await adapter.editImage({
    prompt: input.prepared.editPrompt,
    inputImagePath: input.prepared.inputImagePath,
    annotatedScreenshotPath: input.prepared.screenshotPath
      ? path.join(input.prepared.storagePath, input.prepared.screenshotPath)
      : undefined,
    annotations: input.prepared.annotationPlan,
    outputDir: path.join(input.prepared.storagePath, 'assets/images'),
    outputName: outputName(input.outputNamePrefix ?? 'edited'),
    provider: input.provider
  })
  const version = await insertEditedVersion({
    sourceShapeId: input.prepared.targetShapeId,
    imagePath: image.imagePath,
    placement: input.placement,
    title: input.title,
    runId: input.runId
  })
  if (input.autoSave) await postJson('/api/canvas/save', {})
  return { image, version }
}

server.registerTool(
  'open_canvas',
  {
    title: 'Open ai-draw',
    description: 'Start or open the local ai-draw service.',
    inputSchema: openCanvasInputSchema
  },
  async (input) => {
    const parsed = openCanvasInputSchema.parse(input)
    return asToolResult(await openCanvas(parsed))
  }
)

server.registerTool(
  'prepare_image_generation',
  {
    title: 'Prepare Image Generation',
    description:
      'Conversation-first workflow entry: open ai-draw, find or create a holder, and return the prompt/output target for image generation.',
    inputSchema: prepareImageGenerationInputSchema
  },
  async (input) => {
    const parsed = prepareImageGenerationInputSchema.parse(input)
    const opened = await openCanvas(parsed)
    let state = await getCanvasState()
    let holder = findPreferredHolder(state)

    if (!holder) {
      const size = holderSize(parsed.aspectRatio, parsed)
      try {
        const created = await postJson<{ shapeId: string; bounds: { x: number; y: number; w: number; h: number } }>(
          '/api/canvas/shape',
          {
            label: parsed.label,
            aspectRatio: parsed.aspectRatio,
            x: parsed.x,
            y: parsed.y,
            ...size
          }
        )
        await postJson('/api/canvas/save', {})
        state = await getCanvasState()
        holder =
          state.shapes.find((shape) => shape.id === created.shapeId) ??
          ({
            id: created.shapeId,
            type: 'geo',
            role: 'image_holder',
            bounds: created.bounds,
            aspectRatio: parsed.aspectRatio
          } satisfies ShapeSummary)
      } catch (error) {
        const result: PreparedImageGeneration = {
          readyToGenerate: false,
          needsCanvasOpen: true,
          message:
            'ai-draw 已启动，但图片框还没有创建成功。请保留生成结果文件，并把返回的画布 URL 提供给用户打开查看。',
          url: opened.url,
          canvasId: opened.canvasId,
          storagePath: opened.storagePath,
          aspectRatio: parsed.aspectRatio,
          outputDir: path.join(opened.storagePath, 'assets/images'),
          suggestedPrompt: generationPrompt(parsed)
        }
        return asToolResult({
          ...result,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const result: PreparedImageGeneration = {
      readyToGenerate: true,
      needsCanvasOpen: false,
      message: 'ai-draw 已准备好。请生成图片，并用 insert_image_into_holder 插入 holder。',
      url: opened.url,
      canvasId: opened.canvasId,
      storagePath: opened.storagePath,
      holderShapeId: holder.id,
      holderBounds: holder.bounds,
      aspectRatio: holder.aspectRatio ?? parsed.aspectRatio,
      outputDir: path.join(opened.storagePath, 'assets/images'),
      suggestedPrompt: generationPrompt({
        request: parsed.request,
        aspectRatio: holder.aspectRatio ?? parsed.aspectRatio,
        intendedUse: parsed.intendedUse
      })
    }
    return asToolResult(result)
  }
)

server.registerTool(
  'generate_image_into_holder',
  {
    title: 'Generate Image Into Holder',
    description:
      'Use the configured NewAPI async image endpoint to generate an image, then insert it into ai-draw.',
    inputSchema: generateImageIntoHolderInputSchema
  },
  async (input) => {
    const parsed = generateImageIntoHolderInputSchema.parse(input)
    const prepared = (await (async () => {
      const opened = await openCanvas(parsed)
      let state = await getCanvasState()
      let holder = findPreferredHolder(state)

      if (!holder) {
        const size = holderSize(parsed.aspectRatio, parsed)
        const created = await postJson<{
          shapeId: string
          bounds: { x: number; y: number; w: number; h: number }
        }>('/api/canvas/shape', {
          label: parsed.label,
          aspectRatio: parsed.aspectRatio,
          x: parsed.x,
          y: parsed.y,
          ...size
        })
        await postJson('/api/canvas/save', {})
        state = await getCanvasState()
        holder =
          state.shapes.find((shape) => shape.id === created.shapeId) ??
          ({
            id: created.shapeId,
            type: 'geo',
            role: 'image_holder',
            bounds: created.bounds,
            aspectRatio: parsed.aspectRatio
          } satisfies ShapeSummary)
      }

      return {
        opened,
        holder,
        aspectRatio: holder.aspectRatio ?? parsed.aspectRatio,
        outputDir: path.join(opened.storagePath, 'assets/images')
      }
    })()) satisfies {
      opened: { url: string; canvasId: string; storagePath: string }
      holder: ShapeSummary
      aspectRatio: string
      outputDir: string
    }

    const prompt = generationPrompt({
      request: parsed.request,
      aspectRatio: prepared.aspectRatio,
      intendedUse: parsed.intendedUse
    })
    const providerContext = await imageProviderContext(parsed.provider, parsed.workspaceRoot)
    if (!providerContext.providerConfigured) {
      return asToolResult(
        fallbackImageGenerationResult({
          ...prepared,
          prompt
        })
      )
    }

    const adapter = createImageAdapter(parsed.workspaceRoot)
    const image = await adapter.generateImage({
      prompt,
      aspectRatio: prepared.aspectRatio,
      outputDir: prepared.outputDir,
      outputName: outputName('generated'),
      provider: parsed.provider
    })
    const inserted = await insertGeneratedImage({
      holderShapeId: prepared.holder.id,
      imagePath: image.imagePath,
      title: parsed.label
    })
    if (parsed.autoSave) await postJson('/api/canvas/save', {})

    return asToolResult({
      ok: true,
      message: '图片已通过 NewAPI 异步接口生成，并插入 ai-draw。',
      url: prepared.opened.url,
      canvasId: prepared.opened.canvasId,
      storagePath: prepared.opened.storagePath,
      holderShapeId: prepared.holder.id,
      imagePath: image.imagePath,
      image,
      inserted,
      ...providerContext
    })
  }
)

server.registerTool(
  'get_selection',
  {
    title: 'Get Canvas Selection',
    description: 'Read the current canvas selection and shape summaries.',
    inputSchema: z.object({})
  },
  async () => asToolResult(await getSelection())
)

server.registerTool(
  'create_image_holder',
  {
    title: 'Create Image Holder',
    description: 'Create an AI image placeholder on the current canvas.',
    inputSchema: createImageHolderInputSchema
  },
  async (input) => {
    const parsed = createImageHolderInputSchema.parse(input)
    return asToolResult(await postJson('/api/canvas/shape', parsed))
  }
)

server.registerTool(
  'insert_image_into_holder',
  {
    title: 'Insert Image Into Holder',
    description: 'Copy a local image into canvas assets and place it over a holder.',
    inputSchema: insertImageIntoHolderInputSchema
  },
  async (input) => {
    const parsed = insertImageIntoHolderInputSchema.parse(input)
    const imagePath = await assertReadableFile(parsed.imagePath)
    return asToolResult(await postJson('/api/canvas/asset', { ...parsed, imagePath }))
  }
)

server.registerTool(
  'collect_annotations',
  {
    title: 'Collect Canvas Annotations',
    description: 'Collect nearby arrow/text/shape annotations for an AI image.',
    inputSchema: collectAnnotationsInputSchema
  },
  async (input) => {
    const parsed = collectAnnotationsInputSchema.parse(input)
    const state = await getCanvasState()
    const plan = parseAnnotations({
      state,
      targetShapeId: parsed.targetShapeId,
      radius: parsed.radius
    })
    if (parsed.includeScreenshot && plan.targetShapeId) {
      const shapeIds = [
        plan.targetShapeId,
        ...plan.annotationPlan.flatMap((annotation) => annotation.sourceShapeIds)
      ]
      const exported = await postJson<{ screenshotPath: string; absolutePath: string }>(
        '/api/canvas/export',
        { shapeIds }
      )
      plan.screenshotPath = exported.screenshotPath
    }
    return asToolResult(plan)
  }
)

server.registerTool(
  'prepare_annotation_edit',
  {
    title: 'Prepare Annotation Edit',
    description:
      'Conversation-first workflow entry: collect annotations, export a marked reference, and return a ready image-edit prompt.',
    inputSchema: prepareAnnotationEditInputSchema
  },
  async (input) => {
    const parsed = prepareAnnotationEditInputSchema.parse(input)
    return asToolResult(await prepareAnnotationEditFromCanvas(parsed))
  }
)

server.registerTool(
  'edit_image_from_annotations',
  {
    title: 'Edit Image From Annotations',
    description:
      'Use the configured NewAPI async image endpoint to edit the selected AI image from current canvas annotations, then place a new version.',
    inputSchema: editImageFromAnnotationsInputSchema
  },
  async (input) => {
    const parsed = editImageFromAnnotationsInputSchema.parse(input)
    const prepared = await prepareAnnotationEditFromCanvas(parsed)
    const edited = await editPreparedImage({
      prepared,
      provider: parsed.provider,
      placement: parsed.placement,
      title: parsed.title,
      autoSave: parsed.autoSave
    })
    return asToolResult({
      ok: true,
      message: '已通过 NewAPI 异步接口按画布标注生成新版图片，旧图保留。',
      prepared,
      ...edited,
      ...(await imageProviderContext(parsed.provider, parsed.workspaceRoot))
    })
  }
)

server.registerTool(
  'watch_edit_requests',
  {
    title: 'Watch ai-draw Edit Requests',
    description:
      'Wait for an edit request submitted from the ai-draw button. Use for auto edit mode.',
    inputSchema: watchEditRequestsInputSchema
  },
  async (input) => {
    const parsed = watchEditRequestsInputSchema.parse(input)
    if (parsed.workspaceRoot || parsed.canvasId || parsed.port) {
      await openCanvas(parsed)
    }
    const deadline = Date.now() + parsed.waitMs
    let pollResult: EditRequestPollResult | undefined

    do {
      pollResult = await postJson<EditRequestPollResult>('/api/canvas/edit-requests/next', {
        claim: parsed.claim,
        includeCompleted: parsed.includeCompleted
      })
      if (pollResult.request) return asToolResult(pollResult)
      if (Date.now() >= deadline) break
      await sleep(Math.min(1000, Math.max(250, deadline - Date.now())))
    } while (Date.now() < deadline)

    return asToolResult({
      request: undefined,
      timedOut: true,
      message:
        'No queued ai-draw edit request yet. The image is ready; Codex is waiting for the user to annotate the canvas and click 按标注修图.'
    } satisfies EditRequestPollResult)
  }
)

server.registerTool(
  'process_next_edit_request',
  {
    title: 'Process Next ai-draw Edit Request',
    description:
      'Claim the next edit request submitted from the ai-draw button, edit it via NewAPI async image endpoint, insert the version, and update request status.',
    inputSchema: processNextEditRequestInputSchema
  },
  async (input) => {
    const parsed = processNextEditRequestInputSchema.parse(input)
    if (parsed.workspaceRoot || parsed.canvasId || parsed.port) {
      await openCanvas(parsed)
    }
    const deadline = Date.now() + parsed.waitMs
    let pollResult: EditRequestPollResult | undefined

    do {
      pollResult = await postJson<EditRequestPollResult>('/api/canvas/edit-requests/next', {
        claim: parsed.claim,
        includeCompleted: parsed.includeCompleted
      })
      if (pollResult.request || Date.now() >= deadline) break
      await sleep(Math.min(1000, Math.max(250, deadline - Date.now())))
    } while (Date.now() < deadline)

    const request = pollResult?.request
    if (!request) {
      return asToolResult({
        request: undefined,
        timedOut: true,
        message:
          'No queued ai-draw edit request yet. Codex can keep waiting, or the user can annotate and click 按标注修图.'
      })
    }

    if (!request.canAutoEdit || !request.readyToEdit) {
      const updated = await postJson<CanvasEditRequest>(
        `/api/canvas/edit-requests/${encodeURIComponent(request.requestId)}/status`,
        {
          requestId: request.requestId,
          status: 'needs_clarification',
          error:
            request.clarificationReason ??
            'This request is missing a clear target image or actionable annotations.'
        }
      )
      return asToolResult({
        ok: false,
        request: updated,
        message: updated.error
      })
    }

    try {
      const edited = await editPreparedImage({
        prepared: request,
        provider: parsed.provider,
        placement: parsed.placement,
        title: parsed.title,
        autoSave: parsed.autoSave,
        outputNamePrefix: request.requestId,
        runId: request.requestId
      })
      const updated = await postJson<CanvasEditRequest>(
        `/api/canvas/edit-requests/${encodeURIComponent(request.requestId)}/status`,
        {
          requestId: request.requestId,
          status: 'completed',
          result: {
            imagePath: edited.image.imagePath,
            version: edited.version
          }
        }
      )
      return asToolResult({
        ok: true,
        message: '已处理画布按钮提交的修图任务，新版已放到旧图右侧。',
        request: updated,
        ...edited,
        ...(await imageProviderContext(parsed.provider, parsed.workspaceRoot))
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const updated = await postJson<CanvasEditRequest>(
        `/api/canvas/edit-requests/${encodeURIComponent(request.requestId)}/status`,
        {
          requestId: request.requestId,
          status: 'failed',
          error: message
        }
      )
      return asToolResult({
        ok: false,
        request: updated,
        error: message,
        ...(await imageProviderContext(parsed.provider, parsed.workspaceRoot))
      })
    }
  }
)

server.registerTool(
  'get_edit_request',
  {
    title: 'Get ai-draw Edit Request',
    description: 'Read one queued, processing, completed, failed, or clarification edit request by id.',
    inputSchema: getEditRequestInputSchema
  },
  async (input) => {
    const parsed = getEditRequestInputSchema.parse(input)
    return asToolResult(await fetchJson<CanvasEditRequest>(`/api/canvas/edit-requests/${encodeURIComponent(parsed.requestId)}`))
  }
)

server.registerTool(
  'get_edit_request_events',
  {
    title: 'Get ai-draw Edit Request Events',
    description:
      'Read progress events for one edit request, or all recent ai-draw progress events when requestId is omitted.',
    inputSchema: getEditRequestEventsInputSchema
  },
  async (input) => {
    const parsed = getEditRequestEventsInputSchema.parse(input)
    const apiPath = parsed.requestId
      ? `/api/canvas/edit-requests/${encodeURIComponent(parsed.requestId)}/events`
      : '/api/canvas/edit-requests/events'
    return asToolResult(await fetchJson(apiPath))
  }
)

server.registerTool(
  'update_edit_request',
  {
    title: 'Update ai-draw Edit Request',
    description: 'Mark an ai-draw edit request as completed, failed, processing, queued, or needing clarification.',
    inputSchema: updateEditRequestInputSchema
  },
  async (input) => {
    const parsed = updateEditRequestInputSchema.parse(input)
    return asToolResult(
      await postJson<CanvasEditRequest>(
        `/api/canvas/edit-requests/${encodeURIComponent(parsed.requestId)}/status`,
        parsed
      )
    )
  }
)

server.registerTool(
  'create_image_version',
  {
    title: 'Create Image Version',
    description: 'Copy a local edited image into canvas assets and place it as a new version.',
    inputSchema: createImageVersionInputSchema
  },
  async (input) => {
    const parsed = createImageVersionInputSchema.parse(input)
    const imagePath = await assertReadableFile(parsed.imagePath)
    return asToolResult(await postJson('/api/canvas/version', { ...parsed, imagePath }))
  }
)

server.registerTool(
  'save_snapshot',
  {
    title: 'Save Canvas Snapshot',
    description: 'Force persistence of the current tldraw snapshot.',
    inputSchema: saveSnapshotInputSchema
  },
  async () => asToolResult(await postJson('/api/canvas/save', {}))
)

const transport = new StdioServerTransport()
await server.connect(transport)
