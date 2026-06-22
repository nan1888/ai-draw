import type {
  ImageCompositionRequest,
  ImageEditRequest,
  ImageProviderEvent,
  ImageGenerationProviderOptions,
  ImageGenerationRequest,
  ImageProviderSettings,
  ImageResult
} from '@ai-canvas/shared'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

type AsyncSubmitResponse = {
  task_id?: string
  id?: string
  code?: string
  status?: string
  task_status?: string
  data?: {
    id?: string
    task_id?: string
    status?: string
    task_status?: string
    progress?: string
  }
  error?: unknown
}

type ImageItem = {
  url?: string
  b64_json?: string
  revised_prompt?: string
}

type AsyncPollResponse = {
  code?: string
  status?: string
  task_status?: string
  fail_reason?: string
  message?: string
  url?: string
  b64_json?: string
  output?: unknown
  result?: unknown
  images?: unknown
  data?: {
    task_id?: string
    status?: string
    task_status?: string
    progress?: string
    fail_reason?: string
    message?: string
    url?: string
    b64_json?: string
    output?: unknown
    result?: unknown
    images?: unknown
    data?: {
      data?: ImageItem[]
      images?: unknown
      output?: unknown
      created?: number
    }
  }
  error?: unknown
}

type NewApiAsyncImageAdapterOptions = {
  baseUrl?: string
  apiKey?: string
  workspaceRoot?: string
  defaultModel?: string
  defaultSize?: string
  defaultQuality?: string
  defaultOutputFormat?: 'png' | 'jpeg' | 'webp'
  pollIntervalMs?: number
  timeoutMs?: number
  onEvent?: (event: ImageProviderEvent) => void | Promise<void>
}

const DEFAULT_MODEL = 'gpt-image-2-max'
const DEFAULT_SIZE = '1024x1536'
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_TIMEOUT_MS = 420_000

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function envNumber(name: string, fallback: number) {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function envOutputFormat(value?: string): 'png' | 'jpeg' | 'webp' | undefined {
  return value === 'png' || value === 'jpeg' || value === 'webp' ? value : undefined
}

function outputFormat(value?: string): 'png' | 'jpeg' | 'webp' | undefined {
  return value === 'png' || value === 'jpeg' || value === 'webp' ? value : undefined
}

function extensionForFormat(format?: string) {
  if (format === 'jpeg') return 'jpg'
  if (format === 'webp') return 'webp'
  return 'png'
}

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = trimTrailingSlash(baseUrl)
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function inferSizeFromAspectRatio(aspectRatio?: string) {
  switch (aspectRatio) {
    case '1:1':
      return '1024x1024'
    case '16:9':
      return '1792x1024'
    case '9:16':
      return '1024x1792'
    case '4:3':
      return '1024x768'
    case '3:4':
      return '768x1024'
    case '3:2':
      return '1536x1024'
    case '2:3':
      return '1024x1536'
    case '5:4':
      return '1280x1024'
    case '4:5':
      return '1024x1280'
    case '2:1':
      return '2048x1024'
    case '1:2':
      return '1024x2048'
    default:
      return DEFAULT_SIZE
  }
}

function supportsRatioSize(model: string) {
  return model === 'gpt-image-2-pro'
}

function supportsSeparateAspectRatio(model: string) {
  return model.startsWith('gemini-') || model.startsWith('imagen-')
}

function supportedRatio(aspectRatio?: string) {
  switch (aspectRatio) {
    case '1:1':
    case '16:9':
    case '9:16':
    case '4:3':
    case '3:4':
    case '3:2':
    case '2:3':
    case '5:4':
    case '4:5':
    case '2:1':
    case '1:2':
    case '21:9':
    case '9:21':
      return aspectRatio
    case '5:7':
      return '3:4'
    case '7:5':
      return '4:3'
    default:
      return aspectRatio
  }
}

function resolveSize(model: string, providerSize: string | undefined, defaultSize: string, aspectRatio?: string) {
  if (providerSize) return providerSize
  if (supportsSeparateAspectRatio(model)) {
    return defaultSize === DEFAULT_SIZE ? '1K' : defaultSize
  }
  if (supportsRatioSize(model)) return supportedRatio(aspectRatio) ?? defaultSize
  return inferSizeFromAspectRatio(aspectRatio) || defaultSize
}

function outputName(baseName: string | undefined, fallback: string, extension: string) {
  const raw = baseName?.trim() || fallback
  const safe = raw.replace(/[^a-zA-Z0-9._-]/g, '_')
  if (path.extname(safe)) return safe
  return `${safe}.${extension}`
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`NewAPI HTTP ${response.status}: ${text.slice(0, 800) || response.statusText}`)
  }
  return JSON.parse(text) as T
}

