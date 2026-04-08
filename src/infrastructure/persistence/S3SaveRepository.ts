import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import pLimit from "p-limit";
import type { GameSave } from "@domain/entities/GameSave";
import type {
  BackupMetadata,
  CompletedPart,
  CreateMultipartUploadResult,
  DownloadUrlItem,
  DownloadUrlResult,
  SaveRepository,
  UploadPartUrl,
  UploadUrlItem,
  UploadUrlResult,
} from "@domain/ports/SaveRepository";

export const PRESIGN_EXPIRES_IN_SECONDS = 3600;
const DOWNLOAD_BASE_URL = process.env.DOWNLOAD_BASE_URL;

/**
 * Máximo de presignados en paralelo hacia S3.
 *
 * Sin límite, 500 items disparan 500 peticiones simultáneas que pueden
 * provocar throttling (503 SlowDown) de S3 o agotar el pool de sockets
 * del SDK. 50 concurrentes es suficiente para saturar el ancho de banda
 * disponible sin presionar al servicio.
 */
const PRESIGN_CONCURRENCY = 50;

/**
 * Máximo de CopyObject en paralelo durante renameGame.
 *
 * CopyObject es más costoso que un presignado porque implica I/O interno
 * en S3. Se acota más bajo que PRESIGN_CONCURRENCY para evitar que un
 * rename de juego con cientos de archivos consuma todo el throughput de
 * la cuenta.
 */
const COPY_CONCURRENCY = 20;

/**
 * Tamaño máximo de un lote en DeleteObjects.
 *
 * Límite impuesto por la API de S3: un solo request DeleteObjects acepta
 * hasta 1000 keys. Por encima de este número hay que partir en varios
 * requests.
 */
const DELETE_BATCH_SIZE = 1000;

/**
 * Máximo de requests DeleteObjects en paralelo.
 * Se fija en 10 para no saturar la cuota de requests por segundo de S3
 * (3500 DELETE/s por prefijo), que con batches de 1000 equivale a
 * 10.000 borrados/s simultáneos —muy por debajo del límite real.
 */
const DELETE_BATCH_CONCURRENCY = 10;

/**
 * Implementación del puerto SaveRepository usando AWS S3.
 *
 * Pertenece a la capa de infraestructura; el dominio no la conoce.
 * Todas las operaciones batch (presignados, copias, eliminaciones) se
 * realizan con concurrencia acotada para evitar throttling de S3 y no
 * agotar el pool de conexiones del SDK.
 */
