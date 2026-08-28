import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export interface ClipUploadResult {
  clipId: string;
  watchUrl: string;
  cdnUrl: string;
}

export interface ClipItem {
  clipId: string;
  userId: string;
  gameId: string;
  filename: string;
  contentType: string;
  createdAt: string;
  cdnUrl: string;
  watchUrl: string;
  posterUrl?: string;
  steamAppId?: string;
  gameTitle?: string;
}

/**
 * Extrae de forma no bloqueante una captura JPEG (720p) del primer segundo del vídeo
 * utilizando la aceleración de hardware del navegador/webview.
 */
export async function extractVideoThumbnail(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement("video");
      video.crossOrigin = "anonymous";
      video.preload = "metadata";
      video.src = convertFileSrc(filePath);
      video.muted = true;
      video.playsInline = true;

      const timeout = setTimeout(() => {
        video.src = "";
        video.remove();
        resolve(null);
      }, 3000);

      video.onloadeddata = () => {
        video.currentTime = Math.min(1.0, video.duration > 0 ? video.duration / 4 : 0.5);
      };

      video.onseeked = () => {
        clearTimeout(timeout);
        try {
          const canvas = document.createElement("canvas");
          const targetWidth = 1280;
          const targetHeight = 720;
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
            resolve(dataUrl);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        } finally {
          video.src = "";
          video.remove();
        }
      };

      video.onerror = () => {
        clearTimeout(timeout);
        video.src = "";
        video.remove();
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

/**
 * Sube un archivo de vídeo local de un juego a la nube (S3/CDN)
 * y devuelve el enlace público para visualizarlo en el navegador.
 */
export async function uploadGameClip(
  gameId: string,
  filePath: string,
  thumbnailBase64?: string | null
): Promise<ClipUploadResult> {
  let thumb = thumbnailBase64;
  if (thumb === undefined) {
    thumb = await extractVideoThumbnail(filePath);
  }

  return invoke<ClipUploadResult>("upload_game_clip", {
    gameId,
    filePath,
    thumbnailBase64: thumb || null,
  });
}

/**
 * Lista los clips subidos para un juego específico o de la cuenta.
 */
export async function listGameClips(gameId?: string): Promise<ClipItem[]> {
  return invoke<ClipItem[]>("list_game_clips", {
    gameId: gameId || null,
  });
}

/**
 * Elimina un clip de la nube mediante su ID.
 */
export async function deleteGameClip(clipId: string): Promise<void> {
  return invoke<void>("delete_game_clip", {
    clipId,
  });
}
