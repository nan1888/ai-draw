import type {
  Bounds,
  CanvasEditRequest,
  CanvasPendingOperation,
  EditRequestQueueStatus,
  ImageProviderSettingsStatus,
  CanvasStatePayload,
  ShapeSummary
} from '@ai-canvas/shared'
import {
  AssetRecordType,
  Editor,
  Tldraw,
  createShapeId,
  getSnapshot,
  toRichText
} from 'tldraw'
import {
  ArrowRight,
  Box,
  Braces,
  CheckCircle2,
  Image as ImageIcon,
  Layers3,
  MousePointer2,
  Save,
  Sparkles,
  Type,
  Wand2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type WsCommand = {
  type: 'command'
  id: string
  command:
    | 'create_image_holder'
    | 'insert_image_into_holder'
    | 'create_image_version'
    | 'insert_composite_image'
    | 'insert_reference_image'
    | 'save_snapshot'
  payload: Record<string, unknown>
}

type Status = 'connecting' | 'connected' | 'saved' | 'error'
type CanvasTool = 'select' | 'arrow' | 'text'

const HAPPYHORSE_PROVIDER = {
  baseUrl: 'https://happyhorse.pics/v1',
  models: ['gpt-image-2', 'banana2', 'gemini-3.0-pro-image'],
  sizes: ['1k', '2k', '4k'],
  defaultModel: 'gpt-image-2',
  defaultSize: '1k'
}

function getBounds(editor: Editor, shape: any): Bounds {
  const box = editor.getShapePageBounds(shape.id)
  if (box) return { x: box.x, y: box.y, w: box.w, h: box.h }
  return {
    x: shape.x ?? 0,
    y: shape.y ?? 0,
    w: shape.props?.w ?? 160,
    h: shape.props?.h ?? 120
  }
}

function boundsCenter(bounds: Bounds) {
  return {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2
  }
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function extractText(editor: Editor, shape: any) {
  const utilText = (editor.getShapeUtil(shape) as any)?.getText?.(shape)
  if (typeof utilText === 'string' && utilText.trim()) return utilText.trim()
  if (typeof shape.props?.text === 'string') return shape.props.text.trim()
  if (typeof shape.props?.label === 'string') return shape.props.label.trim()
  const richText = shape.props?.richText
  if (!richText) return undefined
  const textParts: string[] = []
  const visit = (node: any) => {
    if (!node) return
    if (typeof node.text === 'string') textParts.push(node.text)
    if (Array.isArray(node.content)) node.content.forEach(visit)
  }
  visit(richText)
  return textParts.join('').trim() || undefined
}

function summarizeShape(editor: Editor, shape: any): ShapeSummary {
  const meta = shape.meta ?? {}
  const bounds = getBounds(editor, shape)
  const summary: ShapeSummary = {
    id: shape.id,
    type: shape.type,
    role: meta.aiCanvasRole,
    bounds,
    text: extractText(editor, shape),
    color: shape.props?.color,
    aspectRatio: meta.aspectRatio,
    version: meta.version,
    parentShapeId: meta.parentShapeId,
    assetPath: meta.assetPath,
    assetUrl: meta.assetUrl,
    meta
  }

  if (shape.type === 'arrow') {
    const start = shape.props?.start
    const end = shape.props?.end
    if (start && end) {
      summary.arrowStart = { x: (shape.x ?? 0) + start.x, y: (shape.y ?? 0) + start.y }
      summary.arrowEnd = { x: (shape.x ?? 0) + end.x, y: (shape.y ?? 0) + end.y }
    }
  }

  return summary
}

function latestImage(images: ShapeSummary[]) {
  return [...images].sort((a, b) => {
    const versionDelta = Number(b.version ?? b.meta?.version ?? 1) - Number(a.version ?? a.meta?.version ?? 1)
    if (versionDelta !== 0) return versionDelta
    return b.bounds.x - a.bounds.x
  })[0]
}

function nearestImageToSelection(images: ShapeSummary[], selectedShapes: ShapeSummary[]) {
  const annotationShapes = selectedShapes.filter((shape) => shape.role !== 'ai_image' && shape.role !== 'image_holder')
  if (annotationShapes.length === 0) return undefined
  const points = annotationShapes.map((shape) => boundsCenter(shape.bounds))
  return [...images]
    .map((image) => ({
      image,
      distance: Math.min(...points.map((point) => pointDistance(point, boundsCenter(image.bounds))))
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.image
}

function loadImageDimensions(src: string) {
  return new Promise<{ w: number; h: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ w: image.naturalWidth || 1024, h: image.naturalHeight || 1024 })
    image.onerror = () => reject(new Error(`Could not load image: ${src}`))
    image.src = src
  })
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (response) => {
    if (!response.ok) throw new Error(await response.text())
    return response.json() as Promise<T>
  })
}

function getJson<T>(url: string): Promise<T> {
  return fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(await response.text())
    return response.json() as Promise<T>
  })
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

function clearEditorPage(editor: Editor) {
  const shapeIds = Array.from(editor.getCurrentPageShapeIds())
  if (shapeIds.length) editor.deleteShapes(shapeIds as any)
  editor.selectNone()
  editor.clearHistory()
}