function getTaskId(response: AsyncSubmitResponse) {
  const taskId = response.data?.task_id ?? response.data?.id ?? response.task_id ?? response.id
  if (!taskId) {
    throw new Error(`NewAPI did not return task_id: ${JSON.stringify(response).slice(0, 800)}`)
  }
  return taskId
}

function isImageItem(value: unknown): value is ImageItem {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (typeof (value as ImageItem).url === 'string' || typeof (value as ImageItem).b64_json === 'string')
  )
}

function findImageItem(value: unknown): ImageItem | undefined {
  if (isImageItem(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const imageItem = findImageItem(item)
      if (imageItem) return imageItem
    }
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['data', 'images', 'output', 'result', 'image', 'url', 'b64_json']) {
    const imageItem = findImageItem(record[key])
    if (imageItem) return imageItem
  }
  return undefined
}

function firstImageItem(response: AsyncPollResponse) {
  return findImageItem(response)
}

function normalizedStatus(value?: string) {
  return value?.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function taskStatus(response: AsyncPollResponse) {
  return normalizedStatus(
    response.data?.status ??
      response.data?.task_status ??
      response.status ??
      response.task_status
  )
}

function taskProgress(response: AsyncPollResponse) {
  return response.data?.progress
}

function isSuccessStatus(status?: string) {
  return Boolean(
    status &&
      ['success', 'succeeded', 'succeed', 'completed', 'complete', 'done', 'finished'].includes(status)
  )
}

function isFailureStatus(status?: string) {
  return Boolean(
    status &&
      [
        'failure',
        'failed',
        'fail',
        'error',
        'errored',
        'cancelled',
        'canceled',
        'rejected',
        'timeout',
        'timed_out'
      ].includes(status)
  )
}

function requestOptions(
  defaults: Required<Pick<NewApiAsyncImageAdapterOptions, 'defaultModel' | 'defaultSize'>> &
    Pick<NewApiAsyncImageAdapterOptions, 'defaultQuality' | 'defaultOutputFormat'>,
  provider?: ImageGenerationProviderOptions,
  aspectRatio?: string
) {
  const model = provider?.model ?? defaults.defaultModel
  const outputFormat = provider?.outputFormat ?? defaults.defaultOutputFormat ?? 'png'
  return {
    model,
    size: resolveSize(
      model,
      provider?.size,
      defaults.defaultSize,
      provider?.aspectRatio ?? aspectRatio
    ),
    quality: provider?.quality ?? defaults.defaultQuality,
    responseFormat: provider?.responseFormat ?? 'url',
    outputFormat,
    outputCompression: provider?.outputCompression,
    background: provider?.background,
    moderation: provider?.moderation,
    resolution: provider?.resolution,
    aspectRatio: supportsSeparateAspectRatio(model)
      ? supportedRatio(provider?.aspectRatio ?? aspectRatio)
      : undefined,
    imageUrls: provider?.imageUrls,
    pollIntervalMs: provider?.pollIntervalMs,
    timeoutMs: provider?.timeoutMs
  }
}

function addIfDefined(target: Record<string, unknown>, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') return
  target[key] = value
}

function getCanvasHome(workspaceRoot: string) {
  const configuredHome = process.env.AI_DRAW_HOME ?? process.env.AI_CANVAS_HOME
  return configuredHome
    ? path.resolve(configuredHome)
    : path.join(workspaceRoot, '.ai-draw')
}

async function readImageProviderSettings(workspaceRoot?: string): Promise<ImageProviderSettings | undefined> {
  const root =
    workspaceRoot ??
    process.env.AI_DRAW_WORKSPACE_ROOT ??
    process.env.AI_CANVAS_WORKSPACE_ROOT ??
    process.cwd()
  const configPath = path.join(getCanvasHome(root), 'config.json')
  try {
    const raw = await readFile(configPath, 'utf8')
    const config = JSON.parse(raw) as { imageProvider?: ImageProviderSettings }
    return config.imageProvider
  } catch {
    return undefined
  }
}

export class NewApiAsyncImageAdapter {
  private readonly options: NewApiAsyncImageAdapterOptions

  constructor(options: NewApiAsyncImageAdapterOptions = {}) {
    this.options = options
  }

  static async isConfigured(workspaceRoot?: string) {
    const settings = await readImageProviderSettings(workspaceRoot)
    return Boolean(
      ((process.env.NEWAPI_BASE_URL || process.env.AI_CANVAS_IMAGE_BASE_URL || settings?.baseUrl) &&
        (process.env.NEWAPI_API_KEY || process.env.AI_CANVAS_IMAGE_API_KEY || settings?.apiKey))
    )
  }

  private async emit(event: ImageProviderEvent) {
    await this.options.onEvent?.(event)
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageResult> {
    const config = await this.resolveConfig()
    const options = requestOptions(
      {
        defaultModel: config.defaultModel,
        defaultSize: config.defaultSize,
        defaultQuality: config.defaultQuality,
        defaultOutputFormat: config.defaultOutputFormat
      },
      request.provider,
      request.aspectRatio
    )
    const payload: Record<string, unknown> = {
      model: options.model,
      prompt: request.prompt,
      n: 1
    }
    addIfDefined(payload, 'size', options.size)
    addIfDefined(payload, 'quality', options.quality)
    addIfDefined(payload, 'response_format', options.responseFormat)
    addIfDefined(payload, 'output_format', options.outputFormat)
    addIfDefined(payload, 'output_compression', options.outputCompression)
    addIfDefined(payload, 'background', options.background)
    addIfDefined(payload, 'moderation', options.moderation)
    addIfDefined(payload, 'resolution', options.resolution)
    addIfDefined(payload, 'aspect_ratio', options.aspectRatio)
    const imageUrls = [...(request.referenceImages ?? []), ...(options.imageUrls ?? [])]
    if (imageUrls.length > 0) addIfDefined(payload, 'image_urls', imageUrls)

    await this.emit({ stage: 'submit', message: 'Submitting image generation request.' })
    const submit = await this.postJson<AsyncSubmitResponse>(config, '/images/async/generations', payload)
    const taskId = getTaskId(submit)
    await this.emit({
      stage: 'submitted',
      taskId,
      status: submit.data?.status ?? submit.status,
      progress: submit.data?.progress
    })
    const result = await this.poll(config, taskId, options.timeoutMs, options.pollIntervalMs)
    const imageItem = firstImageItem(result)
    if (!imageItem) {
      throw new Error(`NewAPI task ${taskId} succeeded without image data.`)
    }
    const extension = extensionForFormat(options.outputFormat)
    const imagePath = await this.saveImageItem(
      imageItem,
      request.outputDir,
      outputName(request.outputName, `generated_${taskId}`, extension)
    )
    return {
      imagePath,
      width: 0,
      height: 0,
      model: options.model,
      raw: { taskId, submit, result }
    }
  }

  async editImage(request: ImageEditRequest): Promise<ImageResult> {
    const config = await this.resolveConfig()
    const options = requestOptions(
      {
        defaultModel: config.defaultModel,
        defaultSize: config.defaultSize,
        defaultQuality: config.defaultQuality,
        defaultOutputFormat: config.defaultOutputFormat
      },
      request.provider
    )
    const form = new FormData()
    form.append('model', options.model)
    form.append('prompt', request.prompt)
    form.append('n', '1')
    addFormValue(form, 'size', options.size)
    addFormValue(form, 'quality', options.quality)
    addFormValue(form, 'response_format', options.responseFormat)
    addFormValue(form, 'output_format', options.outputFormat)
    addFormValue(form, 'output_compression', options.outputCompression)
    addFormValue(form, 'background', options.background)
    addFormValue(form, 'moderation', options.moderation)
    addFormValue(form, 'resolution', options.resolution)
    addFormValue(form, 'aspect_ratio', options.aspectRatio)
    await appendFile(form, 'image', request.inputImagePath)
    for (const referenceImage of request.referenceImages ?? []) {
      await appendFile(form, 'reference_images[]', referenceImage)
    }
    if (request.maskPath) await appendFile(form, 'mask', request.maskPath)

    await this.emit({ stage: 'submit', message: 'Submitting image edit request.' })
    const submit = await this.postForm<AsyncSubmitResponse>(config, '/images/async/edits', form)
    const taskId = getTaskId(submit)
    await this.emit({
      stage: 'submitted',
      taskId,
      status: submit.data?.status ?? submit.status,
      progress: submit.data?.progress
    })
    const result = await this.poll(config, taskId, options.timeoutMs, options.pollIntervalMs)
    const imageItem = firstImageItem(result)
    if (!imageItem) {
      throw new Error(`NewAPI task ${taskId} succeeded without image data.`)
    }
    const extension = extensionForFormat(options.outputFormat)
    const imagePath = await this.saveImageItem(
      imageItem,
      request.outputDir,
      outputName(request.outputName, `edited_${taskId}`, extension)
    )
    return {
      imagePath,
      width: 0,
      height: 0,
      model: options.model,
      raw: { taskId, submit, result }
    }
  }

  async composeImages(request: ImageCompositionRequest): Promise<ImageResult> {
    if (request.inputImagePaths.length < 2) {
      throw new Error('At least two input images are required for composition.')
    }
    const config = await this.resolveConfig()
    const options = requestOptions(
      {
        defaultModel: config.defaultModel,
        defaultSize: config.defaultSize,
        defaultQuality: config.defaultQuality,
        defaultOutputFormat: config.defaultOutputFormat
      },
      request.provider
    )
    const form = new FormData()
    form.append('model', options.model)
    form.append('prompt', request.prompt)
    form.append('n', '1')
    addFormValue(form, 'size', options.size)
    addFormValue(form, 'quality', options.quality)
    addFormValue(form, 'response_format', options.responseFormat)
    addFormValue(form, 'output_format', options.outputFormat)
    addFormValue(form, 'output_compression', options.outputCompression)
    addFormValue(form, 'background', options.background)
    addFormValue(form, 'moderation', options.moderation)
    addFormValue(form, 'resolution', options.resolution)
    addFormValue(form, 'aspect_ratio', options.aspectRatio)
    for (const imagePath of request.inputImagePaths) {
      await appendFile(form, 'image[]', imagePath)
    }

    await this.emit({ stage: 'submit', message: 'Submitting image composition request.' })
    const submit = await this.postForm<AsyncSubmitResponse>(config, '/images/async/edits', form)
    const taskId = getTaskId(submit)
    await this.emit({
      stage: 'submitted',
      taskId,
      status: submit.data?.status ?? submit.status,
      progress: submit.data?.progress
    })
    const result = await this.poll(config, taskId, options.timeoutMs, options.pollIntervalMs)
    const imageItem = firstImageItem(result)
    if (!imageItem) {
      throw new Error(`NewAPI task ${taskId} succeeded without image data.`)
    }
    const extension = extensionForFormat(options.outputFormat)
    const imagePath = await this.saveImageItem(
      imageItem,
      request.outputDir,
      outputName(request.outputName, `composed_${taskId}`, extension)
    )
    return {
      imagePath,
      width: 0,
      height: 0,
      model: options.model,
      raw: { taskId, submit, result }
    }
  }

  private async resolveConfig() {
    const settings = await readImageProviderSettings(this.options.workspaceRoot)
    const baseUrl =
      this.options.baseUrl ??
      settings?.baseUrl ??
      process.env.NEWAPI_BASE_URL ??
      process.env.AI_CANVAS_IMAGE_BASE_URL
    const apiKey =
      this.options.apiKey ??
      settings?.apiKey ??
      process.env.NEWAPI_API_KEY ??
      process.env.AI_CANVAS_IMAGE_API_KEY
    if (!baseUrl || !apiKey) {
      throw new Error(
        'NewAPI image adapter is not configured. Open ai-draw and fill AI 操作 > 更多操作 > 图片接口设置, or set NEWAPI_BASE_URL and NEWAPI_API_KEY.'
      )
    }
    return {
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey,
      defaultModel:
        this.options.defaultModel ?? settings?.model ?? process.env.AI_CANVAS_IMAGE_MODEL ?? DEFAULT_MODEL,
      defaultSize:
        this.options.defaultSize ?? settings?.size ?? process.env.AI_CANVAS_IMAGE_SIZE ?? DEFAULT_SIZE,
      defaultQuality:
        this.options.defaultQuality ?? settings?.quality ?? process.env.AI_CANVAS_IMAGE_QUALITY,
      defaultOutputFormat:
        this.options.defaultOutputFormat ??
        outputFormat(settings?.outputFormat) ??
        envOutputFormat(process.env.AI_CANVAS_IMAGE_OUTPUT_FORMAT),
      pollIntervalMs:
        this.options.pollIntervalMs ??
        settings?.pollIntervalMs ??
        envNumber('AI_CANVAS_IMAGE_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS),
      timeoutMs:
        this.options.timeoutMs ??
        settings?.timeoutMs ??
        envNumber('AI_CANVAS_IMAGE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)
    }
  }

  private async postJson<T>(
    config: Awaited<ReturnType<NewApiAsyncImageAdapter['resolveConfig']>>,
    apiPath: string,
    payload: unknown
  ) {
    const response = await fetch(`${config.baseUrl}${apiPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    return parseJson<T>(response)
  }

  private async postForm<T>(
    config: Awaited<ReturnType<NewApiAsyncImageAdapter['resolveConfig']>>,
    apiPath: string,
    form: FormData
  ) {
    const response = await fetch(`${config.baseUrl}${apiPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`
      },
      body: form
    })
    return parseJson<T>(response)
  }

  private async poll(
    config: Awaited<ReturnType<NewApiAsyncImageAdapter['resolveConfig']>>,
    taskId: string,
    timeoutMs?: number,
    pollIntervalMs?: number
  ) {
    const deadline = Date.now() + (timeoutMs ?? config.timeoutMs)
    const interval = pollIntervalMs ?? config.pollIntervalMs
    let lastResponse: AsyncPollResponse | undefined
    while (Date.now() < deadline) {
      const response = await fetch(`${config.baseUrl}/images/async/${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${config.apiKey}` }
      })
      lastResponse = await parseJson<AsyncPollResponse>(response)
      const status = taskStatus(lastResponse)
      await this.emit({
        stage: 'poll',
        taskId,
        status,
        progress: taskProgress(lastResponse)
      })
      if (firstImageItem(lastResponse) || isSuccessStatus(status)) {
        await this.emit({
          stage: 'completed',
          taskId,
          status,
          progress: taskProgress(lastResponse),
          imageUrl: firstImageItem(lastResponse)?.url
        })
        return lastResponse
      }
      if (isFailureStatus(status)) {
        await this.emit({
          stage: 'failed',
          taskId,
          status,
          progress: taskProgress(lastResponse),
          message:
            lastResponse.data?.fail_reason ??
            lastResponse.fail_reason ??
            lastResponse.data?.message ??
            lastResponse.message
        })
        throw new Error(
          `NewAPI task ${taskId} failed: ${
            lastResponse.data?.fail_reason ??
            lastResponse.fail_reason ??
            lastResponse.data?.message ??
            lastResponse.message ??
            JSON.stringify(lastResponse)
          }`
        )
      }
      await new Promise((resolve) => setTimeout(resolve, interval))
    }
    throw new Error(`NewAPI task ${taskId} timed out. Last response: ${JSON.stringify(lastResponse)}`)
  }

  private async saveImageItem(
    item: NonNullable<ReturnType<typeof firstImageItem>>,
    outputDir: string,
    filename: string
  ) {
    await mkdir(outputDir, { recursive: true })
    const outputPath = path.join(outputDir, filename)
    if (item.url) {
      await this.emit({ stage: 'download', imageUrl: item.url, message: 'Downloading generated image.' })
      const response = await fetch(item.url, {
        headers: { 'User-Agent': 'AI-Canvas/0.1' }
      })
      if (!response.ok) {
        throw new Error(`Could not download NewAPI image: HTTP ${response.status}`)
      }
      const bytes = new Uint8Array(await response.arrayBuffer())
      await writeFile(outputPath, bytes)
      await this.emit({ stage: 'saved', imageUrl: item.url, imagePath: outputPath })
      return outputPath
    }
    if (item.b64_json) {
      const bytes = Buffer.from(item.b64_json, 'base64')
      await writeFile(outputPath, bytes)
      await this.emit({ stage: 'saved', imagePath: outputPath })
      return outputPath
    }
    throw new Error('NewAPI image item did not include url or b64_json.')
  }
}

function addFormValue(form: FormData, key: string, value: unknown) {
  if (value === undefined || value === null || value === '') return
  form.append(key, String(value))
}

async function appendFile(form: FormData, key: string, filePath: string) {
  const data = await readFile(filePath)
  const filename = path.basename(filePath)
  form.append(key, new Blob([data]), filename)
}
