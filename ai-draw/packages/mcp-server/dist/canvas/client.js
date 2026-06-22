import { startCanvasService, waitForHealth } from './process.js';
import { findPluginRoot } from '../utils/paths.js';
let runtime;
async function parseJson(response) {
    const text = await response.text();
    if (!response.ok) {
        throw new Error(text || response.statusText);
    }
    return JSON.parse(text);
}
async function fetchJsonAt(apiPath, base) {
    const response = await fetch(`${base}${apiPath}`);
    return parseJson(response);
}
async function postJsonAt(apiPath, body, base) {
    const response = await fetch(`${base}${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return parseJson(response);
}
async function waitForCompatibleCanvas(url, timeoutMs, expectedPluginRoot) {
    await waitForHealth(url, timeoutMs);
    const health = await fetchJsonAt('/api/health', url);
    if (!health.features?.includes('editRequestQueue')) {
        throw new Error(`Canvas service at ${url} is an older build without edit request queue support.`);
    }
    if (expectedPluginRoot && health.pluginRoot !== expectedPluginRoot) {
        throw new Error(`Canvas service at ${url} belongs to a different AI Canvas plugin build.`);
    }
    return health;
}
export function getCanvasRuntime() {
    return runtime;
}
export async function openCanvas(input) {
    const workspaceRoot = input.workspaceRoot ?? process.cwd();
    const requestedPort = input.port ?? Number(process.env.AI_CANVAS_PORT ?? 43218);
    const existingUrl = `http://127.0.0.1:${requestedPort}`;
    const pluginRoot = findPluginRoot(import.meta.url);
    try {
        await waitForCompatibleCanvas(existingUrl, 600, pluginRoot);
        runtime = { url: existingUrl, port: requestedPort, canvasId: input.canvasId ?? '', storagePath: '' };
    }
    catch {
        const started = await startCanvasService({
            pluginRoot,
            workspaceRoot,
            canvasId: input.canvasId,
            requestedPort
        });
        runtime = { url: started.url, port: started.port, canvasId: input.canvasId ?? '', storagePath: '' };
    }
    const result = await postJsonAt('/api/canvas/open', { workspaceRoot, canvasId: input.canvasId }, runtime.url);
    runtime = {
        url: result.url.replace(/\/$/, ''),
        canvasId: result.canvasId,
        storagePath: result.storagePath,
        port: Number(new URL(result.url).port)
    };
    return result;
}
export async function ensureCanvas() {
    if (runtime)
        return runtime;
    const port = Number(process.env.AI_CANVAS_PORT ?? 43218);
    const url = process.env.AI_CANVAS_URL?.replace(/\/$/, '') ?? `http://127.0.0.1:${port}`;
    const pluginRoot = findPluginRoot(import.meta.url);
    try {
        await waitForCompatibleCanvas(url, 1_000, pluginRoot);
    }
    catch {
        await openCanvas({ workspaceRoot: process.cwd(), port });
        if (!runtime)
            throw new Error('Canvas runtime was not initialized.');
        return runtime;
    }
    const state = await fetchJsonAt('/api/canvas/state', url);
    runtime = {
        url,
        canvasId: state.canvasId,
        storagePath: state.storagePath,
        port
    };
    return runtime;
}
export async function fetchJson(apiPath, explicitUrl) {
    const base = explicitUrl ?? (await ensureCanvas()).url;
    const response = await fetch(`${base}${apiPath}`);
    return parseJson(response);
}
export async function postJson(apiPath, body) {
    const base = (await ensureCanvas()).url;
    const response = await fetch(`${base}${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return parseJson(response);
}
export async function getCanvasState() {
    return fetchJson('/api/canvas/state');
}
export async function getSelection() {
    return fetchJson('/api/canvas/selection');
}
