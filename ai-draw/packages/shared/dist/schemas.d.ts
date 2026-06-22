import { z } from 'zod';
export declare const boundsSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    w: z.ZodNumber;
    h: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    x: number;
    y: number;
    w: number;
    h: number;
}, {
    x: number;
    y: number;
    w: number;
    h: number;
}>;
export declare const openCanvasInputSchema: z.ZodObject<{
    workspaceRoot: z.ZodOptional<z.ZodString>;
    canvasId: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    workspaceRoot?: string | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
}, {
    workspaceRoot?: string | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
}>;
export declare const createImageHolderInputSchema: z.ZodObject<{
    label: z.ZodDefault<z.ZodString>;
    aspectRatio: z.ZodDefault<z.ZodString>;
    x: z.ZodDefault<z.ZodNumber>;
    y: z.ZodDefault<z.ZodNumber>;
    w: z.ZodDefault<z.ZodNumber>;
    h: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    x: number;
    y: number;
    w: number;
    h: number;
    label: string;
    aspectRatio: string;
}, {
    x?: number | undefined;
    y?: number | undefined;
    w?: number | undefined;
    h?: number | undefined;
    label?: string | undefined;
    aspectRatio?: string | undefined;
}>;
export declare const insertImageIntoHolderInputSchema: z.ZodObject<{
    holderShapeId: z.ZodString;
    imagePath: z.ZodString;
    mode: z.ZodDefault<z.ZodEnum<["contain", "cover"]>>;
    title: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    imagePath: string;
    holderShapeId: string;
    mode: "contain" | "cover";
    title: string;
}, {
    imagePath: string;
    holderShapeId: string;
    mode?: "contain" | "cover" | undefined;
    title?: string | undefined;
}>;
export declare const collectAnnotationsInputSchema: z.ZodObject<{
    targetShapeId: z.ZodOptional<z.ZodString>;
    radius: z.ZodDefault<z.ZodNumber>;
    includeScreenshot: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    radius: number;
    includeScreenshot: boolean;
    targetShapeId?: string | undefined;
}, {
    targetShapeId?: string | undefined;
    radius?: number | undefined;
    includeScreenshot?: boolean | undefined;
}>;
export declare const createImageVersionInputSchema: z.ZodObject<{
    sourceShapeId: z.ZodString;
    imagePath: z.ZodString;
    placement: z.ZodDefault<z.ZodEnum<["right", "replace"]>>;
    title: z.ZodDefault<z.ZodString>;
    runId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    imagePath: string;
    title: string;
    sourceShapeId: string;
    placement: "replace" | "right";
    runId?: string | undefined;
}, {
    imagePath: string;
    sourceShapeId: string;
    title?: string | undefined;
    placement?: "replace" | "right" | undefined;
    runId?: string | undefined;
}>;
export declare const prepareImageGenerationInputSchema: z.ZodObject<{
    workspaceRoot: z.ZodOptional<z.ZodString>;
    canvasId: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
} & {
    request: z.ZodString;
    aspectRatio: z.ZodDefault<z.ZodString>;
    label: z.ZodDefault<z.ZodString>;
    intendedUse: z.ZodOptional<z.ZodString>;
    x: z.ZodDefault<z.ZodNumber>;
    y: z.ZodDefault<z.ZodNumber>;
    w: z.ZodOptional<z.ZodNumber>;
    h: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    x: number;
    y: number;
    label: string;
    aspectRatio: string;
    request: string;
    workspaceRoot?: string | undefined;
    w?: number | undefined;
    h?: number | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
    intendedUse?: string | undefined;
}, {
    request: string;
    workspaceRoot?: string | undefined;
    x?: number | undefined;
    y?: number | undefined;
    w?: number | undefined;
    h?: number | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
    label?: string | undefined;
    aspectRatio?: string | undefined;
    intendedUse?: string | undefined;
}>;
export declare const prepareAnnotationEditInputSchema: z.ZodObject<{
    workspaceRoot: z.ZodOptional<z.ZodString>;
    canvasId: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
} & {
    targetShapeId: z.ZodOptional<z.ZodString>;
    userRequest: z.ZodOptional<z.ZodString>;
    radius: z.ZodDefault<z.ZodNumber>;
    includeScreenshot: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    radius: number;
    includeScreenshot: boolean;
    workspaceRoot?: string | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
    targetShapeId?: string | undefined;
    userRequest?: string | undefined;
}, {
    workspaceRoot?: string | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
    targetShapeId?: string | undefined;
    radius?: number | undefined;
    includeScreenshot?: boolean | undefined;
    userRequest?: string | undefined;
}>;
export declare const editRequestStatusSchema: z.ZodEnum<["queued", "processing", "completed", "failed", "needs_clarification"]>;
export declare const watchEditRequestsInputSchema: z.ZodObject<{
    workspaceRoot: z.ZodOptional<z.ZodString>;
    canvasId: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
} & {
    waitMs: z.ZodDefault<z.ZodNumber>;
    claim: z.ZodDefault<z.ZodBoolean>;
    includeCompleted: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    waitMs: number;
    claim: boolean;
    includeCompleted: boolean;
    workspaceRoot?: string | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
}, {
    workspaceRoot?: string | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
    waitMs?: number | undefined;
    claim?: boolean | undefined;
    includeCompleted?: boolean | undefined;
}>;
export declare const getEditRequestInputSchema: z.ZodObject<{
    requestId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    requestId: string;
}, {
    requestId: string;
}>;
export declare const getEditRequestEventsInputSchema: z.ZodObject<{
    requestId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    requestId?: string | undefined;
}, {
    requestId?: string | undefined;
}>;
export declare const updateEditRequestInputSchema: z.ZodObject<{
    requestId: z.ZodString;
    status: z.ZodEnum<["queued", "processing", "completed", "failed", "needs_clarification"]>;
    error: z.ZodOptional<z.ZodString>;
    result: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    status: "completed" | "failed" | "queued" | "processing" | "needs_clarification";
    requestId: string;
    result?: Record<string, unknown> | undefined;
    error?: string | undefined;
}, {
    status: "completed" | "failed" | "queued" | "processing" | "needs_clarification";
    requestId: string;
    result?: Record<string, unknown> | undefined;
    error?: string | undefined;
}>;
export declare const saveSnapshotInputSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export declare const imageGenerationProviderOptionsSchema: z.ZodObject<{
    model: z.ZodOptional<z.ZodString>;
    size: z.ZodOptional<z.ZodString>;
    quality: z.ZodOptional<z.ZodString>;
    responseFormat: z.ZodOptional<z.ZodEnum<["url", "b64_json"]>>;
    outputFormat: z.ZodOptional<z.ZodEnum<["png", "jpeg", "webp"]>>;
    outputCompression: z.ZodOptional<z.ZodNumber>;
    background: z.ZodOptional<z.ZodString>;
    moderation: z.ZodOptional<z.ZodString>;
    resolution: z.ZodOptional<z.ZodString>;
    aspectRatio: z.ZodOptional<z.ZodString>;
    imageUrls: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    pollIntervalMs: z.ZodOptional<z.ZodNumber>;
    timeoutMs: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    model?: string | undefined;
    size?: string | undefined;
    quality?: string | undefined;
    outputFormat?: "png" | "jpeg" | "webp" | undefined;
    pollIntervalMs?: number | undefined;
    timeoutMs?: number | undefined;
    outputCompression?: number | undefined;
    background?: string | undefined;
    moderation?: string | undefined;
    resolution?: string | undefined;
    imageUrls?: string[] | undefined;
    aspectRatio?: string | undefined;
    responseFormat?: "url" | "b64_json" | undefined;
}, {
    model?: string | undefined;
    size?: string | undefined;
    quality?: string | undefined;
    outputFormat?: "png" | "jpeg" | "webp" | undefined;
    pollIntervalMs?: number | undefined;
    timeoutMs?: number | undefined;
    outputCompression?: number | undefined;
    background?: string | undefined;
    moderation?: string | undefined;
    resolution?: string | undefined;
    imageUrls?: string[] | undefined;
    aspectRatio?: string | undefined;
    responseFormat?: "url" | "b64_json" | undefined;
}>;
export declare const imageProviderSettingsSchema: z.ZodObject<{
    baseUrl: z.ZodOptional<z.ZodString>;
    apiKey: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    size: z.ZodOptional<z.ZodString>;
    quality: z.ZodOptional<z.ZodString>;
    outputFormat: z.ZodOptional<z.ZodEnum<["png", "jpeg", "webp"]>>;
    pollIntervalMs: z.ZodOptional<z.ZodNumber>;
    timeoutMs: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    apiKey?: string | undefined;
    baseUrl?: string | undefined;
    model?: string | undefined;
    size?: string | undefined;
    quality?: string | undefined;
    outputFormat?: "png" | "jpeg" | "webp" | undefined;
    pollIntervalMs?: number | undefined;
    timeoutMs?: number | undefined;
}, {
    apiKey?: string | undefined;
    baseUrl?: string | undefined;
    model?: string | undefined;
    size?: string | undefined;
    quality?: string | undefined;
    outputFormat?: "png" | "jpeg" | "webp" | undefined;
    pollIntervalMs?: number | undefined;
    timeoutMs?: number | undefined;
}>;
export declare const generateImageIntoHolderInputSchema: z.ZodObject<{
    workspaceRoot: z.ZodOptional<z.ZodString>;
    canvasId: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
} & {
    request: z.ZodString;
    aspectRatio: z.ZodDefault<z.ZodString>;
    label: z.ZodDefault<z.ZodString>;
    intendedUse: z.ZodOptional<z.ZodString>;
    x: z.ZodDefault<z.ZodNumber>;
    y: z.ZodDefault<z.ZodNumber>;
    w: z.ZodOptional<z.ZodNumber>;
    h: z.ZodOptional<z.ZodNumber>;
} & {
    provider: z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        size: z.ZodOptional<z.ZodString>;
        quality: z.ZodOptional<z.ZodString>;
        responseFormat: z.ZodOptional<z.ZodEnum<["url", "b64_json"]>>;
        outputFormat: z.ZodOptional<z.ZodEnum<["png", "jpeg", "webp"]>>;
        outputCompression: z.ZodOptional<z.ZodNumber>;
        background: z.ZodOptional<z.ZodString>;
        moderation: z.ZodOptional<z.ZodString>;
        resolution: z.ZodOptional<z.ZodString>;
        aspectRatio: z.ZodOptional<z.ZodString>;
        imageUrls: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        pollIntervalMs: z.ZodOptional<z.ZodNumber>;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    }, {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    }>>;
    autoSave: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    x: number;
    y: number;
    label: string;
    aspectRatio: string;
    request: string;
    autoSave: boolean;
    workspaceRoot?: string | undefined;
    w?: number | undefined;
    h?: number | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
    intendedUse?: string | undefined;
    provider?: {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    } | undefined;
}, {
    request: string;
    workspaceRoot?: string | undefined;
    x?: number | undefined;
    y?: number | undefined;
    w?: number | undefined;
    h?: number | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
    label?: string | undefined;
    aspectRatio?: string | undefined;
    intendedUse?: string | undefined;
    provider?: {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    } | undefined;
    autoSave?: boolean | undefined;
}>;
export declare const editImageFromAnnotationsInputSchema: z.ZodObject<{
    workspaceRoot: z.ZodOptional<z.ZodString>;
    canvasId: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
} & {
    targetShapeId: z.ZodOptional<z.ZodString>;
    userRequest: z.ZodOptional<z.ZodString>;
    radius: z.ZodDefault<z.ZodNumber>;
    includeScreenshot: z.ZodDefault<z.ZodBoolean>;
} & {
    provider: z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        size: z.ZodOptional<z.ZodString>;
        quality: z.ZodOptional<z.ZodString>;
        responseFormat: z.ZodOptional<z.ZodEnum<["url", "b64_json"]>>;
        outputFormat: z.ZodOptional<z.ZodEnum<["png", "jpeg", "webp"]>>;
        outputCompression: z.ZodOptional<z.ZodNumber>;
        background: z.ZodOptional<z.ZodString>;
        moderation: z.ZodOptional<z.ZodString>;
        resolution: z.ZodOptional<z.ZodString>;
        aspectRatio: z.ZodOptional<z.ZodString>;
        imageUrls: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        pollIntervalMs: z.ZodOptional<z.ZodNumber>;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    }, {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    }>>;
    placement: z.ZodDefault<z.ZodEnum<["right", "replace"]>>;
    title: z.ZodDefault<z.ZodString>;
    autoSave: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    title: string;
    radius: number;
    includeScreenshot: boolean;
    placement: "replace" | "right";
    autoSave: boolean;
    workspaceRoot?: string | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
    targetShapeId?: string | undefined;
    userRequest?: string | undefined;
    provider?: {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    } | undefined;
}, {
    workspaceRoot?: string | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
    title?: string | undefined;
    targetShapeId?: string | undefined;
    radius?: number | undefined;
    includeScreenshot?: boolean | undefined;
    placement?: "replace" | "right" | undefined;
    userRequest?: string | undefined;
    provider?: {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    } | undefined;
    autoSave?: boolean | undefined;
}>;
export declare const processNextEditRequestInputSchema: z.ZodObject<{
    workspaceRoot: z.ZodOptional<z.ZodString>;
    canvasId: z.ZodOptional<z.ZodString>;
    port: z.ZodOptional<z.ZodNumber>;
} & {
    waitMs: z.ZodDefault<z.ZodNumber>;
    claim: z.ZodDefault<z.ZodBoolean>;
    includeCompleted: z.ZodDefault<z.ZodBoolean>;
} & {
    provider: z.ZodOptional<z.ZodObject<{
        model: z.ZodOptional<z.ZodString>;
        size: z.ZodOptional<z.ZodString>;
        quality: z.ZodOptional<z.ZodString>;
        responseFormat: z.ZodOptional<z.ZodEnum<["url", "b64_json"]>>;
        outputFormat: z.ZodOptional<z.ZodEnum<["png", "jpeg", "webp"]>>;
        outputCompression: z.ZodOptional<z.ZodNumber>;
        background: z.ZodOptional<z.ZodString>;
        moderation: z.ZodOptional<z.ZodString>;
        resolution: z.ZodOptional<z.ZodString>;
        aspectRatio: z.ZodOptional<z.ZodString>;
        imageUrls: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        pollIntervalMs: z.ZodOptional<z.ZodNumber>;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    }, {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    }>>;
    placement: z.ZodDefault<z.ZodEnum<["right", "replace"]>>;
    title: z.ZodDefault<z.ZodString>;
    autoSave: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    title: string;
    placement: "replace" | "right";
    waitMs: number;
    claim: boolean;
    includeCompleted: boolean;
    autoSave: boolean;
    workspaceRoot?: string | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
    provider?: {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    } | undefined;
}, {
    workspaceRoot?: string | undefined;
    canvasId?: string | undefined;
    port?: number | undefined;
    title?: string | undefined;
    placement?: "replace" | "right" | undefined;
    waitMs?: number | undefined;
    claim?: boolean | undefined;
    includeCompleted?: boolean | undefined;
    provider?: {
        model?: string | undefined;
        size?: string | undefined;
        quality?: string | undefined;
        outputFormat?: "png" | "jpeg" | "webp" | undefined;
        pollIntervalMs?: number | undefined;
        timeoutMs?: number | undefined;
        outputCompression?: number | undefined;
        background?: string | undefined;
        moderation?: string | undefined;
        resolution?: string | undefined;
        imageUrls?: string[] | undefined;
        aspectRatio?: string | undefined;
        responseFormat?: "url" | "b64_json" | undefined;
    } | undefined;
    autoSave?: boolean | undefined;
}>;
export type OpenCanvasInput = z.infer<typeof openCanvasInputSchema>;
export type CreateImageHolderInput = z.infer<typeof createImageHolderInputSchema>;
export type InsertImageIntoHolderInput = z.infer<typeof insertImageIntoHolderInputSchema>;
export type CollectAnnotationsInput = z.infer<typeof collectAnnotationsInputSchema>;
export type CreateImageVersionInput = z.infer<typeof createImageVersionInputSchema>;
export type PrepareImageGenerationInput = z.infer<typeof prepareImageGenerationInputSchema>;
export type PrepareAnnotationEditInput = z.infer<typeof prepareAnnotationEditInputSchema>;
export type WatchEditRequestsInput = z.infer<typeof watchEditRequestsInputSchema>;
export type GetEditRequestInput = z.infer<typeof getEditRequestInputSchema>;
export type GetEditRequestEventsInput = z.infer<typeof getEditRequestEventsInputSchema>;
export type UpdateEditRequestInput = z.infer<typeof updateEditRequestInputSchema>;
export type GenerateImageIntoHolderInput = z.infer<typeof generateImageIntoHolderInputSchema>;
export type EditImageFromAnnotationsInput = z.infer<typeof editImageFromAnnotationsInputSchema>;
export type ProcessNextEditRequestInput = z.infer<typeof processNextEditRequestInputSchema>;
//# sourceMappingURL=schemas.d.ts.map