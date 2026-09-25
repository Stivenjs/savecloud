/**
 * @module WebGL2Renderer
 * @description Renderizador de video de alto rendimiento con aceleración por hardware basado en WebGL2.
 *
 * Utilizado como fallback preferido cuando WebGPU no está disponible en el entorno cliente.
 * Carga directa de `VideoFrame` a la textura mediante `gl.texImage2D` utilizando compartición de VRAM por ANGLE.
 */

export interface WebGL2RendererInstance {
  /** Renderiza un fotograma de video decodificado a la textura WebGL2. */
  render: (frame: VideoFrame) => void;
  /** Ajusta el viewport de WebGL2 cuando cambia el tamaño del canvas. */
  resize: (width: number, height: number) => void;
  /** Libera los recursos de WebGL2 (program, shaders, texture, buffers). */
  destroy: () => void;
}

const VS_SOURCE = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y);
}
`;

const FS_SOURCE = `#version 300 es
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;

void main() {
    fragColor = texture(u_texture, v_texCoord);
}
`;

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("[WebGL2Renderer] Error al compilar shader:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[WebGL2Renderer] Error al enlazar programa WebGL2:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * Inicializa un renderizador WebGL2 acelerado sobre el canvas especificado.
 *
 * @param {HTMLCanvasElement} canvas Elemento HTMLCanvasElement destino.
 * @returns {WebGL2RendererInstance | null} Instancia del renderizador o null si WebGL2 no está disponible.
 */
export function createWebGL2Renderer(canvas: HTMLCanvasElement): WebGL2RendererInstance | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    desynchronized: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
    antialias: false,
  });

  if (!gl) {
    console.warn("[WebGL2Renderer] No se pudo obtener contexto WebGL2.");
    return null;
  }

  const vs = createShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, FS_SOURCE);

  if (!vs || !fs) {
    return null;
  }

  const program = createProgram(gl, vs, fs);
  if (!program) {
    return null;
  }

  const positionLoc = gl.getAttribLocation(program, "a_position");
  const texCoordLoc = gl.getAttribLocation(program, "a_texCoord");
  const textureLoc = gl.getUniformLocation(program, "u_texture");

  // Geometría del Quad de pantalla completa: Posición (x, y) y Coordenadas UV (u, v)
  const quadVertices = new Float32Array([
    // x,    y,   u,   v
    -1.0, -1.0, 0.0, 0.0, 1.0, -1.0, 1.0, 0.0, -1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0,
  ]);

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

  const FSIZE = Float32Array.BYTES_PER_ELEMENT;
  gl.enableVertexAttribArray(positionLoc);
  gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, FSIZE * 4, 0);

  gl.enableVertexAttribArray(texCoordLoc);
  gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, FSIZE * 4, FSIZE * 2);

  // Creación y configuración de la textura para VideoFrame
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let isDestroyed = false;

  const render = (frame: VideoFrame): void => {
    if (isDestroyed || !frame) return;

    try {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.useProgram(program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);

      // WebGL2 carga el VideoFrame decodificado directamente usando hardware texture sharing
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      gl.uniform1i(textureLoc, 0);

      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } catch (e) {
      console.error("[WebGL2Renderer] Error al renderizar fotograma en WebGL2:", e);
    }
  };

  const resize = (width: number, height: number): void => {
    if (isDestroyed) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };

  const destroy = (): void => {
    isDestroyed = true;
    try {
      gl.deleteTexture(texture);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    } catch (e) {
      console.warn("[WebGL2Renderer] Excepción al destruir recursos WebGL2:", e);
    }
  };

  console.log("[WebGL2Renderer] Renderizador WebGL2 (Hardware Accelerated) inicializado correctamente.");
  return { render, resize, destroy };
}
