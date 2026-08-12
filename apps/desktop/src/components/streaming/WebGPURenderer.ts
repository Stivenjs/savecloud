/**
 * @module WebGPURenderer
 * @description Renderizador de video de ultra baja latencia utilizando WebGPU API.
 *
 * Realiza importación directa de fotogramas de la GPU (0-Copy Direct VRAM) mediante
 * `GPUDevice.importExternalTexture()`, eliminando copias entre CPU y GPU o buffers intermedios.
 */

export interface WebGPURendererInstance {
  /** Renderiza un fotograma de video decodificado directamente desde VRAM sin copia de memoria. */
  render: (frame: VideoFrame) => void;
  /** Actualiza el viewport del swapchain cuando cambia el tamaño del canvas. */
  resize: (width: number, height: number) => void;
  /** Libera todos los recursos WebGPU (device, context, pipeline). */
  destroy: () => void;
}

const WGSL_SHADER_CODE = /* wgsl */ `
struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
  var pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0)
  );
  var texCoord = array<vec2<f32>, 4>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0)
  );
  var output : VertexOutput;
  output.position = vec4<f32>(pos[VertexIndex], 0.0, 1.0);
  output.uv = texCoord[VertexIndex];
  return output;
}

@group(0) @binding(0) var myTexture: texture_external;
@group(0) @binding(1) var mySampler: sampler;

@fragment
fn fs_main(@location(0) uv : vec2<f32>) -> @location(0) vec4<f32> {
  return textureSampleBaseClampToEdge(myTexture, mySampler, uv);
}
`;

/**
 * Inicializa un renderizador WebGPU de 0-Copy sobre el canvas dado.
 *
 * @param {HTMLCanvasElement} canvas Elemento HTMLCanvasElement sobre el cual renderizar.
 * @returns {Promise<WebGPURendererInstance | null>} Instancia del renderizador o null si WebGPU no está soportado.
 */
export async function createWebGPURenderer(canvas: HTMLCanvasElement): Promise<WebGPURendererInstance | null> {
  if (!navigator.gpu) {
    console.warn("[WebGPURenderer] navigator.gpu no está disponible en este entorno.");
    return null;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });

    if (!adapter) {
      console.warn("[WebGPURenderer] No se encontró adaptador GPU compatible para WebGPU.");
      return null;
    }

    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu") as unknown as GPUCanvasContext | null;

    if (!context) {
      console.warn("[WebGPURenderer] No se pudo obtener el contexto webgpu del canvas.");
      return null;
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format,
      alphaMode: "opaque",
    });

    const shaderModule = device.createShaderModule({
      label: "StreamingVideoShader",
      code: WGSL_SHADER_CODE,
    });

    const pipeline = device.createRenderPipeline({
      label: "StreamingVideoPipeline",
      layout: "auto",
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [{ format }],
      },
      primitive: {
        topology: "triangle-strip",
      },
    });

    const sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });

    let isDestroyed = false;

    const render = (frame: VideoFrame): void => {
      if (isDestroyed || !device || !frame) return;

      try {
        const externalTexture = device.importExternalTexture({
          source: frame,
        });

        const bindGroup = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: externalTexture },
            { binding: 1, resource: sampler },
          ],
        });

        const commandEncoder = device.createCommandEncoder();
        const textureView = context.getCurrentTexture().createView();

        const renderPass = commandEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: textureView,
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });

        renderPass.setPipeline(pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(4, 1, 0, 0);
        renderPass.end();

        device.queue.submit([commandEncoder.finish()]);
      } catch (e) {
        console.error("[WebGPURenderer] Error durante el renderizado del fotograma:", e);
      }
    };

    const resize = (width: number, height: number): void => {
      if (isDestroyed) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        context.configure({
          device,
          format,
          alphaMode: "opaque",
        });
      }
    };

    const destroy = (): void => {
      isDestroyed = true;
      try {
        device.destroy();
      } catch (e) {
        console.warn("[WebGPURenderer] Excepción al destruir la instancia de device:", e);
      }
    };

    console.log("[WebGPURenderer] Renderizador WebGPU (0-Copy Direct VRAM) inicializado correctamente.");
    return { render, resize, destroy };
  } catch (err) {
    console.error("[WebGPURenderer] Fallo al inicializar WebGPU:", err);
    return null;
  }
}
