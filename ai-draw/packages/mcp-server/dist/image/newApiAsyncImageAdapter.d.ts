import type { ImageEditRequest, ImageGenerationRequest, ImageResult } from '@ai-canvas/shared';
type NewApiAsyncImageAdapterOptions = {
    baseUrl?: string;
    apiKey?: string;
    workspaceRoot?: string;
    defaultModel?: string;
    defaultSize?: string;
    defaultQuality?: string;
    defaultOutputFormat?: 'png' | 'jpeg' | 'webp';
    pollIntervalMs?: number;
    timeoutMs?: number;
};
export declare class NewApiAsyncImageAdapter {
    private readonly options;
    constructor(options?: NewApiAsyncImageAdapterOptions);
    static isConfigured(workspaceRoot?: string): Promise<boolean>;
    generateImage(request: ImageGenerationRequest): Promise<ImageResult>;
    editImage(request: ImageEditRequest): Promise<ImageResult>;
    private resolveConfig;
    private postJson;
    private postForm;
    private poll;
    private saveImageItem;
}
export {};
//# sourceMappingURL=newApiAsyncImageAdapter.d.ts.map