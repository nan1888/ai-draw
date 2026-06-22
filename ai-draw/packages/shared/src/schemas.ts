import { z } from 'zod'

export const boundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive()
})

export const openCanvasInputSchema = z.object({
  workspaceRoot: z.string().optional(),
  canvasId: z.string().optional(),
  port: z.number().int().positive().optional()
})

export const createImageHolderInputSchema = z.object({
  label: z.string().default('AI 图片'),
  aspectRatio: z.string().default('5:7'),
  x: z.number().default(100),
  y: z.number().default(100),
  w: z.number().positive().default(403),
  h: z.number().positive().default(567)
})

export const insertImageIntoHolderInputSchema = z.object({
  holderShapeId: z.string(),
  imagePath: z.string(),
  mode: z.enum(['contain', 'cover']).default('contain'),
  title: z.string().default('AI 图片')
})

export const collectAnnotationsInputSchema = z.object({
  targetShapeId: z.string().optional(),
  radius: z.number().positive().default(300),
  includeScreenshot: z.boolean().default(true)
})

export const createImageVersionInputSchema = z.object({
  sourceShapeId: z.string(),
  imagePath: z.string(),
  placement: z.enum(['right', 'replace']).default('right'),
  title: z.string().default('AI 图片 v2'),
  runId: z.string().optional()
})

export const prepareImageGenerationInputSchema = openCanvasInputSchema.extend({
  request: z.string().describe('The user natural-language image request.'),
  aspectRatio: z.string().default('5:7'),
  label: z.string().default('AI 图片'),
  intendedUse: z.string().optional(),
  x: z.number().default(120),
  y: z.number().default(100),
  w: z.number().positive().optional(),
  h: z.number().positive().optional()
})

export const prepareAnnotationEditInputSchema = openCanvasInputSchema.extend({
  targetShapeId: z.string().optional(),
  userRequest: z.string().optional(),
  radius: z.number().positive().default(300),
  includeScreenshot: z.boolean().default(true)
})

export const editRequestStatusSchema = z.enum([
  'queued',
  'processing',
  'completed',
  'failed',
  'needs_clarification'
])

export const watchEditRequestsInputSchema = openCanvasInputSchema.extend({
  waitMs: z.number().int().min(0).max(55_000).default(30_000),
  claim: z.boolean().default(true),
  includeCompleted: z.boolean().default(false)
})

export const getEditRequestInputSchema = z.object({
  requestId: z.string()
})

export const getEditRequestEventsInputSchema = z.object({
  requestId: z.string().optional()
})

export const updateEditRequestInputSchema = z.object({
  requestId: z.string(),
  status: editRequestStatusSchema,
  error: z.string().optional(),
  result: z.record(z.unknown()).optional()
})

export const saveSnapshotInputSchema = z.object({})

export const imageGenerationProviderOptionsSchema = z.object({
  model: z.string().optional(),
  size: z.string().optional(),
  quality: z.string().optional(),
  responseFormat: z.enum(['url', 'b64_json']).optional(),
  outputFormat: z.enum(['png', 'jpeg', 'webp']).optional(),
  outputCompression: z.number().int().min(0).max(100).optional(),
  background: z.string().optional(),
  moderation: z.string().optional(),
  resolution: z.string().optional(),
  aspectRatio: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  pollIntervalMs: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional()
})

export const imageProviderSettingsSchema = z.object({
  baseUrl: z.string().trim().optional(),
  apiKey: z.string().optional(),
  model: z.string().trim().optional(),
  size: z.string().trim().optional(),
  quality: z.string().trim().optional(),
  outputFormat: z.enum(['png', 'jpeg', 'webp']).optional(),
  pollIntervalMs: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional()
})

export const generateImageIntoHolderInputSchema = prepareImageGenerationInputSchema.extend({
  provider: imageGenerationProviderOptionsSchema.optional(),
  autoSave: z.boolean().default(true)
})

export const editImageFromAnnotationsInputSchema = prepareAnnotationEditInputSchema.extend({
  provider: imageGenerationProviderOptionsSchema.optional(),
  placement: z.enum(['right', 'replace']).default('right'),
  title: z.string().default('AI 图片 v2'),
  autoSave: z.boolean().default(true)
})

export const processNextEditRequestInputSchema = watchEditRequestsInputSchema.extend({
  provider: imageGenerationProviderOptionsSchema.optional(),
  placement: z.enum(['right', 'replace']).default('right'),
  title: z.string().default('AI 图片 v2'),
  autoSave: z.boolean().default(true)
})

export type OpenCanvasInput = z.infer<typeof openCanvasInputSchema>
export type CreateImageHolderInput = z.infer<typeof createImageHolderInputSchema>
export type InsertImageIntoHolderInput = z.infer<typeof insertImageIntoHolderInputSchema>
export type CollectAnnotationsInput = z.infer<typeof collectAnnotationsInputSchema>
export type CreateImageVersionInput = z.infer<typeof createImageVersionInputSchema>
export type PrepareImageGenerationInput = z.infer<typeof prepareImageGenerationInputSchema>
export type PrepareAnnotationEditInput = z.infer<typeof prepareAnnotationEditInputSchema>
export type WatchEditRequestsInput = z.infer<typeof watchEditRequestsInputSchema>
export type GetEditRequestInput = z.infer<typeof getEditRequestInputSchema>
export type GetEditRequestEventsInput = z.infer<typeof getEditRequestEventsInputSchema>
export type UpdateEditRequestInput = z.infer<typeof updateEditRequestInputSchema>
export type GenerateImageIntoHolderInput = z.infer<typeof generateImageIntoHolderInputSchema>
export type EditImageFromAnnotationsInput = z.infer<typeof editImageFromAnnotationsInputSchema>
export type ProcessNextEditRequestInput = z.infer<typeof processNextEditRequestInputSchema>