export function App() {
  const editorRef = useRef<Editor | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const reportTimerRef = useRef<number | null>(null)
  const referenceInputRef = useRef<HTMLInputElement | null>(null)
  const stateRef = useRef<CanvasStatePayload | null>(null)
  const [state, setState] = useState<CanvasStatePayload | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [activeTool, setActiveTool] = useState<CanvasTool>('select')
  const [lastError, setLastError] = useState<string | null>(null)
  const [annotationPreview, setAnnotationPreview] = useState<string>('还没有提交修图任务。')
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false)
  const [isComposingReferences, setIsComposingReferences] = useState(false)
  const [isRunningWorkflow, setIsRunningWorkflow] = useState(false)
  const [isUploadingReferences, setIsUploadingReferences] = useState(false)
  const [queueStatus, setQueueStatus] = useState<EditRequestQueueStatus | null>(null)
  const [providerStatus, setProviderStatus] = useState<ImageProviderSettingsStatus | null>(null)
  const [providerForm, setProviderForm] = useState({
    baseUrl: '',
    apiKey: '',
    model: HAPPYHORSE_PROVIDER.defaultModel,
    size: HAPPYHORSE_PROVIDER.defaultSize,
    quality: 'auto',
    outputFormat: 'png',
    pollIntervalMs: '5000',
    timeoutMs: '420000'
  })
  const [providerMessage, setProviderMessage] = useState('未检测到图片接口配置。')

  const selected = state?.selection.shapes ?? []
  const holders = useMemo(
    () => state?.shapes.filter((shape) => shape.role === 'image_holder') ?? [],
    [state]
  )
  const aiImages = useMemo(
    () => state?.shapes.filter((shape) => shape.role === 'ai_image') ?? [],
    [state]
  )
  const referenceImages = useMemo(
    () => state?.shapes.filter((shape) => shape.role === 'reference_image') ?? [],
    [state]
  )
  const editableImages = useMemo(
    () => [...aiImages, ...referenceImages],
    [aiImages, referenceImages]
  )
  const selectedReferenceImages = useMemo(
    () => selected.filter((shape) => shape.role === 'reference_image'),
    [selected]
  )
  const listenerView = useMemo(() => {
    if (!queueStatus) {
      return {
        kind: 'checking',
        title: '正在检测 Codex',
        detail: '图片好了就可以开始标注，标完点“按标注修图”。'
      }
    }
    if (queueStatus.processingCount > 0) {
      return {
        kind: 'busy',
        title: providerStatus?.hasApiKey ? '正在自动修图' : 'Codex 正在修图',
        detail: '请稍等，新版会自动放到旧图右侧。'
      }
    }
    if (queueStatus.listenerActive) {
      return {
        kind: 'active',
        title: providerStatus?.hasApiKey ? '自动修图已就绪' : 'Codex 监听中',
        detail: '现在请在画布上标注，标完点“按标注修图”。'
      }
    }
    if (queueStatus.queuedCount > 0) {
      return {
        kind: 'paused',
        title: providerStatus?.hasApiKey ? '等待自动修图' : 'Codex 已暂停',
        detail: providerStatus?.hasApiKey
          ? '任务已保存，画布服务会自动处理。'
          : '任务已保存。回到 Codex 说：ai-draw 继续自动修图。'
      }
    }
    if (providerStatus?.hasApiKey) {
      return {
        kind: 'active',
        title: '自动修图已就绪',
        detail: '标注完成后点“按标注修图”，画布服务会自动处理。'
      }
    }
    return {
      kind: 'paused',
      title: 'Codex 已暂停',
      detail: '需要修图时，回到 Codex 说：ai-draw 继续自动修图。'
    }
  }, [providerStatus?.hasApiKey, queueStatus])

  const refreshQueueStatus = useCallback(async () => {
    try {
      const nextStatus = await getJson<EditRequestQueueStatus>('/api/canvas/edit-requests/status')
      setQueueStatus(nextStatus)
      return nextStatus
    } catch {
      return null
    }
  }, [])

  const refreshProviderStatus = useCallback(async () => {
    try {
      const status = await getJson<ImageProviderSettingsStatus>('/api/canvas/image-provider')
      setProviderStatus(status)
      setProviderForm((current) => ({
        ...current,
        baseUrl: status.baseUrl ?? '',
        apiKey: '',
        model: status.model ?? current.model,
        size: status.size ?? current.size,
        quality: status.quality ?? current.quality,
        outputFormat: status.outputFormat ?? current.outputFormat,
        pollIntervalMs: status.pollIntervalMs ? String(status.pollIntervalMs) : current.pollIntervalMs,
        timeoutMs: status.timeoutMs ? String(status.timeoutMs) : current.timeoutMs
      }))
      setProviderMessage(status.hasApiKey ? '图片接口已配置。' : '请填写图片接口 API Key。')
      return status
    } catch {
      setProviderMessage('读取图片接口配置失败。')
      return null
    }
  }, [])

  useEffect(() => {
    void refreshProviderStatus()
  }, [refreshProviderStatus])

  useEffect(() => {
    let disposed = false
    const refresh = async () => {
      const nextStatus = await refreshQueueStatus()
      if (disposed || !nextStatus) return
      setQueueStatus(nextStatus)
    }
    void refresh()
    const interval = window.setInterval(refresh, 5000)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [refreshQueueStatus])

  const reportState = useCallback(() => {
    const editor = editorRef.current
    const socket = socketRef.current
    const currentState = stateRef.current
    if (!editor || !socket || socket.readyState !== WebSocket.OPEN || !currentState) return
    const shapes = editor.getCurrentPageShapes().map((shape) => summarizeShape(editor, shape))
    const selectedShapeIds = editor.getSelectedShapeIds().map(String)
    const selectionShapes = shapes.filter((shape) => selectedShapeIds.includes(shape.id))
    const payload: Partial<CanvasStatePayload> = {
      canvasId: currentState.canvasId,
      metadata: currentState.metadata,
      storagePath: currentState.storagePath,
      snapshot: getSnapshot(editor.store),
      shapes,
      selection: {
        canvasId: currentState.canvasId,
        pageId: currentState.metadata.activePageId,
        selectedShapeIds,
        shapes: selectionShapes
      }
    }
    socket.send(JSON.stringify({ type: 'client:state', payload }))
    const nextState = {
      ...currentState,
      shapes,
      snapshot: payload.snapshot,
      selection: payload.selection!
    }
    stateRef.current = nextState
    setState(nextState)
    setStatus('saved')
  }, [])

  const queueReportState = useCallback(() => {
    if (reportTimerRef.current) window.clearTimeout(reportTimerRef.current)
    reportTimerRef.current = window.setTimeout(reportState, 500)
  }, [reportState])

  const sendResponse = useCallback((id: string, ok: boolean, result?: unknown, error?: string) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify({ type: 'response', id, ok, result, error }))
  }, [])

  const activateTool = useCallback((tool: CanvasTool) => {
    const editor = editorRef.current
    if (!editor) return
    editor.setCurrentTool(tool)
    setActiveTool(tool)
  }, [])

  const createHolder = useCallback(
    async (payload: Record<string, unknown>) => {
      const editor = editorRef.current
      if (!editor) throw new Error('Editor is not ready')
      const shapeId = (payload.shapeId
        ? String(payload.shapeId)
        : createShapeId(`holder_${crypto.randomUUID().slice(0, 8)}`)) as any
      const x = Number(payload.x ?? 100)
      const y = Number(payload.y ?? 100)
      const w = Number(payload.w ?? 403)
      const h = Number(payload.h ?? 567)
      const label = String(payload.label ?? 'AI 图片')
      if (editor.getShape(shapeId)) {
        editor.select(shapeId)
        queueReportState()
        return { shapeId, bounds: { x, y, w, h } }
      }
      editor.createShape({
        id: shapeId,
        type: 'geo',
        x,
        y,
        props: {
          w,
          h,
          geo: 'rectangle',
          dash: 'dashed',
          color: 'blue',
          fill: 'none',
          size: 'm',
          richText: toRichText(label),
          align: 'middle',
          verticalAlign: 'middle'
        },
        meta: {
          aiCanvasRole: 'image_holder',
          aspectRatio: String(payload.aspectRatio ?? '5:7'),
          acceptsGeneratedImage: true,
          title: label
        }
      } as any)
      editor.select(shapeId)
      queueReportState()
      return { shapeId, bounds: { x, y, w, h } }
    },
    [queueReportState]
  )

  const insertImageIntoHolder = useCallback(
    async (payload: Record<string, unknown>) => {
      const editor = editorRef.current
      if (!editor) throw new Error('Editor is not ready')
      const holderShapeId = String(payload.holderShapeId)
      const holder = editor.getShape(holderShapeId as any) as any
      if (!holder) throw new Error(`Holder not found: ${holderShapeId}`)
      const bounds = getBounds(editor, holder)
      const assetUrl = String(payload.assetUrl)
      const natural = await loadImageDimensions(assetUrl)
      const assetId = AssetRecordType.createId()
      const imageShapeId = (payload.imageShapeId
        ? String(payload.imageShapeId)
        : createShapeId(`image_${crypto.randomUUID().slice(0, 8)}`)) as any
      const title = String(payload.title ?? holder.meta?.title ?? 'AI 图片')
      if (editor.getShape(imageShapeId)) {
        editor.select(imageShapeId)
        queueReportState()
        return {
          imageShapeId,
          assetId: undefined,
          assetPath: payload.assetPath,
          bounds,
          version: 1
        }
      }
      editor.createAssets([
        {
          id: assetId,
          typeName: 'asset',
          type: 'image',
          props: {
            name: title,
            src: assetUrl,
            w: natural.w,
            h: natural.h,
            mimeType: 'image/png',
            isAnimated: false
          },
          meta: {
            assetPath: payload.assetPath,
            sourceRunId: payload.runId
          }
        } as any
      ])
      editor.createShape({
        id: imageShapeId,
        type: 'image',
        x: bounds.x,
        y: bounds.y,
        props: {
          assetId,
          w: bounds.w,
          h: bounds.h,
          altText: title
        },
        meta: {
          aiCanvasRole: 'ai_image',
          holderId: holderShapeId,
          sourceRunId: payload.runId,
          version: 1,
          assetPath: payload.assetPath,
          assetUrl,
          title
        }
      } as any)
      editor.bringToFront([imageShapeId])
      editor.select(imageShapeId)
      queueReportState()
      return {
        imageShapeId,
        assetId,
        assetPath: payload.assetPath,
        bounds,
        version: 1
      }
    },
    [queueReportState]
  )

  const createImageVersion = useCallback(
    async (payload: Record<string, unknown>) => {
      const editor = editorRef.current
      if (!editor) throw new Error('Editor is not ready')
      const sourceShapeId = String(payload.sourceShapeId)
      const source = editor.getShape(sourceShapeId as any) as any
      if (!source) throw new Error(`Source image not found: ${sourceShapeId}`)
      const sourceBounds = getBounds(editor, source)
      const assetUrl = String(payload.assetUrl)
      const natural = await loadImageDimensions(assetUrl)
      const assetId = AssetRecordType.createId()
      const newShapeId = (payload.newShapeId
        ? String(payload.newShapeId)
        : createShapeId(`image_${crypto.randomUUID().slice(0, 8)}`)) as any
      const sourceVersion = Number(source.meta?.version ?? 1)
      const version = Number(payload.version ?? sourceVersion + 1)
      const placement = String(payload.placement ?? 'right')
      const x = placement === 'replace' ? sourceBounds.x : sourceBounds.x + sourceBounds.w + 80
      const y = sourceBounds.y
      const title = String(payload.title ?? `AI 图片 v${version}`)
      if (editor.getShape(newShapeId)) {
        editor.select(newShapeId)
        queueReportState()
        return {
          newShapeId,
          assetId: undefined,
          assetPath: payload.assetPath,
          version,
          parentShapeId: sourceShapeId
        }
      }
      editor.createAssets([
        {
          id: assetId,
          typeName: 'asset',
          type: 'image',
          props: {
            name: title,
            src: assetUrl,
            w: natural.w,
            h: natural.h,
            mimeType: 'image/png',
            isAnimated: false
          },
          meta: {
            assetPath: payload.assetPath,
            sourceRunId: payload.runId
          }
        } as any
      ])
      editor.createShape({
        id: newShapeId,
        type: 'image',
        x,
        y,
        props: {
          assetId,
          w: sourceBounds.w,
          h: sourceBounds.h,
          altText: title
        },
        meta: {
          aiCanvasRole: 'ai_image',
          holderId: source.meta?.holderId,
          parentShapeId: sourceShapeId,
          sourceRunId: payload.runId,
          version,
          assetPath: payload.assetPath,
          assetUrl,
          title
        }
      } as any)
      editor.createShape({
        id: (payload.arrowShapeId
          ? String(payload.arrowShapeId)
          : createShapeId(`version_arrow_${crypto.randomUUID().slice(0, 8)}`)) as any,
        type: 'arrow',
        x: sourceBounds.x + sourceBounds.w + 20,
        y: sourceBounds.y + sourceBounds.h / 2,
        props: {
          start: { x: 0, y: 0 },
          end: { x: 42, y: 0 },
          color: 'blue',
          size: 's',
          arrowheadEnd: 'arrow',
          text: '',
          bend: 0
        },
        meta: {
          aiCanvasRole: 'version_group',
          parentShapeId: sourceShapeId
        }
      } as any)
      editor.select(newShapeId)
      queueReportState()
      return {
        newShapeId,
        assetId,
        assetPath: payload.assetPath,
        version,
        parentShapeId: sourceShapeId
      }
    },
    [queueReportState]
  )

  const insertReferenceImage = useCallback(
    async (payload: Record<string, unknown>) => {
      const editor = editorRef.current
      if (!editor) throw new Error('Editor is not ready')
      const assetUrl = String(payload.assetUrl)
      const natural = await loadImageDimensions(assetUrl)
      const assetId = AssetRecordType.createId()
      const shapeId = (payload.shapeId
        ? String(payload.shapeId)
        : createShapeId(`reference_${crypto.randomUUID().slice(0, 8)}`)) as any
      const title = String(payload.title ?? '参考图')
      const maxW = Number(payload.w ?? 220)
      const maxH = Number(payload.h ?? 220)
      const scale = Math.min(maxW / natural.w, maxH / natural.h, 1)
      const w = Math.max(80, Math.round(natural.w * scale))
      const h = Math.max(80, Math.round(natural.h * scale))
      const x = Number(payload.x ?? 120)
      const y = Number(payload.y ?? 760)
      if (editor.getShape(shapeId)) {
        editor.select(shapeId)
        queueReportState()
        return {
          shapeId,
          assetId: undefined,
          assetPath: payload.assetPath,
          bounds: { x, y, w, h }
        }
      }
      editor.createAssets([
        {
          id: assetId,
          typeName: 'asset',
          type: 'image',
          props: {
            name: title,
            src: assetUrl,
            w: natural.w,
            h: natural.h,
            mimeType: String(payload.mimeType ?? 'image/png'),
            isAnimated: false
          },
          meta: {
            assetPath: payload.assetPath,
            sourceRunId: payload.runId
          }
        } as any
      ])
      editor.createShape({
        id: shapeId,
        type: 'image',
        x,
        y,
        props: {
          assetId,
          w,
          h,
          altText: title
        },
        meta: {
          aiCanvasRole: 'reference_image',
          sourceRunId: payload.runId,
          assetPath: payload.assetPath,
          assetUrl,
          title
        }
      } as any)
      editor.select(shapeId)
      queueReportState()
      return {
        shapeId,
        assetId,
        assetPath: payload.assetPath,
        bounds: { x, y, w, h }
      }
    },
    [queueReportState]
  )

  const insertCompositeImage = useCallback(
    async (payload: Record<string, unknown>) => {
      const editor = editorRef.current
      if (!editor) throw new Error('Editor is not ready')
      const assetUrl = String(payload.assetUrl)
      const natural = await loadImageDimensions(assetUrl)
      const assetId = AssetRecordType.createId()
      const shapeId = (payload.shapeId
        ? String(payload.shapeId)
        : createShapeId(`image_${crypto.randomUUID().slice(0, 8)}`)) as any
      const title = String(payload.title ?? '合成图片')
      const x = Number(payload.x ?? 120)
      const y = Number(payload.y ?? 120)
      const w = Number(payload.w ?? 420)
      const h = Number(payload.h ?? 560)
      if (editor.getShape(shapeId)) {
        editor.select(shapeId)
        queueReportState()
        return {
          shapeId,
          assetId: undefined,
          assetPath: payload.assetPath,
          bounds: { x, y, w, h }
        }
      }
      editor.createAssets([
        {
          id: assetId,
          typeName: 'asset',
          type: 'image',
          props: {
            name: title,
            src: assetUrl,
            w: natural.w,
            h: natural.h,
            mimeType: String(payload.mimeType ?? 'image/png'),
            isAnimated: false
          },
          meta: {
            assetPath: payload.assetPath,
            sourceRunId: payload.runId
          }
        } as any
      ])
      editor.createShape({
        id: shapeId,
        type: 'image',
        x,
        y,
        props: {
          assetId,
          w,
          h,
          altText: title
        },
        meta: {
          aiCanvasRole: 'ai_image',
          sourceRunId: payload.runId,
          sourceShapeIds: payload.sourceShapeIds,
          version: 1,
          assetPath: payload.assetPath,
          assetUrl,
          title
        }
      } as any)
      editor.select(shapeId)
      queueReportState()
      return {
        shapeId,
        assetId,
        assetPath: payload.assetPath,
        bounds: { x, y, w, h }
      }
    },
    [queueReportState]
  )

  const handleCommand = useCallback(
    async (message: WsCommand) => {
      try {
        let result: unknown
        if (message.command === 'create_image_holder') result = await createHolder(message.payload)
        if (message.command === 'insert_image_into_holder') {
          result = await insertImageIntoHolder(message.payload)
        }
        if (message.command === 'create_image_version') {
          result = await createImageVersion(message.payload)
        }
        if (message.command === 'insert_composite_image') {
          result = await insertCompositeImage(message.payload)
        }
        if (message.command === 'insert_reference_image') {
          result = await insertReferenceImage(message.payload)
        }
        if (message.command === 'save_snapshot') {
          reportState()
          result = { ok: true }
        }
        sendResponse(message.id, true, result)
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error)
        setLastError(messageText)
        setStatus('error')
        sendResponse(message.id, false, undefined, messageText)
      }
    },
    [
      createHolder,
      createImageVersion,
      insertCompositeImage,
      insertImageIntoHolder,
      insertReferenceImage,
      reportState,
      sendResponse
    ]
  )

  const applyPendingOperations = useCallback(
    async (operations: CanvasPendingOperation[] | undefined) => {
      if (!operations?.length) return
      const appliedIds: string[] = []
      for (const operation of operations) {
        if (operation.type === 'create_image_holder') {
          await createHolder(operation.payload)
        }
        if (operation.type === 'insert_image_into_holder') {
          await insertImageIntoHolder(operation.payload)
        }
        if (operation.type === 'create_image_version') {
          await createImageVersion(operation.payload)
        }
        if (operation.type === 'insert_composite_image') {
          await insertCompositeImage(operation.payload)
        }
        if (operation.type === 'insert_reference_image') {
          await insertReferenceImage(operation.payload)
        }
        appliedIds.push(operation.id)
      }
      await postJson('/api/canvas/pending-operations/clear', { ids: appliedIds })
      const currentState = stateRef.current
      if (currentState) {
        stateRef.current = { ...currentState, pendingOperations: [] }
      }
      queueReportState()
    },
    [createHolder, createImageVersion, insertCompositeImage, insertImageIntoHolder, insertReferenceImage, queueReportState]
  )

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      let disposed = false
      let unlisten: (() => void) | undefined
      let interval: number | undefined
      let socket: WebSocket | undefined

      void (async () => {
        const response = await fetch('/api/canvas/state')
        const initialState = (await response.json()) as CanvasStatePayload
        if (disposed) return
        editor.setCurrentTool('select')
        stateRef.current = initialState
        setState(initialState)
        if (initialState.snapshot) {
          try {
            editor.loadSnapshot(initialState.snapshot as any)
          } catch (error) {
            console.warn('Could not load snapshot', error)
          }
        } else {
          clearEditorPage(editor)
        }
        await applyPendingOperations(initialState.pendingOperations)

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
        socketRef.current?.close()
        socket = new WebSocket(`${protocol}://${window.location.host}/ws`)
        socketRef.current = socket
        socket.onopen = () => {
          if (socketRef.current !== socket) return
          setStatus('connected')
          queueReportState()
        }
        socket.onmessage = (event) => {
          if (socketRef.current !== socket) return
          const message = JSON.parse(String(event.data))
          if (message.type === 'command') void handleCommand(message)
        }
        socket.onerror = () => {
          if (socketRef.current !== socket) return
          setStatus('error')
          setLastError('WebSocket connection failed')
        }
        socket.onclose = () => {
          if (socketRef.current !== socket) return
          setStatus('connecting')
        }

        unlisten = editor.store.listen(
          () => {
            queueReportState()
          },
          { scope: 'all' } as any
        )

        interval = window.setInterval(queueReportState, 2000)
      })().catch((error) => {
        setStatus('error')
        setLastError(error instanceof Error ? error.message : String(error))
      })

      return () => {
        disposed = true
        if (interval) window.clearInterval(interval)
        unlisten?.()
        if (socket) {
          if (socketRef.current === socket) socketRef.current = null
          socket.close()
        }
      }
    },
    [applyPendingOperations, handleCommand, queueReportState]
  )

  const createDefaultHolder = async () => {
    try {
      await postJson('/api/canvas/shape', {
        label: 'AI 图片',
        aspectRatio: '5:7',
        x: 120,
        y: 100,
        w: 403,
        h: 567
      })
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error))
      setStatus('error')
    }
  }

  const saveSnapshot = async () => {
    try {
      reportState()
      await postJson('/api/canvas/save', {})
      setStatus('saved')
    } catch (error) {
      setLastError(error instanceof Error ? error.message : String(error))
      setStatus('error')
    }
  }

  const updateProviderForm = (key: keyof typeof providerForm, value: string) => {
    setProviderForm((current) => ({ ...current, [key]: value }))
  }

  const applyHappyHorsePreset = () => {
    setProviderForm((current) => ({
      ...current,
      baseUrl: current.baseUrl.trim() || HAPPYHORSE_PROVIDER.baseUrl,
      model: HAPPYHORSE_PROVIDER.defaultModel,
      size: HAPPYHORSE_PROVIDER.defaultSize,
      quality: 'auto',
      outputFormat: 'png'
    }))
    setProviderMessage('已填入 happyhorse.pics 推荐配置，请补充 API Key 后保存。')
  }

  const saveImageProvider = async () => {
    try {
      setProviderMessage('正在保存图片接口配置...')
      const payload = {
        baseUrl: providerForm.baseUrl.trim(),
        apiKey: providerForm.apiKey.trim() || undefined,
        model: providerForm.model.trim(),
        size: providerForm.size.trim(),
        quality: providerForm.quality.trim(),
        outputFormat: providerForm.outputFormat,
        pollIntervalMs: Number(providerForm.pollIntervalMs),
        timeoutMs: Number(providerForm.timeoutMs)
      }
      const status = await postJson<ImageProviderSettingsStatus>('/api/canvas/image-provider', payload)
      setProviderStatus(status)
      setProviderForm((current) => ({ ...current, apiKey: '' }))
      setProviderMessage(status.hasApiKey ? '图片接口配置已保存。' : '配置已保存，但还没有 API Key。')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setProviderMessage(`保存失败：${message}`)
      setLastError(message)
      setStatus('error')
    }
  }

  const uploadReferenceImages = async (files: FileList | null) => {
    const images = Array.from(files ?? []).filter((file) => file.type.startsWith('image/'))
    if (referenceInputRef.current) referenceInputRef.current.value = ''
    if (images.length === 0) return
    try {
      setIsUploadingReferences(true)
      setAnnotationPreview(`正在上传 ${images.length} 张参考图...`)
      const payloadFiles = await Promise.all(
        images.map(async (file) => ({
          name: file.name,
          mimeType: file.type || 'image/png',
          data: await readFileAsDataUrl(file)
        }))
      )
      const result = await postJson<{ references: unknown[] }>('/api/canvas/reference-images', {
        files: payloadFiles
      })
      setAnnotationPreview(`已上传 ${result.references.length} 张参考图。后续自动修图会带上这些参考图。`)
      await refreshQueueStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      setStatus('error')
      setAnnotationPreview(`上传参考图失败：${message}`)
    } finally {
      setIsUploadingReferences(false)
    }
  }

  const composeSelectedReferenceImages = async () => {
    if (selectedReferenceImages.length < 2) {
      setAnnotationPreview('请先在画布上同时选中至少 2 张参考图。')
      return
    }
    try {
      setIsComposingReferences(true)
      setAnnotationPreview(`正在把 ${selectedReferenceImages.length} 张参考图合成为一张新图...`)
      reportState()
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      const result = await postJson<{ runId: string; inserted: unknown }>('/api/canvas/reference-images/compose', {
        sourceShapeIds: selectedReferenceImages.map((shape) => shape.id)
      })
      setAnnotationPreview(`已提交合成任务并插入新图。\n任务 ID：${result.runId}`)
      await refreshQueueStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      setStatus('error')
      setAnnotationPreview(`合成参考图失败：${message}`)
    } finally {
      setIsComposingReferences(false)
    }
  }

  const runWorkflow = async () => {
    try {
      setIsRunningWorkflow(true)
      setAnnotationPreview('正在按画布连线解析流程...')
      reportState()
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      const result = await postJson<{ taskCount: number; results: Array<{ runId: string; prompt: string }> }>(
        '/api/canvas/workflow/run',
        {}
      )
      const lines = result.results.map((item, index) => `${index + 1}. ${item.prompt}\n任务 ID：${item.runId}`)
      setAnnotationPreview(`已完成 ${result.taskCount} 条流程。\n\n${lines.join('\n\n')}`)
      await refreshQueueStatus()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLastError(message)
      setStatus('error')
      setAnnotationPreview(`按流程生成失败：${message}`)
    } finally {
      setIsRunningWorkflow(false)
    }
  }

  const submitAnnotationEdit = async () => {
    if (selectedReferenceImages.length >= 2) {
      await composeSelectedReferenceImages()
      return
    }
    const target =
      selected.find((shape) => shape.role === 'ai_image' || shape.role === 'reference_image') ??
      nearestImageToSelection(editableImages, selected) ??
      latestImage(editableImages)
    if (!target) {
      setAnnotationPreview('还没有可修改的图片。请先生成图片，或上传一张参考图。')
      return
    }
    try {
      setIsSubmittingEdit(true)
      setAnnotationPreview('正在保存这批标注，并提交给 Codex...')
      const statusBeforeSubmit = queueStatus ?? (await refreshQueueStatus())
      reportState()
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      const result = await postJson<CanvasEditRequest>('/api/canvas/edit-request', {
        targetShapeId: target.id,
        radius: 420,
        includeScreenshot: true
      })
      const statusAfterSubmit = await refreshQueueStatus()
      const canvasWorkerReady = Boolean(providerStatus?.hasApiKey)
      const codexReady = Boolean(
        canvasWorkerReady ||
        statusBeforeSubmit?.listenerActive ||
          statusBeforeSubmit?.processingCount ||
          statusAfterSubmit?.listenerActive ||
          statusAfterSubmit?.processingCount
      )
      const annotationLines = result.annotationPlan.length
        ? result.annotationPlan
            .map(
              (item, index) =>
                `${index + 1}. ${item.instruction}  [confidence ${Math.round(item.confidence * 100)}%]`
            )
            .join('\n')
        : '没有解析到明确标注。'
      setAnnotationPreview(
        [
          result.status === 'queued'
            ? codexReady
              ? canvasWorkerReady
                ? '已提交。画布服务会自动开始修图。'
                : '已提交。Codex 正在监听，会自动开始修图。'
              : '已保存这次标注。Codex 现在没有在监听，所以还不会开始修图。'
            : '这次标注还不够明确，需要先确认。',
          `任务 ID：${result.requestId}`,
          `状态：${result.status}`,
          result.clarificationReason ? `原因：${result.clarificationReason}` : undefined,
          `已解析 ${result.annotationPlan.length} 条标注。`,
          result.screenshotPath ? `参考截图：${result.screenshotPath}` : undefined,
          '',
          result.status === 'queued'
            ? codexReady
              ? canvasWorkerReady
                ? '新版生成后会自动放到旧图右侧，旧图保留。'
                : '新版生成后会放到旧图右侧，旧图保留。'
              : '请回到 Codex 对话里输入：ai-draw 继续自动修图。Codex 接上后会处理这次提交。'
            : '请补充更明确的箭头、文字或选中目标图片后再提交。',
          '',
          '解析结果：',
          annotationLines
        ]
          .filter((line) => line !== undefined)
          .join('\n')
      )
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const message = rawMessage.includes('Cannot POST /api/canvas/edit-request')
        ? '当前画布服务还是旧版本。请关闭这个画布页，回到 Codex 重新打开 AI 画布后再点“按标注修图”。'
        : rawMessage
      setLastError(message)
      setStatus('error')
      setAnnotationPreview(`提交修图任务失败：${message}`)
    } finally {
      setIsSubmittingEdit(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <Sparkles size={18} />
          <span>ai-draw</span>
        </div>
        <div className="canvas-title">
          <strong>{state?.metadata.name ?? 'Untitled ai-draw'}</strong>
          <span>{state?.canvasId ?? 'opening...'}</span>
        </div>
        <div className={`save-status save-status--${status}`}>
          <CheckCircle2 size={15} />
          {status === 'saved' ? '已保存' : status === 'connected' ? '已连接' : status === 'error' ? '错误' : '连接中'}
        </div>
        <button className="topbar-button" onClick={saveSnapshot}>
          <Save size={16} />
          保存画布
        </button>
      </header>

      <aside className="sidebar sidebar-left">
        <section>
          <h2>Pages</h2>
          <button className="row row-active">
            <Layers3 size={16} />
            主画布
          </button>
        </section>
        <section>
          <h2>图片</h2>
          {aiImages.length === 0 ? (
            <p className="empty">还没有生成图片。</p>
          ) : (
            aiImages.map((image) => (
              <button className="row" key={image.id}>
                <ImageIcon size={16} />
                v{image.version ?? 1} {image.id.replace('shape:', '')}
              </button>
            ))
          )}
        </section>
        <section>
          <h2>参考图</h2>
          {referenceImages.length === 0 ? (
            <p className="empty">还没有上传参考图。</p>
          ) : (
            referenceImages.map((image) => (
              <button className="row" key={image.id}>
                <ImageIcon size={16} />
                {image.meta?.title ?? image.id.replace('shape:', '')}
              </button>
            ))
          )}
        </section>
        <section>
          <h2>版本</h2>
          <div className="version-chain">
            {aiImages.map((image, index) => (
              <span key={image.id}>{index > 0 ? ` -> v${image.version ?? index + 1}` : `v${image.version ?? 1}`}</span>
            ))}
          </div>
        </section>
      </aside>

      <main className="canvas-stage">
        <div className="canvas-frame">
          <Tldraw persistenceKey="ai-draw-local" onMount={handleMount} />
        </div>
        <div className="floating-toolbar">
          <button
            className={activeTool === 'select' ? 'tool-active' : undefined}
            title="选择"
            onClick={() => activateTool('select')}
          >
            <MousePointer2 size={18} />
          </button>
          <button
            className={activeTool === 'arrow' ? 'tool-active' : undefined}
            title="流程连线"
            onClick={() => activateTool('arrow')}
          >
            <ArrowRight size={18} />
          </button>
          <button
            className={activeTool === 'text' ? 'tool-active' : undefined}
            title="文字说明"
            onClick={() => activateTool('text')}
          >
            <Type size={18} />
          </button>
          <button title="新建图片框" onClick={createDefaultHolder}>
            <Box size={18} />
          </button>
          <button title="保存画布" onClick={saveSnapshot}>
            <Save size={18} />
          </button>
        </div>
      </main>

      <aside className="sidebar sidebar-right">
        <section>
          <h2>AI 操作</h2>
          <div className={`listener-card listener-card--${listenerView.kind}`}>
            <strong>{listenerView.title}</strong>
            <span>{listenerView.detail}</span>
          </div>
          <button className="primary-action" onClick={createDefaultHolder}>
            <Box size={16} />
            新建图片框
          </button>
          <input
            ref={referenceInputRef}
            className="hidden-file-input"
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => void uploadReferenceImages(event.target.files)}
          />
          <button
            className="action"
            disabled={isUploadingReferences}
            onClick={() => referenceInputRef.current?.click()}
          >
            <ImageIcon size={16} />
            {isUploadingReferences ? '正在上传参考图' : '上传参考图'}
          </button>
          <button
            className="action"
            disabled={isComposingReferences || selectedReferenceImages.length < 2}
            onClick={() => void composeSelectedReferenceImages()}
          >
            <Sparkles size={16} />
            {isComposingReferences ? '正在合成参考图' : '合成参考图'}
          </button>
          <button
            className="action"
            disabled={isRunningWorkflow}
            onClick={() => void runWorkflow()}
          >
            <ArrowRight size={16} />
            {isRunningWorkflow ? '正在按流程生成' : '按流程生成'}
          </button>
          <button className="action" onClick={submitAnnotationEdit}>
            <Wand2 size={16} />
            {isSubmittingEdit ? '正在提交' : '按标注修图'}
          </button>
          <details className="advanced-actions">
            <summary>更多操作</summary>
            <button className="action" onClick={saveSnapshot}>
              <Save size={16} />
              保存画布
            </button>
            <div className="settings-panel">
              <div className="settings-header">
                <strong>图片接口设置</strong>
                <span>{providerStatus?.hasApiKey ? '已保存 Key' : '未保存 Key'}</span>
              </div>
              <div className="provider-preset">
                <div>
                  <strong>推荐第三方 API</strong>
                  <span>happyhorse.pics 支持 gpt-image-2、banana2、gemini-3.0-pro-image 和 1k / 2k / 4k。</span>
                </div>
                <button type="button" onClick={applyHappyHorsePreset}>
                  填入推荐
                </button>
              </div>
              <label>
                <span>Base URL</span>
                <input
                  value={providerForm.baseUrl}
                  placeholder={HAPPYHORSE_PROVIDER.baseUrl}
                  onChange={(event) => updateProviderForm('baseUrl', event.target.value)}
                />
              </label>
              <label>
                <span>API Key</span>
                <input
                  value={providerForm.apiKey}
                  type="password"
                  placeholder={providerStatus?.hasApiKey ? '留空则保留已保存 Key' : '请输入 API Key'}
                  onChange={(event) => updateProviderForm('apiKey', event.target.value)}
                />
              </label>
              <div className="settings-grid">
                <label>
                  <span>模型</span>
                  <input
                    value={providerForm.model}
                    list="happyhorse-model-options"
                    onChange={(event) => updateProviderForm('model', event.target.value)}
                  />
                  <datalist id="happyhorse-model-options">
                    {HAPPYHORSE_PROVIDER.models.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </label>
                <label>
                  <span>尺寸</span>
                  <input
                    value={providerForm.size}
                    list="happyhorse-size-options"
                    onChange={(event) => updateProviderForm('size', event.target.value)}
                  />
                  <datalist id="happyhorse-size-options">
                    {HAPPYHORSE_PROVIDER.sizes.map((size) => (
                      <option key={size} value={size} />
                    ))}
                  </datalist>
                </label>
              </div>
              <div className="settings-grid">
                <label>
                  <span>质量</span>
                  <select
                    value={providerForm.quality}
                    onChange={(event) => updateProviderForm('quality', event.target.value)}
                  >
                    <option value="auto">auto</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </label>
                <label>
                  <span>格式</span>
                  <select
                    value={providerForm.outputFormat}
                    onChange={(event) => updateProviderForm('outputFormat', event.target.value)}
                  >
                    <option value="png">png</option>
                    <option value="jpeg">jpeg</option>
                    <option value="webp">webp</option>
                  </select>
                </label>
              </div>
              <div className="settings-grid">
                <label>
                  <span>轮询 ms</span>
                  <input
                    value={providerForm.pollIntervalMs}
                    inputMode="numeric"
                    onChange={(event) => updateProviderForm('pollIntervalMs', event.target.value)}
                  />
                </label>
                <label>
                  <span>超时 ms</span>
                  <input
                    value={providerForm.timeoutMs}
                    inputMode="numeric"
                    onChange={(event) => updateProviderForm('timeoutMs', event.target.value)}
                  />
                </label>
              </div>
              <button className="action" onClick={saveImageProvider}>
                保存图片接口
              </button>
              <p className="settings-note">{providerMessage}</p>
            </div>
          </details>
        </section>
        <section>
          <h2>选中内容</h2>
          {selected.length === 0 ? (
            <p className="empty">当前没有选中内容。</p>
          ) : (
            selected.map((shape) => (
              <div className="metadata-card" key={shape.id}>
                <div>
                  <strong>{shape.role ?? shape.type}</strong>
                  <span>{shape.id}</span>
                </div>
                <code>
                  {Math.round(shape.bounds.w)} x {Math.round(shape.bounds.h)}
                </code>
              </div>
            ))
          )}
        </section>
        <section>
          <h2>任务记录</h2>
          <pre className="json-preview">{annotationPreview}</pre>
        </section>
        <section>
          <h2>保存位置</h2>
          <p className="path-text">{state?.storagePath ?? 'Opening canvas storage...'}</p>
          {lastError ? <p className="error-text">{lastError}</p> : null}
        </section>
      </aside>

      <footer className="statusbar">
        <span>{holders.length} holders</span>
        <span>{aiImages.length} AI images</span>
        <span>{referenceImages.length} references</span>
        <span>{state?.shapes.length ?? 0} shapes</span>
        <span className="statusbar-command">
          <Braces size={14} />
          MCP 已就绪
        </span>
        <span>
          <ArrowRight size={14} />
          新版会放到右侧
        </span>
      </footer>
    </div>
  )
}
