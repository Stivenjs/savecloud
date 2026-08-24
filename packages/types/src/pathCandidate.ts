/**
 * Candidato de carpeta detectado por el escáner de rutas de guardado.
 */
export interface PathCandidate {
  readonly path: string;
  readonly folderName: string;
  readonly basePath: string;
  readonly steamAppId?: string | null;
  readonly paths?: string[] | null;
}
