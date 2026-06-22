import type {
  CanvasMetadata,
  CanvasEditRequest,
  CanvasPendingOperation,
  CanvasStatePayload,
  EditRequestStatus,
  EditRequestQueueStatus,
  ImageProviderEvent,
  ImageProviderSettings,
  ImageProviderSettingsStatus,
  PreparedAnnotationEdit,
  RunRecord,
  SelectionSnapshot,
  ShapeSummary
} from '@ai-canvas/shared'
import {
  buildAnnotationEditPrompt,
  imageProviderSettingsSchema,
  NewApiAsyncImageAdapter,
  parseAnnotations
} from '@ai-canvas/shared'
import express from 'express'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { access, appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'
import { WebSocket, WebSocketServer } from 'ws'

type PendingCommand = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

type CanvasSession = {
  workspaceRoot: string
  canvasId: string
  storagePath: string
  metadata: CanvasMetadata
  snapshot?: unknown
  selection: SelectionSnapshot
  shapes: ShapeSummary[]
  pendingOperations: CanvasPendingOperation[]
}

type CanvasConfig = {
  version: string
  defaultPort: number
  storageMode: 'local'
  imageModel: string
  defaultCanvasName: string
  assetPolicy: {
    copyExternalImages: boolean
    generateThumbnails: boolean
    keepAllVersions: boolean
  }
  imageProvider?: ImageProviderSettings
}

type CanvasProgressEvent = {
  eventId: string
  createdAt: string
  requestId?: string
  source: 'canvas_service' | 'provider' | 'codex'
  stage: string
  status?: string
  progress?: string
  message: string
  details?: Record<string, unknown>
}

const APP_VERSION = '0.1.0'
const FEATURES = ['annotationEditRequests', 'editRequestQueue', 'offlineCanvasSync']
const LISTENER_ACTIVE_WINDOW_MS = 75_000
const DEFAULT_PORT = Number(process.env.AI_DRAW_PORT ?? process.env.AI_CANVAS_PORT ?? 43218)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = findPluginRoot(__dirname)
const clientDist = path.resolve(pluginRoot, 'packages/canvas-app/dist/client')
const clientIndex = path.join(clientDist, 'index.html')
const pendingCommands = new Map<string, PendingCommand>()
const clients = new Set<WebSocket>()

let session: CanvasSession | undefined
let codexListenerLastSeenAt: string | undefined
let canvasWorkerRunning = false

function nowIso() {
  return new Date().toISOString()
}

function parseArgs(argv: string[]) {
  const args = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const value = argv[index + 1]?.startsWith('--') ? 'true' : argv[index + 1] ?? 'true'
    args.set(key, value)
  }
  return args
}

