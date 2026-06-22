import type { CanvasStatePayload } from '@ai-canvas/shared'
import { describe, expect, it } from 'vitest'
import { parseAnnotations } from './parseAnnotations.js'

function state(overrides: Partial<CanvasStatePayload> = {}): CanvasStatePayload {
  const base: CanvasStatePayload = {
    canvasId: 'canvas_test',
    storagePath: '/tmp/canvas',
    metadata: {
      canvasId: 'canvas_test',
      name: 'Test',
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
      workspaceRoot: '/tmp',
      activePageId: 'page_main',
      appVersion: '0.1.0'
    },
    selection: {
      canvasId: 'canvas_test',
      pageId: 'page_main',
      selectedShapeIds: [],
      shapes: []
    },
    shapes: [
      {
        id: 'shape:image_1',
        type: 'image',
        role: 'ai_image',
        bounds: { x: 100, y: 100, w: 400, h: 500 },
        assetPath: 'assets/images/a.png'
      }
    ]
  }
  return { ...base, ...overrides }
}

describe('parseAnnotations', () => {
  it('turns arrow plus nearby text into a relative edit instruction', () => {
    const result = parseAnnotations({
      radius: 300,
      state: state({
        shapes: [
          {
            id: 'shape:image_1',
            type: 'image',
            role: 'ai_image',
            bounds: { x: 100, y: 100, w: 400, h: 500 },
            assetPath: 'assets/images/a.png'
          },
          {
            id: 'shape:arrow_1',
            type: 'arrow',
            bounds: { x: 80, y: 260, w: 170, h: 80 },
            arrowStart: { x: 80, y: 260 },
            arrowEnd: { x: 240, y: 330 }
          },
          {
            id: 'shape:text_1',
            type: 'text',
            bounds: { x: 40, y: 220, w: 120, h: 40 },
            text: '这里用白汤'
          }
        ]
      })
    })

    expect(result.needsClarification).toBe(false)
    expect(result.annotationPlan).toHaveLength(1)
    expect(result.annotationPlan[0].instruction).toBe('这里用白汤')
    expect(result.annotationPlan[0].region.x).toBeGreaterThan(0.2)
    expect(result.annotationPlan[0].region.y).toBeGreaterThan(0.3)
  })

  it('asks for clarification when there are multiple images and no selected target', () => {
    const result = parseAnnotations({
      radius: 300,
      state: state({
        shapes: [
          {
            id: 'shape:image_1',
            type: 'image',
            role: 'ai_image',
            bounds: { x: 100, y: 100, w: 400, h: 500 }
          },
          {
            id: 'shape:image_2',
            type: 'image',
            role: 'ai_image',
            bounds: { x: 600, y: 100, w: 400, h: 500 }
          }
        ]
      })
    })

    expect(result.needsClarification).toBe(true)
    expect(result.clarificationReason).toContain('Multiple')
  })

  it('uses selected annotations to choose the nearest image version', () => {
    const selectedText = {
      id: 'shape:text_2',
      type: 'text',
      bounds: { x: 1080, y: 220, w: 120, h: 40 },
      text: '加一只虾'
    }
    const selectedArrow = {
      id: 'shape:arrow_2',
      type: 'arrow',
      bounds: { x: 1080, y: 260, w: 170, h: 80 },
      arrowStart: { x: 1080, y: 260 },
      arrowEnd: { x: 1220, y: 330 }
    }
    const result = parseAnnotations({
      radius: 300,
      state: state({
        selection: {
          canvasId: 'canvas_test',
          pageId: 'page_main',
          selectedShapeIds: ['shape:text_2', 'shape:arrow_2'],
          shapes: [selectedText, selectedArrow]
        },
        shapes: [
          {
            id: 'shape:image_1',
            type: 'image',
            role: 'ai_image',
            bounds: { x: 100, y: 100, w: 400, h: 500 },
            assetPath: 'assets/images/a.png',
            version: 1
          },
          {
            id: 'shape:image_2',
            type: 'image',
            role: 'ai_image',
            bounds: { x: 1000, y: 100, w: 400, h: 500 },
            assetPath: 'assets/images/b.png',
            version: 2
          },
          selectedArrow,
          selectedText
        ]
      })
    })

    expect(result.needsClarification).toBe(false)
    expect(result.targetShapeId).toBe('shape:image_2')
    expect(result.annotationPlan[0].instruction).toBe('加一只虾')
  })

  it('excludes annotations that were already consumed by a completed edit', () => {
    const result = parseAnnotations({
      radius: 300,
      excludeShapeIds: ['shape:arrow_1', 'shape:text_1'],
      state: state({
        shapes: [
          {
            id: 'shape:image_1',
            type: 'image',
            role: 'ai_image',
            bounds: { x: 100, y: 100, w: 400, h: 500 },
            assetPath: 'assets/images/a.png'
          },
          {
            id: 'shape:arrow_1',
            type: 'arrow',
            bounds: { x: 80, y: 260, w: 170, h: 80 },
            arrowStart: { x: 80, y: 260 },
            arrowEnd: { x: 240, y: 330 }
          },
          {
            id: 'shape:text_1',
            type: 'text',
            bounds: { x: 40, y: 220, w: 120, h: 40 },
            text: '旧标注不要再用'
          }
        ]
      })
    })

    expect(result.needsClarification).toBe(true)
    expect(result.annotationPlan).toHaveLength(0)
    expect(result.clarificationReason).toContain('No nearby annotations')
  })

  it('ignores internal version connector arrows', () => {
    const result = parseAnnotations({
      radius: 300,
      state: state({
        shapes: [
          {
            id: 'shape:image_1',
            type: 'image',
            role: 'ai_image',
            bounds: { x: 100, y: 100, w: 400, h: 500 },
            assetPath: 'assets/images/a.png'
          },
          {
            id: 'shape:version_arrow_1',
            type: 'arrow',
            role: 'version_group',
            bounds: { x: 540, y: 320, w: 60, h: 40 },
            arrowStart: { x: 540, y: 340 },
            arrowEnd: { x: 600, y: 340 }
          }
        ]
      })
    })

    expect(result.needsClarification).toBe(true)
    expect(result.annotationPlan).toHaveLength(0)
    expect(result.clarificationReason).toContain('No nearby annotations')
  })
})
