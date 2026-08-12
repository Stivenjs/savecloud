/**
 * @module VideoRenderer
 * @description Fábrica y capa de abstracción unificada para el renderizado de video en tiempo real.
 *
 * Selecciona automáticamente la mejor tecnología de renderizado disponible en el sistema cliente:
 * 1. WebGPU (Renderizado Directo en VRAM 0-Copy vía importExternalTexture)
 * 2. WebGL2 (Texturas aceleradas por GPU vía ANGLE / OpenGL / Direct3D)
 * 3. Canvas2D (Fallback de emergencia legacy)
 */

import { createWebGPURenderer, WebGPURendererInstance } from "./WebGPURenderer";
import { createWebGL2Renderer, WebGL2RendererInstance } from "./WebGL2Renderer";

/** Identificador de la tecnología de renderizado activa. */
export type VideoRendererBackend = "webgpu" | "webgl2" | "canvas2d";

/**
 * Interfaz común para todos los backend de renderizado de video.
 */
export interface VideoRenderer {
  /** Backend de hardware o software activo actualmente. */
  backend: VideoRendererBackend;
  /** Renderiza un fotograma decodificado (VideoFrame). */
  render: (frame: VideoFrame) => void;
  /** Actualiza la dimensión física y viewport del canvas. */
  resize: (width: number, height: number) => void;
  /** Libera todos los recursos asociados al renderizador. */
  destroy: () => void;
}

/**
 * Renderizador de respaldo Canvas2D legacy en caso de fallo en aceleración 3D.
 */
function createCanvas2DRenderer(canvas: HTMLCanvasElement): VideoRenderer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  return {
    backend: "canvas2d",
    render: (frame: VideoFrame) => {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    },
    resize: (w: number, h: number) => {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    },
    destroy: () => {},
  };
}

/**
 * Crea e inicializa el mejor renderizador de video disponible para el elemento canvas dado.
 *
 * @param {HTMLCanvasElement} canvas Elemento HTMLCanvasElement sobre el que se dibujará la transmisión.
 * @returns {Promise<VideoRenderer>} Instancia del renderizador unificado.
 */
export async function createVideoRenderer(canvas: HTMLCanvasElement): Promise<VideoRenderer> {
  // 1. Intentar inicializar WebGPU (0-Copy Direct VRAM)
  try {
    const gpuRenderer: WebGPURendererInstance | null = await createWebGPURenderer(canvas);
    if (gpuRenderer) {
      console.log("[VideoRenderer] Seleccionado motor primario: WebGPU 0-Copy Direct VRAM.");
      return {
        backend: "webgpu",
        render: gpuRenderer.render,
        resize: gpuRenderer.resize,
        destroy: gpuRenderer.destroy,
      };
    }
  } catch (err) {
    console.warn("[VideoRenderer] Fallo la inicialización de WebGPU, intentando fallback WebGL2:", err);
  }

  // 2. Intentar inicializar WebGL2 (Aceleración por GPU)
  try {
    const webgl2Renderer: WebGL2RendererInstance | null = createWebGL2Renderer(canvas);
    if (webgl2Renderer) {
      console.log("[VideoRenderer] Seleccionado motor secundario: WebGL2 Hardware Accelerated.");
      return {
        backend: "webgl2",
        render: webgl2Renderer.render,
        resize: webgl2Renderer.resize,
        destroy: webgl2Renderer.destroy,
      };
    }
  } catch (err) {
    console.warn("[VideoRenderer] Fallo la inicialización de WebGL2, intentando fallback Canvas2D:", err);
  }

  // 3. Fallback a Canvas 2D
  const canvas2dRenderer = createCanvas2DRenderer(canvas);
  if (canvas2dRenderer) {
    console.warn("[VideoRenderer] Seleccionado motor fallback legacy: Canvas 2D Context.");
    return canvas2dRenderer;
  }

  throw new Error("[VideoRenderer] No se pudo inicializar ningún motor de renderizado (WebGPU, WebGL2 ni Canvas2D).");
}