export class S3SaveRepository implements SaveRepository {
  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string
  ) {}

  /** Lista todos los usuarios en la nube (carpetas en el bucket) */
  async listAllUsers(): Promise<string[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Delimiter: "/",
    });

    const response = await this.s3.send(command);

    return (response.CommonPrefixes || []).map((p) => p.Prefix?.replace(/\/$/, "")).filter((p): p is string => !!p);
  }

  /** Descarga y devuelve el contenido de un archivo en texto plano desde S3 */
  async getFileContent(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
    const response = await this.s3.send(command);
    if (!response.Body) throw new Error("S3 did not return Body");
    return await response.Body.transformToString("utf-8");
  }

  /**
   * Construye URL de CloudFront solo para backups (prefijo /backups/).
   *
   * Los guardados "rápidos" siguen yendo directamente a S3 con URL
   * presignada para evitar costes extra por versión y problemas de caché
   * agresiva en CloudFront.
   *
   * @param key - Clave completa del objeto en S3.
   * @returns URL de CloudFront si aplica, o `null` si debe usarse S3.
   */
  private static buildCloudFrontUrl(key: string): string | null {
    if (!key.includes("/backups/")) return null;
    const base = DOWNLOAD_BASE_URL;
    if (!base) return null;
    const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const encodedKey = encodeURIComponent(key).replace(/%2F/g, "/");
    return `${normalizedBase}/${encodedKey}`;
  }

  /**
   * Extrae el path relativo de un archivo dado su clave S3 completa y el
   * prefijo del juego.
   *
   * La key en S3 tiene la forma `userId/gameId/rel/path/to/file.sav`.
   * El cliente Rust necesita el segmento `rel/path/to/file.sav` para
   * reconstruir la ruta local, incluyendo posibles subdirectorios.
   *
   * @param key    - Clave completa del objeto.
   * @param prefix - Prefijo `userId/gameId/` a eliminar.
   * @returns Path relativo dentro del directorio del juego.
   */
  private static relativeFilename(key: string, prefix: string): string {
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
  }

  /**
   * Divide un array en lotes del tamaño indicado.
   *
   * @param items    - Array a dividir.
   * @param batchSize - Tamaño máximo de cada lote.
   */
  private static chunk<T>(items: T[], batchSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      chunks.push(items.slice(i, i + batchSize));
    }
    return chunks;
  }

  /**
   * Ejecuta DeleteObjects en paralelo (acotado) sobre un array de keys.
   * @param keys - Array de strings con las keys a eliminar.
   */
  private async deleteKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    const batches = S3SaveRepository.chunk(
      keys.map((Key) => ({ Key })),
      DELETE_BATCH_SIZE
    );

    const limit = pLimit(DELETE_BATCH_CONCURRENCY);
    await Promise.all(
      batches.map((batch) =>
        limit(() =>
          this.s3.send(
            new DeleteObjectsCommand({
              Bucket: this.bucketName,
              Delete: { Objects: batch, Quiet: true },
            })
          )
        )
      )
    );
  }

  async getUploadUrl(userId: string, gameId: string, filename: string): Promise<string> {
    const key = `${userId}/${gameId}/${filename}`;
    const command = new PutObjectCommand({ Bucket: this.bucketName, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: PRESIGN_EXPIRES_IN_SECONDS });
  }

  async getDownloadUrl(
    _userId: string,
    _gameId: string,
    key: string,
    range?: { start: number; end: number }
  ): Promise<string> {
    // CloudFront solo se usa sin range; con range se necesita el header
    // Range en la petición presignada de S3.
    const cloudFrontUrl = range == null ? S3SaveRepository.buildCloudFrontUrl(key) : null;
    if (cloudFrontUrl) return cloudFrontUrl;

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ...(range != null && { Range: `bytes=${range.start}-${range.end}` }),
    });
    return getSignedUrl(this.s3, command, { expiresIn: PRESIGN_EXPIRES_IN_SECONDS });
  }

  /**
   * Genera URLs de subida presignadas para un lote de archivos.
   *
   * Las peticiones al SDK de S3 se ejecutan en paralelo con un límite de
   * {@link PRESIGN_CONCURRENCY} concurrentes para evitar throttling y no
   * saturar el pool de sockets.
   *
   * @param userId - Identificador del usuario propietario.
   * @param items  - Lista de pares gameId/filename a presignar.
   */
  async getUploadUrls(userId: string, items: UploadUrlItem[]): Promise<UploadUrlResult[]> {
    if (items.length === 0) return [];
    if (!this.bucketName?.trim()) {
      throw new Error("BUCKET_NAME is not configured in the server");
    }

    const limit = pLimit(PRESIGN_CONCURRENCY);
    const options = { expiresIn: PRESIGN_EXPIRES_IN_SECONDS };

    return Promise.all(
      items.map(({ gameId, filename }) =>
        limit(async () => {
          const key = `${userId}/${gameId}/${filename}`;
          const command = new PutObjectCommand({ Bucket: this.bucketName, Key: key });
          const uploadUrl = await getSignedUrl(this.s3, command, options);
          return { uploadUrl, key, gameId, filename };
        })
      )
    );
  }

  /**
   * Genera URLs de descarga presignadas (o de CloudFront) para un lote de
   * archivos.
   *
   * Las peticiones al SDK de S3 se ejecutan con concurrencia acotada igual
   * que en {@link getUploadUrls}.
   *
   * @param _userId - No se usa para construir la URL; la key ya es completa.
   * @param items   - Lista de pares gameId/key.
   */
  async getDownloadUrls(_userId: string, items: DownloadUrlItem[]): Promise<DownloadUrlResult[]> {
    if (items.length === 0) return [];

    const limit = pLimit(PRESIGN_CONCURRENCY);
    const options = { expiresIn: PRESIGN_EXPIRES_IN_SECONDS };

    return Promise.all(
      items.map(({ gameId, key }) =>
        limit(async () => {
          const cloudFrontUrl = S3SaveRepository.buildCloudFrontUrl(key);
          if (cloudFrontUrl) return { downloadUrl: cloudFrontUrl, gameId, key };

          const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
          const downloadUrl = await getSignedUrl(this.s3, command, options);
          return { downloadUrl, gameId, key };
        })
      )
    );
  }

  async createMultipartUpload(userId: string, gameId: string, filename: string): Promise<CreateMultipartUploadResult> {
    const key = `${userId}/${gameId}/${filename}`;
    const { UploadId } = await this.s3.send(new CreateMultipartUploadCommand({ Bucket: this.bucketName, Key: key }));
    if (!UploadId) throw new Error("S3 did not return UploadId");
    return { uploadId: UploadId, key };
  }

  async createMultipartUploadWithPartUrls(
    userId: string,
    gameId: string,
    filename: string,
    partCount: number
  ): Promise<CreateMultipartUploadResult & { partUrls: UploadPartUrl[] }> {
    const result = await this.createMultipartUpload(userId, gameId, filename);
    const partNumbers = Array.from({ length: partCount }, (_, i) => i + 1);
    const partUrls = await this.getUploadPartUrls(result.key, result.uploadId, partNumbers);
    return { ...result, partUrls };
  }

  async getUploadPartUrls(key: string, uploadId: string, partNumbers: number[]): Promise<UploadPartUrl[]> {
    const limit = pLimit(PRESIGN_CONCURRENCY);
    const options = { expiresIn: PRESIGN_EXPIRES_IN_SECONDS };

    return Promise.all(
      partNumbers.map((partNumber) =>
        limit(async () => {
          const command = new UploadPartCommand({
            Bucket: this.bucketName,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          });
          const url = await getSignedUrl(this.s3, command, options);
          return { partNumber, url };
        })
      )
    );
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: CompletedPart[]): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucketName,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .slice()
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      })
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucketName, Key: key, UploadId: uploadId }));
  }

  /**
   * Lista todos los archivos de guardado de un usuario.
   *
   * Pagina automáticamente sobre ListObjectsV2 hasta agotar los resultados.
   * El campo `filename` de cada {@link GameSave} contiene el path relativo
   * al directorio del juego (todo lo que hay después de `userId/gameId/`),
   * preservando subdirectorios para que el cliente Rust pueda reconstruir
   * la ruta local correctamente.
   * @param userId - Identificador del usuario.
   */
  async listByUser(userId: string): Promise<GameSave[]> {
    const prefix = `${userId}/`;
    const result: GameSave[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of response.Contents ?? []) {
        if (!obj.Key) continue;
        const withoutUser = obj.Key.slice(prefix.length);
        const slashIdx = withoutUser.indexOf("/");
        const gameId = slashIdx >= 0 ? withoutUser.slice(0, slashIdx) : withoutUser;
        const gamePrefix = `${prefix}${gameId}/`;

        result.push({
          gameId,
          key: obj.Key,
          filename: S3SaveRepository.relativeFilename(obj.Key, gamePrefix),
          lastModified: obj.LastModified ?? new Date(0),
          size: obj.Size,
        });
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return result;
  }

  /**
   * Lista los archivos de guardado de un usuario para un juego concreto.
   *
   * Utiliza un prefijo más específico (`userId/gameId/`) para evitar tener
   * que recorrer todos los objetos del usuario cuando solo interesa un juego.
   *
   * igual que en {@link listByUser}, se mapea directamente en
   * el loop de paginado sin acumular en un array intermedio.
   *
   * @param userId - Identificador del usuario.
   * @param gameId - Identificador del juego.
   */
  async listByUserAndGame(userId: string, gameId: string): Promise<GameSave[]> {
    const prefix = `${userId}/${gameId}/`;
    const result: GameSave[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of response.Contents ?? []) {
        if (!obj.Key) continue;
        result.push({
          gameId,
          key: obj.Key,
          filename: S3SaveRepository.relativeFilename(obj.Key, prefix),
          lastModified: obj.LastModified ?? new Date(0),
          size: obj.Size,
        });
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return result;
  }

  /**
   * Lista los backups empaquetados de un juego concreto.
   *
   * Pagina sobre ListObjectsV2 igual que {@link listByUser}. El campo
   * `filename` contiene solo el nombre del archivo de backup (sin el
   * prefijo de carpeta), que es lo que el cliente usa para mostrarlo.
   *
   * igual que en {@link listByUser}, se elimina el array
   * intermedio `allContents` y se mapea directamente página a página.
   *
   * @param userId - Identificador del usuario.
   * @param gameId - Identificador del juego.
   */
  async listBackups(userId: string, gameId: string): Promise<BackupMetadata[]> {
    const prefix = `${userId}/${gameId}/backups/`;
    const result: BackupMetadata[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      for (const obj of response.Contents ?? []) {
        if (!obj.Key) continue;
        result.push({
          key: obj.Key,
          lastModified: obj.LastModified ?? new Date(0),
          size: obj.Size,
          filename: obj.Key.slice(prefix.length) || obj.Key,
        });
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return result;
  }

  private static backupKeyPrefix(userId: string, gameId: string): string {
    return `${userId}/${gameId}/backups/`;
  }

  private static assertValidBackupKey(userId: string, gameId: string, key: string): void {
    const prefix = S3SaveRepository.backupKeyPrefix(userId, gameId);
    if (!key.startsWith(prefix) || key.includes("..")) {
      throw new Error("Invalid key: must be a backup of this user and game");
    }
  }

  private static assertValidDeletableKey(userId: string, gameId: string, key: string): void {
    const base = `${userId}/${gameId}/`;
    const allowed = ["backups/", "__torrent__/"];
    if (!allowed.some((p) => key.startsWith(`${base}${p}`)) || key.includes("..")) {
      throw new Error("Invalid key: must be a backup or torrent of this user and game");
    }
  }

  async deleteBackup(userId: string, gameId: string, key: string): Promise<void> {
    S3SaveRepository.assertValidDeletableKey(userId, gameId, key);
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
  }

  async renameBackup(userId: string, gameId: string, oldKey: string, newFilename: string): Promise<void> {
    S3SaveRepository.assertValidBackupKey(userId, gameId, oldKey);
    const prefix = S3SaveRepository.backupKeyPrefix(userId, gameId);
    if (!newFilename || newFilename.includes("/") || newFilename.includes("..") || !newFilename.endsWith(".tar")) {
      throw new Error("newFilename must be a .tar filename without path (e.g. mi-backup.tar)");
    }
    const newKey = `${prefix}${newFilename}`;
    if (newKey === oldKey) return;

    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.bucketName,
        CopySource: `${this.bucketName}/${encodeURIComponent(oldKey)}`,
        Key: newKey,
      })
    );
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: oldKey }));
  }

  /**
   * Elimina todos los objetos de un juego del bucket.
   * @param userId - Identificador del usuario.
   * @param gameId - Identificador del juego a eliminar.
   */
  async deleteGame(userId: string, gameId: string): Promise<void> {
    const prefix = `${userId}/${gameId}/`;
    const deleteLimit = pLimit(DELETE_BATCH_CONCURRENCY);

    const deletePromises: Promise<unknown>[] = [];

    let continuationToken: string | undefined;

    do {
      const list = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      const keys = (list.Contents ?? []).filter((c): c is { Key: string } => !!c.Key).map((c) => ({ Key: c.Key }));

      if (keys.length > 0) {
        for (const batch of S3SaveRepository.chunk(keys, DELETE_BATCH_SIZE)) {
          deletePromises.push(
            deleteLimit(() =>
              this.s3.send(
                new DeleteObjectsCommand({
                  Bucket: this.bucketName,
                  Delete: { Objects: batch, Quiet: true },
                })
              )
            )
          );
        }
      }

      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);

    await Promise.all(deletePromises);
  }

  /**
   * Renombra (mueve) todos los objetos de un juego a un nuevo gameId.
   *
   * S3 no tiene operación de rename nativa; la operación equivalente es
   * copiar cada objeto a la nueva key y luego eliminar el original.
   *
   * @param userId    - Identificador del usuario.
   * @param oldGameId - Identificador actual del juego.
   * @param newGameId - Nuevo identificador del juego.
   */
  async renameGame(userId: string, oldGameId: string, newGameId: string): Promise<void> {
    if (oldGameId === newGameId) return;

    const prefix = `${userId}/${oldGameId}/`;
    const allKeys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const list = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const obj of list.Contents ?? []) {
        if (obj.Key) allKeys.push(obj.Key);
      }
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);

    if (allKeys.length === 0) return;

    const copyLimit = pLimit(COPY_CONCURRENCY);
    await Promise.all(
      allKeys.map((oldKey) =>
        copyLimit(() => {
          const filename = oldKey.slice(prefix.length);
          const newKey = `${userId}/${newGameId}/${filename}`;
          return this.s3.send(
            new CopyObjectCommand({
              Bucket: this.bucketName,
              CopySource: `${this.bucketName}/${encodeURIComponent(oldKey)}`,
              Key: newKey,
            })
          );
        })
      )
    );

    await this.deleteKeys(allKeys);
  }
}
