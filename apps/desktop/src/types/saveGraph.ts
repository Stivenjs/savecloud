/**
 * Tipos compartidos para los grafos de guardados.
 */

export type SaveGraphScope = "juego" | "biblioteca";
export type SaveGraphNodeKind = "biblioteca" | "juego" | "actividad" | "respaldo" | "resumen";
export type SaveGraphTone = "emerald" | "indigo" | "amber" | "slate" | "rose";

/**
 * Nodo visual del grafo.
 * El backend y los adaptadores de frontend comparten esta forma para simplificar el render.
 */
export interface SaveGraphNode {
  id: string;
  kind: SaveGraphNodeKind;
  title: string;
  subtitle: string | null;
  metric: string | null;
  status: string | null;
  tone: SaveGraphTone;
  timestamp: string | null;
  gameId: string | null;
}

/**
 * Relación visual entre dos nodos del grafo.
 */
export interface SaveGraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  animated?: boolean;
}

/**
 * Datos comunes de cualquier grafo de guardados.
 */
export interface SaveGraphModel {
  scope: SaveGraphScope;
  title: string;
  subtitle: string;
  generatedAt: string;
  nodes: SaveGraphNode[];
  edges: SaveGraphEdge[];
}

/**
 * Respuesta del comando Tauri del grafo por juego.
 */
export interface GameSaveGraph extends SaveGraphModel {
  scope: "juego";
  gameId: string;
}

/**
 * Estado de filtro temporal del grafo.
 */
export interface SaveGraphFiltersState {
  windowDays: number;
}