function findPluginRoot(startPath: string) {
  let current = startPath
  for (let index = 0; index < 8; index += 1) {
    const packageJsonPath = path.join(current, 'package.json')
    if (existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(String(readFileSync(packageJsonPath)))
        if (packageJson.name === 'ai-draw') return current
      } catch {
        // Keep walking.
      }
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return path.resolve(startPath, '../../..')
}

function slugId(prefix: string) {
  return `${prefix}_${nanoid(10)}`
}

async function exists(targetPath: string) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(targetPath: string): Promise<T | undefined> {
  if (!(await exists(targetPath))) return undefined
  const raw = await readFile(targetPath, 'utf8')
  return JSON.parse(raw) as T
}

async function writeJson(targetPath: string, value: unknown) {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readJsonLines<T>(targetPath: string): Promise<T[]> {
  if (!(await exists(targetPath))) return []
  const raw = await readFile(targetPath, 'utf8')
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

function ensureInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes canvas storage: ${candidate}`)
  }
}

function getCanvasHome(workspaceRoot: string) {
  const configuredHome = process.env.AI_DRAW_HOME ?? process.env.AI_CANVAS_HOME
  return configuredHome
    ? path.resolve(configuredHome)
    : path.join(workspaceRoot, '.ai-draw')
}

function canvasConfigPath(workspaceRoot: string) {
  return path.join(getCanvasHome(workspaceRoot), 'config.json')
}

function defaultCanvasConfig(existing?: Partial<CanvasConfig>): CanvasConfig {
  return {
    version: APP_VERSION,
    defaultPort: DEFAULT_PORT,
    storageMode: 'local',
    imageModel: 'newapi-async',
    defaultCanvasName: 'Untitled ai-draw',
    assetPolicy: {
      copyExternalImages: true,
      generateThumbnails: false,
      keepAllVersions: true
    },
    imageProvider: existing?.imageProvider
  }
}

function providerStatus(settings?: ImageProviderSettings): ImageProviderSettingsStatus {
  return {
    baseUrl: settings?.baseUrl,
    model: settings?.model,
    size: settings?.size,
    quality: settings?.quality,
    outputFormat: settings?.outputFormat,
    pollIntervalMs: settings?.pollIntervalMs,
    timeoutMs: settings?.timeoutMs,
    updatedAt: settings?.updatedAt,
    hasApiKey: Boolean(settings?.apiKey)
  }
}

function cleanOptionalString(value: unknown) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function imageExtension(mimeType?: string) {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return '.png'
}

function safeAssetBaseName(name?: string) {
  const base = path.basename(name || 'reference').replace(/\.[^.]+$/, '')
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'reference'
}

async function readCanvasConfig(workspaceRoot: string) {
  const existing = await readJson<Partial<CanvasConfig>>(canvasConfigPath(workspaceRoot))
  return defaultCanvasConfig(existing)
}

async function writeCanvasConfig(workspaceRoot: string, config: CanvasConfig) {
  await writeJson(canvasConfigPath(workspaceRoot), config)
}

async function readImageProviderSettings() {
  if (!session) throw new Error('Canvas session is not open')
  const config = await readCanvasConfig(session.workspaceRoot)
  return config.imageProvider
}

async function updateImageProviderSettings(input: unknown) {
  if (!session) throw new Error('Canvas session is not open')
  const parsed = imageProviderSettingsSchema.parse(input ?? {})
  const config = await readCanvasConfig(session.workspaceRoot)
  const existing = config.imageProvider ?? {}
  const apiKey = typeof parsed.apiKey === 'string' && parsed.apiKey.trim() ? parsed.apiKey.trim() : existing.apiKey
  const imageProvider: ImageProviderSettings = {
    baseUrl: cleanOptionalString(parsed.baseUrl),
    apiKey,
    model: cleanOptionalString(parsed.model),
    size: cleanOptionalString(parsed.size),
    quality: cleanOptionalString(parsed.quality),
    outputFormat: parsed.outputFormat,
    pollIntervalMs: parsed.pollIntervalMs,
    timeoutMs: parsed.timeoutMs,
    updatedAt: nowIso()
  }
  config.imageProvider = imageProvider
  await writeCanvasConfig(session.workspaceRoot, config)
  return providerStatus(imageProvider)
}

async function ensureCanvasDirs(storagePath: string) {
  await mkdir(path.join(storagePath, 'assets/images'), { recursive: true })
  await mkdir(path.join(storagePath, 'assets/thumbnails'), { recursive: true })
  await mkdir(path.join(storagePath, 'runs'), { recursive: true })
  await mkdir(path.join(storagePath, 'exports'), { recursive: true })
  await mkdir(path.join(storagePath, 'requests'), { recursive: true })
  await mkdir(path.join(storagePath, 'operations'), { recursive: true })
  await mkdir(path.join(storagePath, 'logs'), { recursive: true })
}

async function openSession(input: { workspaceRoot?: string; canvasId?: string }) {
  const workspaceRoot = path.resolve(
    input.workspaceRoot ??
      process.env.AI_DRAW_WORKSPACE_ROOT ??
      process.env.AI_CANVAS_WORKSPACE_ROOT ??
      process.cwd()
  )
  const canvasId =
    input.canvasId ?? process.env.AI_DRAW_CANVAS_ID ?? process.env.AI_CANVAS_CANVAS_ID ?? slugId('canvas')
  const canvasHome = getCanvasHome(workspaceRoot)
  const storagePath = path.join(canvasHome, 'canvases', canvasId)
  ensureInside(canvasHome, storagePath)
  await ensureCanvasDirs(storagePath)

  const metadataPath = path.join(storagePath, 'metadata.json')
  const existingMetadata = await readJson<CanvasMetadata>(metadataPath)
  const existingSummary = await readJson<{
    selection?: SelectionSnapshot
    shapes?: ShapeSummary[]
  }>(path.join(storagePath, 'state-summary.json'))
  const pendingOperations =
    (await readJson<CanvasPendingOperation[]>(
      path.join(storagePath, 'operations', 'pending.json')
    )) ?? []
  const metadata: CanvasMetadata = existingMetadata
    ? {
        ...existingMetadata,
        name:
          existingMetadata.name === 'Untitled AI Canvas'
            ? 'Untitled ai-draw'
            : existingMetadata.name
      }
    : {
    canvasId,
    name: 'Untitled ai-draw',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    workspaceRoot,
    activePageId: 'page:page',
    appVersion: APP_VERSION
  }

  const snapshot = await readJson<unknown>(path.join(storagePath, 'canvas.json'))
  const selection: SelectionSnapshot = existingSummary?.selection ?? {
    canvasId,
    pageId: metadata.activePageId,
    selectedShapeIds: [],
    shapes: []
  }

  session = {
    workspaceRoot,
    canvasId,
    storagePath,
    metadata,
    snapshot,
    selection,
    shapes: existingSummary?.shapes ?? [],
    pendingOperations
  }

  await writeCanvasConfig(workspaceRoot, await readCanvasConfig(workspaceRoot))
  await persistSession()
  return session
}

async function persistSession() {
  if (!session) return
  session.metadata.updatedAt = nowIso()
  await writeJson(path.join(session.storagePath, 'metadata.json'), session.metadata)
  if (session.snapshot) {
    await writeJson(path.join(session.storagePath, 'canvas.json'), session.snapshot)
  }
  await writeJson(path.join(session.storagePath, 'state-summary.json'), {
    selection: session.selection,
    shapes: session.shapes,
    updatedAt: session.metadata.updatedAt
  })
  await writeJson(
    path.join(session.storagePath, 'operations', 'pending.json'),
    session.pendingOperations
  )
}

function statePayload(): CanvasStatePayload {
  if (!session) {
    throw new Error('Canvas session is not open')
  }
  return {
    canvasId: session.canvasId,
    metadata: session.metadata,
    storagePath: session.storagePath,
    snapshot: session.snapshot,
    selection: session.selection,
    shapes: session.shapes,
    pendingOperations: session.pendingOperations
  }
}

function sendCommand(command: string, payload: Record<string, unknown>) {
  const openClients = [...clients].filter((client) => client.readyState === WebSocket.OPEN)
  if (openClients.length === 0) {
    throw new Error('Canvas browser is not connected yet')
  }

  const id = nanoid()
  const message = JSON.stringify({ type: 'command', id, command, payload })
  const promise = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(id)
      reject(new Error(`Canvas command timed out: ${command}`))
    }, 12_000)
    pendingCommands.set(id, { resolve, reject, timer })
  })
  openClients[0].send(message)
  return promise
}

function hasCanvasClient() {
  return [...clients].some((client) => client.readyState === WebSocket.OPEN)
}

function makeShapeId(prefix: string) {
  return `shape:${prefix}_${nanoid(8)}`
}

function upsertShapeSummary(shape: ShapeSummary) {
  if (!session) throw new Error('Canvas session is not open')
  const index = session.shapes.findIndex((item) => item.id === shape.id)
  if (index >= 0) session.shapes[index] = shape
  else session.shapes.push(shape)
}

function selectShapeSummary(shape: ShapeSummary) {
  if (!session) throw new Error('Canvas session is not open')
  session.selection = {
    canvasId: session.canvasId,
    pageId: session.metadata.activePageId,
    selectedShapeIds: [shape.id],
    shapes: [shape]
  }
}

function queuePendingOperation(
  type: CanvasPendingOperation['type'],
  payload: Record<string, unknown>
) {
  if (!session) throw new Error('Canvas session is not open')
  const operation: CanvasPendingOperation = {
    id: slugId('op'),
    type,
    payload,
    createdAt: nowIso()
  }
  session.pendingOperations.push(operation)
  return operation
}

async function copyImageIntoCanvas(imagePath: string) {
  if (!session) throw new Error('Canvas session is not open')
  const source = path.resolve(imagePath)
  await access(source)
  const safeName = path.basename(source).replace(/[^a-zA-Z0-9._-]/g, '_')
  const ext = path.extname(safeName) || '.png'
  const targetName = `${path.basename(safeName, ext)}_${Date.now()}${ext}`
  const targetPath = path.join(session.storagePath, 'assets/images', targetName)
  ensureInside(session.storagePath, targetPath)
  await copyFile(source, targetPath)
  return {
    absolutePath: targetPath,
    assetPath: `assets/images/${targetName}`,
    assetUrl: `/api/canvas/asset-file/images/${encodeURIComponent(targetName)}`
  }
}

async function saveUploadedImageIntoCanvas(input: {
  name?: string
  mimeType?: string
  data: string
}) {
  if (!session) throw new Error('Canvas session is not open')
  const base64 = input.data.includes(',') ? input.data.split(',').at(-1) : input.data
  if (!base64) throw new Error('Uploaded image is empty.')
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length === 0) throw new Error('Uploaded image is empty.')
  const extension = imageExtension(input.mimeType)
  const targetName = `${safeAssetBaseName(input.name)}_${Date.now()}_${crypto
    .randomUUID()
    .slice(0, 8)}${extension}`
  const targetPath = path.join(session.storagePath, 'assets/images', targetName)
  ensureInside(session.storagePath, targetPath)
  await writeFile(targetPath, bytes)
  return {
    absolutePath: targetPath,
    assetPath: `assets/images/${targetName}`,
    assetUrl: `/api/canvas/asset-file/images/${encodeURIComponent(targetName)}`,
    mimeType: input.mimeType || 'image/png'
  }
}

async function writeRun(record: Omit<RunRecord, 'createdAt'>) {
  if (!session) throw new Error('Canvas session is not open')
  const createdAt = nowIso()
  const run: RunRecord = { ...record, createdAt }
  await writeJson(path.join(session.storagePath, 'runs', `${record.runId}.json`), run)
  return run
}

function eventLogPath(requestId?: string) {
  if (!session) throw new Error('Canvas session is not open')
  if (!requestId) return path.join(session.storagePath, 'logs', 'events.jsonl')
  const safeId = requestId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const targetPath = path.join(session.storagePath, 'requests', `${safeId}.events.jsonl`)
  ensureInside(session.storagePath, targetPath)
  return targetPath
}

async function writeProgressEvent(input: Omit<CanvasProgressEvent, 'eventId' | 'createdAt'>) {
  if (!session) throw new Error('Canvas session is not open')
  const event: CanvasProgressEvent = {
    eventId: slugId('event'),
    createdAt: nowIso(),
    ...input
  }
  const line = `${JSON.stringify(event)}\n`
  await mkdir(path.join(session.storagePath, 'logs'), { recursive: true })
  await appendFile(eventLogPath(), line, 'utf8')
  if (event.requestId) await appendFile(eventLogPath(event.requestId), line, 'utf8')
  return event
}

async function readProgressEvents(requestId?: string) {
  if (!session) throw new Error('Canvas session is not open')
  const events = await readJsonLines<CanvasProgressEvent>(eventLogPath(requestId))
  return events.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function providerEventMessage(event: ImageProviderEvent) {
  switch (event.stage) {
    case 'submit':
      return '正在提交图片编辑请求。'
    case 'submitted':
      return `已提交到图片 API${event.taskId ? `，任务 ${event.taskId}` : ''}。`
    case 'poll':
      return `图片 API 处理中${event.progress ? `，进度 ${event.progress}` : ''}。`
    case 'completed':
      return '图片 API 已完成。'
    case 'failed':
      return event.message ?? '图片 API 任务失败。'
    case 'download':
      return '正在下载生成图片。'
    case 'saved':
      return '生成图片已保存到画布资源目录。'
    default:
      return event.message ?? event.stage
  }
}

async function createImageHolderOffline(payload: Record<string, unknown>) {
  if (!session) throw new Error('Canvas session is not open')
  const shapeId = String(payload.shapeId ?? makeShapeId('holder'))
  const x = Number(payload.x ?? 100)
  const y = Number(payload.y ?? 100)
  const w = Number(payload.w ?? 403)
  const h = Number(payload.h ?? 567)
  const label = String(payload.label ?? 'AI 图片')
  const aspectRatio = String(payload.aspectRatio ?? '5:7')
  const shape: ShapeSummary = {
    id: shapeId,
    type: 'geo',
    role: 'image_holder',
    bounds: { x, y, w, h },
    text: label,
    color: 'blue',
    aspectRatio,
    meta: {
      aiCanvasRole: 'image_holder',
      aspectRatio,
      acceptsGeneratedImage: true,
      title: label
    }
  }
  upsertShapeSummary(shape)
  selectShapeSummary(shape)
  queuePendingOperation('create_image_holder', {
    ...payload,
    shapeId,
    x,
    y,
    w,
    h,
    label,
    aspectRatio
  })
  await persistSession()
  return { shapeId, bounds: shape.bounds, pendingSync: true }
}

async function insertImageIntoHolderOffline(payload: Record<string, unknown>) {
  if (!session) throw new Error('Canvas session is not open')
  const holderShapeId = String(payload.holderShapeId)
  const holder = session.shapes.find((shape) => shape.id === holderShapeId)
  if (!holder) throw new Error(`Holder not found: ${holderShapeId}`)
  const imageShapeId = String(payload.imageShapeId ?? makeShapeId('image'))
  const title = String(payload.title ?? holder.meta?.title ?? 'AI 图片')
  const shape: ShapeSummary = {
    id: imageShapeId,
    type: 'image',
    role: 'ai_image',
    bounds: holder.bounds,
    assetPath: String(payload.assetPath),
    assetUrl: String(payload.assetUrl),
    version: 1,
    meta: {
      aiCanvasRole: 'ai_image',
      holderId: holderShapeId,
      sourceRunId: payload.runId ? String(payload.runId) : undefined,
      version: 1,
      assetPath: String(payload.assetPath),
      title
    }
  }
  upsertShapeSummary(shape)
  selectShapeSummary(shape)
  queuePendingOperation('insert_image_into_holder', {
    ...payload,
    holderShapeId,
    imageShapeId,
    title
  })
  await persistSession()
  return {
    imageShapeId,
    assetId: undefined,
    assetPath: payload.assetPath,
    bounds: holder.bounds,
    version: 1,
    pendingSync: true
  }
}

async function createImageVersionOffline(payload: Record<string, unknown>) {
  if (!session) throw new Error('Canvas session is not open')
  const sourceShapeId = String(payload.sourceShapeId)
  const source = session.shapes.find((shape) => shape.id === sourceShapeId)
  if (!source) throw new Error(`Source image not found: ${sourceShapeId}`)
  const sourceVersion = Number(source.version ?? source.meta?.version ?? 1)
  const version = sourceVersion + 1
  const placement = String(payload.placement ?? 'right')
  const x = placement === 'replace' ? source.bounds.x : source.bounds.x + source.bounds.w + 80
  const y = source.bounds.y
  const newShapeId = String(payload.newShapeId ?? makeShapeId('image'))
  const arrowShapeId = String(payload.arrowShapeId ?? makeShapeId('version_arrow'))
  const title = String(payload.title ?? `AI 图片 v${version}`)
  const imageShape: ShapeSummary = {
    id: newShapeId,
    type: 'image',
    role: 'ai_image',
    bounds: { x, y, w: source.bounds.w, h: source.bounds.h },
    assetPath: String(payload.assetPath),
    assetUrl: String(payload.assetUrl),
    version,
    parentShapeId: sourceShapeId,
    meta: {
      aiCanvasRole: 'ai_image',
      holderId: source.meta?.holderId,
      parentShapeId: sourceShapeId,
      sourceRunId: payload.runId ? String(payload.runId) : undefined,
      version,
      assetPath: String(payload.assetPath),
      title
    }
  }
  const arrowShape: ShapeSummary = {
    id: arrowShapeId,
    type: 'arrow',
    role: 'version_group',
    bounds: {
      x: source.bounds.x + source.bounds.w + 20,
      y: source.bounds.y + source.bounds.h / 2,
      w: 42,
      h: 1
    },
    parentShapeId: sourceShapeId,
    arrowStart: {
      x: source.bounds.x + source.bounds.w + 20,
      y: source.bounds.y + source.bounds.h / 2
    },
    arrowEnd: {
      x: source.bounds.x + source.bounds.w + 62,
      y: source.bounds.y + source.bounds.h / 2
    },
    meta: {
      aiCanvasRole: 'version_group',
      parentShapeId: sourceShapeId
    }
  }
  upsertShapeSummary(imageShape)
  upsertShapeSummary(arrowShape)
  selectShapeSummary(imageShape)
  queuePendingOperation('create_image_version', {
    ...payload,
    sourceShapeId,
    newShapeId,
    arrowShapeId,
    title,
    version,
    placement
  })
  await persistSession()
  return {
    newShapeId,
    assetId: undefined,
    assetPath: payload.assetPath,
    version,
    parentShapeId: sourceShapeId,
    pendingSync: true
  }
}

async function insertReferenceImageOffline(payload: Record<string, unknown>) {
  if (!session) throw new Error('Canvas session is not open')
  const shapeId = String(payload.shapeId ?? makeShapeId('reference'))
  const index = Number(payload.index ?? 0)
  const x = Number(payload.x ?? 120 + index * 32)
  const y = Number(payload.y ?? 740 + index * 32)
  const w = Number(payload.w ?? 220)
  const h = Number(payload.h ?? 220)
  const title = String(payload.title ?? '参考图')
  const shape: ShapeSummary = {
    id: shapeId,
    type: 'image',
    role: 'reference_image',
    bounds: { x, y, w, h },
    assetPath: String(payload.assetPath),
    assetUrl: String(payload.assetUrl),
    meta: {
      aiCanvasRole: 'reference_image',
      sourceRunId: payload.runId ? String(payload.runId) : undefined,
      assetPath: String(payload.assetPath),
      title
    }
  }
  upsertShapeSummary(shape)
  selectShapeSummary(shape)
  queuePendingOperation('insert_reference_image', {
    ...payload,
    shapeId,
    x,
    y,
    w,
    h,
    title
  })
  await persistSession()
  return {
    shapeId,
    assetId: undefined,
    assetPath: payload.assetPath,
    bounds: shape.bounds,
    pendingSync: true
  }
}

function absoluteCanvasPath(relativePath?: string) {
  if (!session || !relativePath) return undefined
  const absolute = path.join(session.storagePath, relativePath)
  ensureInside(session.storagePath, absolute)
  return absolute
}

function referenceImagePaths(excludeShapeId?: string) {
  if (!session) return []
  return session.shapes
    .filter((shape) => shape.role === 'reference_image' && shape.id !== excludeShapeId)
    .map((shape) => absoluteCanvasPath(shape.assetPath ?? shape.meta?.assetPath))
    .filter((imagePath): imagePath is string => Boolean(imagePath))
}

function composeReferencePrompt(input: { prompt?: string; count: number }) {
  return [
    '请把多张参考图片作为同等重要的主输入，合成为一张新的完整图片。',
    input.prompt ? `用户要求：${input.prompt}` : undefined,
    `参考图片数量：${input.count}`,
    '合成要求：融合主体、材质、风格、色彩和构图信息；不要只复制某一张；不要把参考图做成拼贴或九宫格，除非用户明确要求。',
    '输出要求：画面完整自然，主体清晰，适合继续在画布中标注修改。'
  ]
    .filter(Boolean)
    .join('\n')
}

function isImageNode(shape: ShapeSummary) {
  return shape.role === 'reference_image' || shape.role === 'ai_image' || shape.type === 'image'
}

function shapeCenter(shape: ShapeSummary) {
  return {
    x: shape.bounds.x + shape.bounds.w / 2,
    y: shape.bounds.y + shape.bounds.h / 2
  }
}

function distanceToPoint(shape: ShapeSummary, point: { x: number; y: number }) {
  const center = shapeCenter(shape)
  return Math.hypot(center.x - point.x, center.y - point.y)
}

function nearestShapeToPoint(shapes: ShapeSummary[], point?: { x: number; y: number }, maxDistance = 220) {
  if (!point) return undefined
  return shapes
    .map((shape) => ({ shape, distance: distanceToPoint(shape, point) }))
    .filter((item) => item.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)[0]?.shape
}

function parseWorkflowTasks() {
  if (!session) throw new Error('Canvas session is not open')
  const images = session.shapes.filter(isImageNode)
  const texts = session.shapes.filter((shape) => Boolean(shape.text?.trim()))
  const arrows = session.shapes.filter((shape) => shape.type === 'arrow' && shape.arrowStart && shape.arrowEnd)
  const groups = new Map<
    string,
    {
      promptShape: ShapeSummary
      sourceShapes: ShapeSummary[]
      arrowIds: string[]
    }
  >()

  for (const arrow of arrows) {
    const source = nearestShapeToPoint(images, arrow.arrowStart, 260)
    const promptShape = nearestShapeToPoint(texts, arrow.arrowEnd, 260)
    if (!source || !promptShape) continue
    const current =
      groups.get(promptShape.id) ??
      {
        promptShape,
        sourceShapes: [],
        arrowIds: []
      }
    if (!current.sourceShapes.some((shape) => shape.id === source.id)) {
      current.sourceShapes.push(source)
    }
    current.arrowIds.push(arrow.id)
    groups.set(promptShape.id, current)
  }

  return [...groups.values()].filter((task) => task.sourceShapes.length > 0 && task.promptShape.text?.trim())
}

async function runWorkflowTask(input: {
  sourceShapes: ShapeSummary[]
  promptShape: ShapeSummary
  index: number
}) {
  if (!session) throw new Error('Canvas session is not open')
  const imagePaths = input.sourceShapes
    .map((shape) => absoluteCanvasPath(shape.assetPath ?? shape.meta?.assetPath))
    .filter((imagePath): imagePath is string => Boolean(imagePath))
  if (imagePaths.length === 0) throw new Error('流程节点缺少可用图片。')
  const prompt = String(input.promptShape.text ?? '').trim()
  const runId = slugId('workflow')
  const adapter = new NewApiAsyncImageAdapter({ workspaceRoot: session.workspaceRoot })
  const outputDir = path.join(session.storagePath, 'assets/images')
  const image =
    imagePaths.length === 1
      ? await adapter.editImage({
          prompt,
          inputImagePath: imagePaths[0],
          outputDir,
          outputName: `${runId}_${input.index + 1}_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
        })
      : await adapter.composeImages({
          prompt: composeReferencePrompt({ prompt, count: imagePaths.length }),
          inputImagePaths: imagePaths,
          outputDir,
          outputName: `${runId}_${input.index + 1}_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
        })
  const copied = await copyImageIntoCanvas(image.imagePath)
  const maxX = Math.max(...input.sourceShapes.map((shape) => shape.bounds.x + shape.bounds.w), input.promptShape.bounds.x + input.promptShape.bounds.w)
  const minY = Math.min(...input.sourceShapes.map((shape) => shape.bounds.y), input.promptShape.bounds.y)
  const commandPayload = {
    sourceShapeIds: input.sourceShapes.map((shape) => shape.id),
    x: maxX + 80,
    y: minY,
    w: 420,
    h: 560,
    title: `流程结果 ${input.index + 1}`,
    runId,
    ...copied
  }
  const inserted = hasCanvasClient()
    ? await sendCommand('insert_composite_image', commandPayload)
    : await insertCompositeImageOffline(commandPayload)
  await writeRun({
    runId,
    type: 'run_workflow',
    model: 'external',
    input: {
      sourceShapeIds: input.sourceShapes.map((shape) => shape.id),
      promptShapeId: input.promptShape.id,
      prompt,
      imagePaths
    },
    output: {
      imagePath: image.imagePath,
      inserted
    }
  })
  return {
    runId,
    prompt,
    sourceShapeIds: input.sourceShapes.map((shape) => shape.id),
    imagePath: image.imagePath,
    inserted
  }
}

async function insertCompositeImageOffline(payload: Record<string, unknown>) {
  if (!session) throw new Error('Canvas session is not open')
  const sourceShapeIds = Array.isArray(payload.sourceShapeIds)
    ? payload.sourceShapeIds.map((id) => String(id))
    : []
  const sourceShapes = session.shapes.filter((shape) => sourceShapeIds.includes(shape.id))
  const maxX = sourceShapes.length
    ? Math.max(...sourceShapes.map((shape) => shape.bounds.x + shape.bounds.w))
    : 120
  const minY = sourceShapes.length ? Math.min(...sourceShapes.map((shape) => shape.bounds.y)) : 120
  const shapeId = String(payload.shapeId ?? makeShapeId('image'))
  const w = Number(payload.w ?? 420)
  const h = Number(payload.h ?? 560)
  const x = Number(payload.x ?? maxX + 80)
  const y = Number(payload.y ?? minY)
  const title = String(payload.title ?? '合成图片')
  const shape: ShapeSummary = {
    id: shapeId,
    type: 'image',
    role: 'ai_image',
    bounds: { x, y, w, h },
    assetPath: String(payload.assetPath),
    assetUrl: String(payload.assetUrl),
    version: 1,
    meta: {
      aiCanvasRole: 'ai_image',
      sourceRunId: payload.runId ? String(payload.runId) : undefined,
      version: 1,
      assetPath: String(payload.assetPath),
      title
    }
  }
  upsertShapeSummary(shape)
  selectShapeSummary(shape)
  queuePendingOperation('insert_composite_image', {
    ...payload,
    shapeId,
    sourceShapeIds,
    x,
    y,
    w,
    h,
    title
  })
  await persistSession()
  return {
    shapeId,
    assetId: undefined,
    assetPath: payload.assetPath,
    bounds: shape.bounds,
    pendingSync: true
  }
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function renderExportSvg(shapeIds?: string[]) {
  if (!session) throw new Error('Canvas session is not open')
  const selected = shapeIds?.length
    ? session.shapes.filter((shape) => shapeIds.includes(shape.id))
    : session.shapes
  const shapes = selected.length > 0 ? selected : session.shapes
  const minX = Math.min(...shapes.map((shape) => shape.bounds.x), 0)
  const minY = Math.min(...shapes.map((shape) => shape.bounds.y), 0)
  const maxX = Math.max(...shapes.map((shape) => shape.bounds.x + shape.bounds.w), 1200)
  const maxY = Math.max(...shapes.map((shape) => shape.bounds.y + shape.bounds.h), 800)
  const pad = 80
  const width = maxX - minX + pad * 2
  const height = maxY - minY + pad * 2
  const offsetX = -minX + pad
  const offsetY = -minY + pad
  const body = shapes
    .map((shape) => {
      const x = shape.bounds.x + offsetX
      const y = shape.bounds.y + offsetY
      if (shape.type === 'image' && shape.assetUrl) {
        return `<image href="${escapeXml(shape.assetUrl)}" x="${x}" y="${y}" width="${shape.bounds.w}" height="${shape.bounds.h}" preserveAspectRatio="xMidYMid meet" />`
      }
      if (shape.type === 'arrow' && shape.arrowStart && shape.arrowEnd) {
        return `<line x1="${shape.arrowStart.x + offsetX}" y1="${shape.arrowStart.y + offsetY}" x2="${shape.arrowEnd.x + offsetX}" y2="${shape.arrowEnd.y + offsetY}" stroke="#d92d20" stroke-width="4" marker-end="url(#arrow)" />`
      }
      if (shape.text) {
        return `<text x="${x}" y="${y + 24}" fill="#b42318" font-family="Inter, Arial" font-size="24" font-weight="700">${escapeXml(shape.text)}</text>`
      }
      const stroke = shape.role === 'image_holder' ? '#2563eb' : '#d92d20'
      const dash = shape.role === 'image_holder' ? '8 8' : '4 5'
      return `<rect x="${x}" y="${y}" width="${shape.bounds.w}" height="${shape.bounds.h}" fill="none" stroke="${stroke}" stroke-width="3" stroke-dasharray="${dash}" rx="8" />`
    })
    .join('\n')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#d92d20" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff" />
  ${body}
</svg>`
}

function canAutoEdit(result: PreparedAnnotationEdit) {
  return Boolean(result.inputImagePath && result.annotationPlan.length > 0 && result.targetShapeId)
}

function touchCodexListener() {
  codexListenerLastSeenAt = nowIso()
}

function isCodexListenerActive() {
  if (!codexListenerLastSeenAt) return false
  return Date.now() - Date.parse(codexListenerLastSeenAt) <= LISTENER_ACTIVE_WINDOW_MS
}

function isCanvasWorkerActive() {
  return canvasWorkerRunning
}

async function prepareAnnotationEditFromBody(body: Record<string, unknown>) {
  if (!session) throw new Error('Canvas session is not open')
  const radius = Number(body?.radius ?? 300)
  const targetShapeId = body?.targetShapeId ? String(body.targetShapeId) : undefined
  const userRequest = body?.userRequest ? String(body.userRequest) : undefined
  const includeScreenshot = body?.includeScreenshot !== false
  const state = statePayload()
  const plan = parseAnnotations({
    state,
    targetShapeId,
    radius,
    excludeShapeIds: await consumedAnnotationShapeIds()
  })
  const target = state.shapes.find((shape) => shape.id === plan.targetShapeId)

  if (includeScreenshot && plan.targetShapeId) {
    const exportId = slugId('annotated_view')
    const shapeIds = [
      plan.targetShapeId,
      ...plan.annotationPlan.flatMap((annotation) => annotation.sourceShapeIds)
    ]
    const svg = renderExportSvg(shapeIds)
    const outputPath = path.join(session.storagePath, 'exports', `${exportId}.svg`)
    ensureInside(session.storagePath, outputPath)
    await writeFile(outputPath, svg, 'utf8')
    await writeJson(path.join(session.storagePath, 'exports', `${exportId}.json`), {
      exportId,
      sourceShapeIds: shapeIds,
      outputPath: path.relative(session.storagePath, outputPath),
      createdAt: nowIso()
    })
    plan.screenshotPath = path.relative(session.storagePath, outputPath)
  }

  const result: PreparedAnnotationEdit = {
    ...plan,
    readyToEdit: !plan.needsClarification && Boolean(plan.targetImagePath),
    storagePath: session.storagePath,
    inputImagePath: absoluteCanvasPath(target?.assetPath),
    editPrompt: buildAnnotationEditPrompt({
      userRequest,
      annotations: plan.annotationPlan
    })
  }
  return { result, userRequest }
}

function editRequestPath(requestId: string) {
  if (!session) throw new Error('Canvas session is not open')
  const safeId = requestId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const targetPath = path.join(session.storagePath, 'requests', `${safeId}.json`)
  ensureInside(session.storagePath, targetPath)
  return targetPath
}

async function writeEditRequest(request: CanvasEditRequest) {
  request.updatedAt = nowIso()
  await writeJson(editRequestPath(request.requestId), request)
  if (!session) throw new Error('Canvas session is not open')
  await writeJson(path.join(session.storagePath, 'requests', 'pending_edit.json'), request)
  return request
}

async function readEditRequest(requestId: string) {
  return readJson<CanvasEditRequest>(editRequestPath(requestId))
}

async function listEditRequests(status?: EditRequestStatus) {
  if (!session) throw new Error('Canvas session is not open')
  const requestDir = path.join(session.storagePath, 'requests')
  const names = await readdir(requestDir)
  const requests = (
    await Promise.all(
      names
        .filter((name) => name.startsWith('edit_') && name.endsWith('.json'))
        .map((name) => readJson<CanvasEditRequest>(path.join(requestDir, name)))
    )
  ).filter(Boolean) as CanvasEditRequest[]
  return requests
    .filter((request) => (status ? request.status === status : true))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

async function consumedAnnotationShapeIds() {
  const requests = await listEditRequests('completed')
  return requests
    .flatMap((request) =>
      request.annotationPlan.flatMap((annotation) => annotation.sourceShapeIds)
    )
}

async function editRequestQueueStatus(): Promise<EditRequestQueueStatus> {
  const requests = await listEditRequests()
  const queuedCount = requests.filter((request) => request.status === 'queued').length
  const processingCount = requests.filter((request) => request.status === 'processing').length
  return {
    listenerActive: isCodexListenerActive() || isCanvasWorkerActive(),
    listenerLastSeenAt: codexListenerLastSeenAt,
    listenerActiveWindowMs: LISTENER_ACTIVE_WINDOW_MS,
    queuedCount,
    processingCount,
    latestRequest: requests.at(-1),
    updatedAt: nowIso()
  }
}

async function processEditRequestInCanvasService(requestId: string) {
  if (!session || canvasWorkerRunning) return
  if (!(await NewApiAsyncImageAdapter.isConfigured(session.workspaceRoot))) {
    await writeProgressEvent({
      requestId,
      source: 'canvas_service',
      stage: 'waiting_for_codex',
      message: '未配置外部图片 API，等待 Codex 接手处理。'
    })
    return
  }

  canvasWorkerRunning = true
  try {
    let editRequest = await readEditRequest(requestId)
    if (!editRequest || editRequest.status !== 'queued' || !editRequest.canAutoEdit) return
    await writeProgressEvent({
      requestId,
      source: 'canvas_service',
      stage: 'claimed',
      status: editRequest.status,
      message: `已收到修图任务，解析到 ${editRequest.annotationPlan.length} 条标注。`,
      details: {
        annotations: editRequest.annotationPlan.map((annotation) => ({
          instruction: annotation.instruction,
          confidence: annotation.confidence,
          kind: annotation.kind
        }))
      }
    })
    editRequest = await writeEditRequest({
      ...editRequest,
      status: 'processing',
      attempts: editRequest.attempts + 1,
      claimedAt: nowIso()
    })
    await writeProgressEvent({
      requestId,
      source: 'canvas_service',
      stage: 'processing',
      status: 'processing',
      message: '已开始处理标注修图任务。'
    })

    if (!editRequest.inputImagePath || !editRequest.targetShapeId) {
      throw new Error('Edit request is missing input image or target shape.')
    }
    const referenceImages = referenceImagePaths(editRequest.targetShapeId)

    const adapter = new NewApiAsyncImageAdapter({
      workspaceRoot: session.workspaceRoot,
      onEvent: async (event) => {
        await writeProgressEvent({
          requestId,
          source: 'provider',
          stage: event.stage,
          status: event.status,
          progress: event.progress,
          message: providerEventMessage(event),
          details: {
            taskId: event.taskId,
            imageUrl: event.imageUrl,
            imagePath: event.imagePath
          }
        })
      }
    })
    const image = await adapter.editImage({
      prompt: editRequest.editPrompt,
      inputImagePath: editRequest.inputImagePath,
      referenceImages,
      annotatedScreenshotPath: editRequest.screenshotPath
        ? absoluteCanvasPath(editRequest.screenshotPath)
        : undefined,
      annotations: editRequest.annotationPlan,
      outputDir: path.join(session.storagePath, 'assets/images'),
      outputName: `${editRequest.requestId}_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
    })
    await writeProgressEvent({
      requestId,
      source: 'canvas_service',
      stage: 'image_ready',
      message: '新版图片已生成，正在插入画布。',
      details: { imagePath: image.imagePath }
    })
    const copied = await copyImageIntoCanvas(image.imagePath)
    const commandPayload = {
      sourceShapeId: editRequest.targetShapeId,
      imagePath: image.imagePath,
      placement: 'right',
      title: 'AI 图片 v2',
      runId: editRequest.requestId,
      ...copied
    }
    const version = hasCanvasClient()
      ? await sendCommand('create_image_version', commandPayload)
      : await createImageVersionOffline(commandPayload)
    await writeProgressEvent({
      requestId,
      source: 'canvas_service',
      stage: 'version_created',
      message: '新版已放到旧图右侧。',
      details: version as Record<string, unknown>
    })
    await writeRun({
      runId: editRequest.requestId,
      type: 'edit_from_annotations',
      model: 'external',
      input: {
        requestId: editRequest.requestId,
        sourceShapeId: editRequest.targetShapeId,
        annotations: editRequest.annotationPlan,
        referenceImages
      },
      output: version as Record<string, unknown>
    })
    await writeEditRequest({
      ...editRequest,
      status: 'completed',
      result: {
        imagePath: image.imagePath,
        version
      },
      completedAt: nowIso()
    })
    await persistSession()
    await writeProgressEvent({
      requestId,
      source: 'canvas_service',
      stage: 'completed',
      status: 'completed',
      message: '修图任务已完成。'
    })
  } catch (error) {
    const editRequest = await readEditRequest(requestId)
    const message = error instanceof Error ? error.message : String(error)
    if (editRequest) {
      await writeEditRequest({
        ...editRequest,
        status: 'failed',
        error: message,
        completedAt: nowIso()
      })
    }
    await writeProgressEvent({
      requestId,
      source: 'canvas_service',
      stage: 'failed',
      status: 'failed',
      message
    })
  } finally {
    canvasWorkerRunning = false
  }
}

function triggerCanvasServiceEditWorker(requestId: string) {
  setTimeout(() => {
    processEditRequestInCanvasService(requestId).catch((error) => {
      console.error('[ai-draw] canvas service edit worker failed:', error)
    })
  }, 0)
}

async function start() {
  const args = parseArgs(process.argv.slice(2))
  const port = Number(args.get('port') ?? process.env.AI_DRAW_PORT ?? process.env.AI_CANVAS_PORT ?? DEFAULT_PORT)
  await openSession({
    workspaceRoot:
      args.get('workspace-root') ??
      process.env.AI_DRAW_WORKSPACE_ROOT ??
      process.env.AI_CANVAS_WORKSPACE_ROOT,
    canvasId:
      args.get('canvas-id') ?? process.env.AI_DRAW_CANVAS_ID ?? process.env.AI_CANVAS_CANVAS_ID
  })

  const app = express()
  const server = createServer(app)
  const wss = new WebSocketServer({ server, path: '/ws' })

  app.use(express.json({ limit: '80mb' }))

  app.get('/api/health', (_request, response) => {
    response.json({
      ok: true,
      appVersion: APP_VERSION,
      features: FEATURES,
      pluginRoot,
      clientIndexReady: existsSync(clientIndex),
      canvasId: session?.canvasId,
      storagePath: session?.storagePath
    })
  })

  app.get('/api/canvas/image-provider', async (_request, response, next) => {
    try {
      response.json(providerStatus(await readImageProviderSettings()))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/image-provider', async (request, response, next) => {
    try {
      response.json(await updateImageProviderSettings(request.body ?? {}))
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/open', async (request, response, next) => {
    try {
      const nextSession = await openSession(request.body ?? {})
      response.json({
        url: `http://127.0.0.1:${port}/`,
        canvasId: nextSession.canvasId,
        storagePath: nextSession.storagePath
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/canvas/state', (_request, response, next) => {
    try {
      response.json(statePayload())
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/canvas/selection', (_request, response, next) => {
    try {
      response.json(statePayload().selection)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/shape', async (request, response, next) => {
    try {
      const result = hasCanvasClient()
        ? await sendCommand('create_image_holder', request.body ?? {})
        : await createImageHolderOffline(request.body ?? {})
      await persistSession()
      response.json(result)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/asset', async (request, response, next) => {
    try {
      const copied = await copyImageIntoCanvas(String(request.body.imagePath))
      const runId = slugId('run')
      const commandPayload = {
        ...request.body,
        ...copied,
        runId
      }
      const result = hasCanvasClient()
        ? await sendCommand('insert_image_into_holder', commandPayload)
        : await insertImageIntoHolderOffline(commandPayload)
      const run = await writeRun({
        runId,
        type: 'insert_image_into_holder',
        model: 'external',
        input: {
          holderShapeId: request.body.holderShapeId,
          imagePath: request.body.imagePath
        },
        output: result as Record<string, unknown>
      })
      await persistSession()
      response.json({ ...(result as object), runId: run.runId, assetPath: copied.assetPath })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/reference-images', async (request, response, next) => {
    try {
      if (!session) throw new Error('Canvas session is not open')
      const files = Array.isArray(request.body?.files) ? request.body.files : []
      if (files.length === 0) throw new Error('No reference images were uploaded.')
      const runId = slugId('run')
      const results: unknown[] = []
      for (const [index, file] of files.entries()) {
        const saved = await saveUploadedImageIntoCanvas({
          name: typeof file?.name === 'string' ? file.name : `reference_${index + 1}`,
          mimeType: typeof file?.mimeType === 'string' ? file.mimeType : undefined,
          data: String(file?.data ?? '')
        })
        const commandPayload = {
          title: file?.name ? String(file.name) : `参考图 ${index + 1}`,
          x: Number(request.body?.x ?? 120) + index * 260,
          y: Number(request.body?.y ?? 760),
          w: Number(request.body?.w ?? 220),
          h: Number(request.body?.h ?? 220),
          index,
          runId,
          ...saved
        }
        const result = hasCanvasClient()
          ? await sendCommand('insert_reference_image', commandPayload)
          : await insertReferenceImageOffline(commandPayload)
        results.push({ ...(result as object), assetPath: saved.assetPath, assetUrl: saved.assetUrl })
      }
      await writeRun({
        runId,
        type: 'upload_reference_images',
        model: 'external',
        input: {
          count: files.length,
          names: files.map((file: { name?: unknown }) => String(file?.name ?? 'reference'))
        },
        output: { references: results }
      })
      await persistSession()
      response.json({ ok: true, runId, references: results })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/reference-images/compose', async (request, response, next) => {
    try {
      if (!session) throw new Error('Canvas session is not open')
      const sourceShapeIds: string[] = Array.isArray(request.body?.sourceShapeIds)
        ? request.body.sourceShapeIds.map((id: unknown) => String(id))
        : session.selection.selectedShapeIds
      const sourceShapes = sourceShapeIds
        .map((id: string) => session!.shapes.find((shape: ShapeSummary) => shape.id === id))
        .filter((shape): shape is ShapeSummary => Boolean(shape && shape.role === 'reference_image'))
      if (sourceShapes.length < 2) {
        throw new Error('请至少选择 2 张参考图再合成。')
      }
      const referenceImages = sourceShapes
        .map((shape: ShapeSummary) => absoluteCanvasPath(shape.assetPath ?? shape.meta?.assetPath))
        .filter((imagePath): imagePath is string => Boolean(imagePath))
      if (referenceImages.length < 2) {
        throw new Error('选中的参考图缺少本地资源文件。')
      }
      if (!(await NewApiAsyncImageAdapter.isConfigured(session.workspaceRoot))) {
        throw new Error('未配置外部图片 API，无法自动合成多张参考图。')
      }
      const runId = slugId('compose')
      const prompt = composeReferencePrompt({
        prompt: typeof request.body?.prompt === 'string' ? request.body.prompt : undefined,
        count: referenceImages.length
      })
      const adapter = new NewApiAsyncImageAdapter({ workspaceRoot: session.workspaceRoot })
      const outputDir = path.join(session.storagePath, 'assets/images')
      const image = await adapter.composeImages({
        prompt,
        inputImagePaths: referenceImages,
        outputDir,
        outputName: `${runId}_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`
      })
      const copied = await copyImageIntoCanvas(image.imagePath)
      const maxX = Math.max(...sourceShapes.map((shape: ShapeSummary) => shape.bounds.x + shape.bounds.w))
      const minY = Math.min(...sourceShapes.map((shape: ShapeSummary) => shape.bounds.y))
      const commandPayload = {
        sourceShapeIds,
        x: maxX + 80,
        y: minY,
        w: Number(request.body?.w ?? 420),
        h: Number(request.body?.h ?? 560),
        title: request.body?.title ? String(request.body.title) : '合成图片',
        runId,
        ...copied
      }
      const inserted = hasCanvasClient()
        ? await sendCommand('insert_composite_image', commandPayload)
        : await insertCompositeImageOffline(commandPayload)
      await writeRun({
        runId,
        type: 'compose_reference_images',
        model: 'external',
        input: {
          sourceShapeIds,
          referenceImages,
          prompt
        },
        output: {
          imagePath: image.imagePath,
          inserted
        }
      })
      await persistSession()
      response.json({
        ok: true,
        runId,
        imagePath: image.imagePath,
        inserted
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/workflow/run', async (_request, response, next) => {
    try {
      if (!session) throw new Error('Canvas session is not open')
      const tasks = parseWorkflowTasks()
      if (tasks.length === 0) {
        throw new Error('没有识别到流程。请用箭头从参考图/AI 图连到文字说明。')
      }
      if (_request.body?.dryRun === true) {
        response.json({
          ok: true,
          dryRun: true,
          taskCount: tasks.length,
          tasks: tasks.map((task) => ({
            promptShapeId: task.promptShape.id,
            prompt: task.promptShape.text,
            sourceShapeIds: task.sourceShapes.map((shape) => shape.id),
            arrowIds: task.arrowIds
          }))
        })
        return
      }
      if (!(await NewApiAsyncImageAdapter.isConfigured(session.workspaceRoot))) {
        throw new Error('未配置外部图片 API，无法按流程自动生成。')
      }
      const results = []
      for (const [index, task] of tasks.entries()) {
        results.push(
          await runWorkflowTask({
            sourceShapes: task.sourceShapes,
            promptShape: task.promptShape,
            index
          })
        )
      }
      await persistSession()
      response.json({
        ok: true,
        taskCount: tasks.length,
        results
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/version', async (request, response, next) => {
    try {
      const copied = await copyImageIntoCanvas(String(request.body.imagePath))
      const runId = request.body.runId ?? slugId('run')
      const commandPayload = {
        ...request.body,
        ...copied,
        runId
      }
      const result = hasCanvasClient()
        ? await sendCommand('create_image_version', commandPayload)
        : await createImageVersionOffline(commandPayload)
      await writeRun({
        runId,
        type: 'create_image_version',
        model: 'external',
        input: {
          sourceShapeId: request.body.sourceShapeId,
          imagePath: request.body.imagePath
        },
        output: result as Record<string, unknown>
      })
      await persistSession()
      response.json({ ...(result as object), runId, assetPath: copied.assetPath })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/export', async (request, response, next) => {
    try {
      if (!session) throw new Error('Canvas session is not open')
      const exportId = slugId('export')
      const svg = renderExportSvg(request.body?.shapeIds)
      const outputPath = path.join(session.storagePath, 'exports', `${exportId}.svg`)
      ensureInside(session.storagePath, outputPath)
      await writeFile(outputPath, svg, 'utf8')
      await writeJson(path.join(session.storagePath, 'exports', `${exportId}.json`), {
        exportId,
        sourceShapeIds: request.body?.shapeIds ?? [],
        outputPath: path.relative(session.storagePath, outputPath),
        createdAt: nowIso()
      })
      response.json({
        exportId,
        screenshotPath: path.relative(session.storagePath, outputPath),
        absolutePath: outputPath
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/prepare-edit', async (request, response, next) => {
    try {
      if (!session) throw new Error('Canvas session is not open')
      const { result } = await prepareAnnotationEditFromBody(request.body ?? {})
      await writeJson(path.join(session.storagePath, 'requests', 'pending_edit.json'), {
        ...result,
        createdAt: nowIso(),
        codexInstruction: '要求后续变更'
      })
      response.json(result)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/edit-request', async (request, response, next) => {
    try {
      if (!session) throw new Error('Canvas session is not open')
      const { result, userRequest } = await prepareAnnotationEditFromBody(request.body ?? {})
      const requestId = slugId('edit')
      const autoEdit = canAutoEdit(result)
      const createdAt = nowIso()
      const editRequest: CanvasEditRequest = {
        ...result,
        requestId,
        status: autoEdit ? 'queued' : 'needs_clarification',
        canAutoEdit: autoEdit,
        source: 'canvas_button',
        userRequest,
        codexInstruction:
          'ai-draw 手动提交的标注修图任务：用户已经完成一批画布标注，请根据这些标注修改当前图片，新图放右侧，旧图保留。',
        attempts: 0,
        createdAt,
        updatedAt: createdAt
      }
      const saved = await writeEditRequest(editRequest)
      if (saved.status === 'queued') triggerCanvasServiceEditWorker(saved.requestId)
      response.json(saved)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/edit-requests/next', async (request, response, next) => {
    try {
      if (!session) throw new Error('Canvas session is not open')
      touchCodexListener()
      const includeCompleted = request.body?.includeCompleted === true
      const queued = await listEditRequests('queued')
      let editRequest =
        queued[0] ?? (includeCompleted ? (await listEditRequests()).find((item) => item.status !== 'processing') : undefined)
      if (editRequest && request.body?.claim !== false && editRequest.status === 'queued') {
        editRequest = await writeEditRequest({
          ...editRequest,
          status: 'processing',
          attempts: editRequest.attempts + 1,
          claimedAt: nowIso()
        })
      }
      response.json({
        request: editRequest,
        timedOut: false,
        message: editRequest ? 'Edit request ready.' : 'No queued edit request.'
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/canvas/edit-requests/status', async (_request, response, next) => {
    try {
      response.json(await editRequestQueueStatus())
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/canvas/edit-requests/events', async (_request, response, next) => {
    try {
      response.json({ events: await readProgressEvents() })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/canvas/edit-requests/:requestId', async (request, response, next) => {
    try {
      const editRequest = await readEditRequest(request.params.requestId)
      if (!editRequest) {
        response.status(404).json({ ok: false, error: 'Edit request not found' })
        return
      }
      response.json(editRequest)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/canvas/edit-requests/:requestId/events', async (request, response, next) => {
    try {
      response.json({ events: await readProgressEvents(request.params.requestId) })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/edit-requests/:requestId/status', async (request, response, next) => {
    try {
      touchCodexListener()
      const editRequest = await readEditRequest(request.params.requestId)
      if (!editRequest) {
        response.status(404).json({ ok: false, error: 'Edit request not found' })
        return
      }
      const status = String(request.body?.status ?? editRequest.status) as EditRequestStatus
      const nextRequest = await writeEditRequest({
        ...editRequest,
        status,
        error: request.body?.error ? String(request.body.error) : editRequest.error,
        result:
          request.body?.result && typeof request.body.result === 'object'
            ? (request.body.result as Record<string, unknown>)
            : editRequest.result,
        completedAt:
          status === 'completed' || status === 'failed' || status === 'needs_clarification'
            ? nowIso()
            : editRequest.completedAt
      })
      response.json(nextRequest)
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/save', async (_request, response, next) => {
    try {
      if (clients.size > 0) {
        await sendCommand('save_snapshot', {})
      }
      await persistSession()
      response.json({
        ok: true,
        savedAt: nowIso(),
        snapshotPath: 'canvas.json'
      })
    } catch (error) {
      next(error)
    }
  })

  app.post('/api/canvas/pending-operations/clear', async (request, response, next) => {
    try {
      if (!session) throw new Error('Canvas session is not open')
      const ids = Array.isArray(request.body?.ids)
        ? new Set(request.body.ids.map((id: unknown) => String(id)))
        : undefined
      session.pendingOperations = ids
        ? session.pendingOperations.filter((operation) => !ids.has(operation.id))
        : []
      await persistSession()
      response.json({
        ok: true,
        remaining: session.pendingOperations.length
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/canvas/asset-file/images/:name', async (request, response, next) => {
    try {
      if (!session) throw new Error('Canvas session is not open')
      const filePath = path.join(session.storagePath, 'assets/images', request.params.name)
      ensureInside(session.storagePath, filePath)
      response.sendFile(filePath)
    } catch (error) {
      next(error)
    }
  })

  wss.on('connection', (socket) => {
    clients.add(socket)
    socket.send(JSON.stringify({ type: 'server:state', payload: session ? statePayload() : null }))

    socket.on('message', async (raw) => {
      try {
        const message = JSON.parse(String(raw)) as {
          type: string
          id?: string
          ok?: boolean
          result?: unknown
          error?: string
          payload?: Partial<CanvasStatePayload>
        }

        if (message.type === 'client:state' && session && message.payload) {
          session.snapshot = message.payload.snapshot
          session.shapes = message.payload.shapes ?? []
          session.selection = message.payload.selection ?? session.selection
          await persistSession()
          return
        }

        if (message.type === 'response' && message.id) {
          const pending = pendingCommands.get(message.id)
          if (!pending) return
          clearTimeout(pending.timer)
          pendingCommands.delete(message.id)
          if (message.ok) pending.resolve(message.result)
          else pending.reject(new Error(message.error ?? 'Canvas command failed'))
        }
      } catch (error) {
        console.error('[ai-draw] ws message error', error)
      }
    })

    socket.on('close', () => {
      clients.delete(socket)
    })
  })

  if (process.env.NODE_ENV === 'production' && (await exists(clientIndex))) {
    app.use(express.static(clientDist))
    app.get('*', (_request, response) => response.sendFile(clientIndex))
  } else {
    const { createServer: createViteServer } = await import('vite')
    const vite = await createViteServer({
      root: path.resolve(pluginRoot, 'packages/canvas-app'),
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa'
    })
    app.use(vite.middlewares)
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[ai-draw] api error', message)
    response.status(500).json({ ok: false, error: message })
  })

  server.listen(port, '127.0.0.1', () => {
    console.error(`[ai-draw] listening on http://127.0.0.1:${port}/`)
  })
}

start().catch((error) => {
  console.error('[ai-draw] failed to start', error)
  process.exit(1)
})
