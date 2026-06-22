import type { ImageCompositionRequest, ImageEditRequest, ImageProviderEvent, ImageGenerationRequest, ImageResult } from '@ai-canvas/shared';
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
    onEvent?: (event: ImageProviderEvent) => void | Promise<void>;
};
export declare class NewApiAsyncImageAdapter {
    private readonly options;
    constructor(options?: NewApiAsyncImageAdapterOptions);
    static isConfigured(workspaceRoot?: string): Promise<boolean>;
    private emit;
    generateImage(request: ImageGenerationRequest): Promise<ImageResult>;
    editImage(request: ImageEditRequest): Promise<ImageResult>;
    composeImages(request: ImageCompositionRequest): Promise<ImageResult>;
    private resolveConfig;
    private postJson;
    private postForm;
    private poll;
    private saveImageItem;
}
export {};
//# sourceMappingURL=newApiAsyncImageAdapter.d.ts.map