import dagre from "dagre";
import { MarkerType, type Edge, type Node } from "reactflow";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";
import { formatGameDisplayName } from "@utils/gameImage";
import type { Config } from "@app-types/config";
import type { CloudBackupInfo, CloudSavesSummary, GameStats, OperationLogEntry } from "@services/tauri";
import type { GameSaveGraph, SaveGraphEdge, SaveGraphModel, SaveGraphNode, SaveGraphTone } from "@app-types/saveGraph";

/**
 * Datos consumidos por el nodo custom de React Flow.
 */
export interface SaveGraphFlowNodeData extends SaveGraphNode {
  kindLabel: string;
  toneClassName: string;
}

interface BuildLibrarySaveGraphModelArgs {
  config: Config | null;
  stats: GameStats[];
  history: OperationLogEntry[];
  remoteSummary: CloudSavesSummary[];
  fullBackupsByGame: Record<string, CloudBackupInfo[]>;
}

const NODE_WIDTH = 248;
const NODE_HEIGHT = 132;
const WINDOW_DAY_MS = 24 * 60 * 60 * 1000;

const TONE_CLASSES: Record<SaveGraphTone, string> = {
  emerald: "border-success/35 bg-success/15 text-foreground",
  indigo: "border-secondary/35 bg-secondary/15 text-foreground",
  amber: "border-warning/35 bg-warning/15 text-foreground",
  slate: "border-default-300/70 bg-default-100/70 text-foreground",
  rose: "border-danger/35 bg-danger/15 text-foreground",
};

function formatMetric(value: string | null): string | null {
  if (!value) return value;
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp).toLocaleString();
  }
  return value;
}

function toneForNode(kind: SaveGraphNode["kind"], hasError = false): SaveGraphTone {
  if (hasError) return "rose";
  switch (kind) {
    case "biblioteca":
      return "indigo";
    case "juego":
      return "emerald";
    case "actividad":
      return "slate";
    case "respaldo":
      return "amber";
    case "resumen":
      return "indigo";
    default:
      return "slate";
  }
}

function kindLabel(kind: SaveGraphNode["kind"]): string {
  switch (kind) {
    case "biblioteca":
      return "Biblioteca";
    case "juego":
      return "Juego";
    case "actividad":
      return "Actividad";
    case "respaldo":
      return "Respaldo";
    case "resumen":
      return "Resumen";
    default:
      return "Nodo";
  }
}

function operationLabel(kind: OperationLogEntry["kind"]): string {
  switch (kind) {
    case "upload":
      return "Subida";
    case "download":
      return "Descarga";
    case "copy_friend":
      return "Copia de amigo";
    default:
      return "Actividad";
  }
}

function pickLatestTimestamp(entries: Array<string | null | undefined>): string | null {
  const timestamps = entries.filter((entry): entry is string => Boolean(entry));
  if (!timestamps.length) return null;
  return timestamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function formatBackupSize(size: number | undefined): string {
  if (typeof size !== "number") return "Tamaño desconocido";
  return formatBytes(size);
}

function makeNode(partial: Omit<SaveGraphNode, "tone"> & { tone?: SaveGraphTone }): SaveGraphNode {
  return {
    ...partial,
    tone: partial.tone ?? toneForNode(partial.kind, partial.status?.toLowerCase().includes("error") ?? false),
  };
}

function makeEdge(source: string, target: string, relation: string, animated = false): SaveGraphEdge {
  return {
    id: `${source}->${target}:${relation}`,
    source,
    target,
    relation,
    animated,
  };
}

/**
 * Construye un grafo por juego a partir de la respuesta del comando Rust.
 */
export function mapGameSaveGraphToModel(graph: GameSaveGraph): SaveGraphModel {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      title: node.kind === "juego" && node.gameId ? formatGameDisplayName(node.gameId) : node.title,
      gameId: node.gameId ? formatGameDisplayName(node.gameId) : null,
      metric: formatMetric(node.metric),
    })),
    edges: graph.edges,
  };
}

/**
 * Construye el grafo general de la biblioteca a partir de las fuentes disponibles.
 */
export function buildLibrarySaveGraphModel({
  config,
  stats,
  history,
  remoteSummary,
  fullBackupsByGame,
}: BuildLibrarySaveGraphModelArgs): SaveGraphModel {
  const games = config?.games ?? [];
  const statsByGameId = new Map(stats.map((item) => [item.gameId.toLowerCase(), item]));
  const remoteByGameId = new Map(remoteSummary.map((item) => [item.gameId.toLowerCase(), item]));
  const historyByGameId = new Map<string, OperationLogEntry[]>();

  for (const entry of history) {
    const key = entry.gameId.toLowerCase();
    const list = historyByGameId.get(key) ?? [];
    list.push(entry);
    historyByGameId.set(key, list);
  }

  const nodes: SaveGraphNode[] = [
    makeNode({
      id: "biblioteca",
      kind: "biblioteca",
      title: "Mapa general de guardados",
      subtitle: `${games.length} juegos configurados`,
      metric: `${history.length} eventos recientes`,
      status: "Vista panorámica",
      timestamp: null,
      gameId: null,
    }),
  ];

  const edges: SaveGraphEdge[] = [];

  games.forEach((game, index) => {
    const gameId = game.id;
    const normalizedGameId = gameId.toLowerCase();
    const gameStats = statsByGameId.get(normalizedGameId);
    const gameHistory = historyByGameId.get(normalizedGameId) ?? [];
    const latestHistory = gameHistory.length
      ? [...gameHistory].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0]
      : null;
    const remote = remoteByGameId.get(normalizedGameId);
    const backups = fullBackupsByGame[gameId] ?? fullBackupsByGame[normalizedGameId] ?? [];

    const gameTimestamp = pickLatestTimestamp([
      gameStats?.cloudLastModified ?? null,
      gameStats?.localLastModified ?? null,
      latestHistory?.timestamp ?? null,
      remote?.lastModified ?? null,
      ...backups.map((item) => item.lastModified),
    ]);

    nodes.push(
      makeNode({
        id: `juego:${gameId}`,
        kind: "juego",
        title: formatGameDisplayName(gameId),
        subtitle: game.editionLabel ?? "Juego configurado",
        metric: gameStats ? formatPlaytime(gameStats.playtimeSeconds) : "Sin tiempo acumulado",
        status: latestHistory?.kind
          ? `${operationLabel(latestHistory.kind)} reciente`
          : remote
            ? "Con nube activa"
            : "Sin actividad",
        timestamp: gameTimestamp,
        gameId,
      })
    );
    edges.push(makeEdge("biblioteca", `juego:${gameId}`, "agrupa", index % 2 === 0));

    if (latestHistory) {
      const activityNodeId = `actividad:${gameId}`;
      nodes.push(
        makeNode({
          id: activityNodeId,
          kind: "actividad",
          title: `Última ${operationLabel(latestHistory.kind).toLowerCase()}`,
          subtitle: `${latestHistory.fileCount} archivos · ${latestHistory.errCount > 0 ? "Con errores" : "Correcto"}`,
          metric: formatRelativeDate(latestHistory.timestamp),
          status: latestHistory.errCount > 0 ? "Revisar" : "Bien",
          timestamp: latestHistory.timestamp,
          gameId,
        })
      );
      edges.push(makeEdge(`juego:${gameId}`, activityNodeId, "actividad", true));
    }

    if (remote) {
      const remoteNodeId = `resumen:${gameId}:nube`;
      nodes.push(
        makeNode({
          id: remoteNodeId,
          kind: "resumen",
          title: "Guardados en la nube",
          subtitle: `${remote.fileCount} archivos`,
          metric: formatBackupSize(remote.totalSizeBytes),
          status: remote.fileCount > 0 ? "Sincronizado" : "Sin archivos",
          timestamp: remote.lastModified,
          gameId,
        })
      );
      edges.push(makeEdge(`juego:${gameId}`, remoteNodeId, "nube", false));
    }

    if (backups.length > 0) {
      const backupNodeId = `respaldo:${gameId}:completos`;
      const latestBackup = [...backups].sort((a, b) => Date.parse(b.lastModified) - Date.parse(a.lastModified))[0];
      nodes.push(
        makeNode({
          id: backupNodeId,
          kind: "respaldo",
          title: "Backups completos",
          subtitle: `${backups.length} copias archivadas`,
          metric: latestBackup ? formatRelativeDate(latestBackup.lastModified) : "Sin fecha",
          status: latestBackup ? formatBackupSize(latestBackup.size) : "Sin backups",
          timestamp: latestBackup?.lastModified ?? null,
          gameId,
        })
      );
      edges.push(makeEdge(`juego:${gameId}`, backupNodeId, "respaldo", false));
    }
  });

  return {
    scope: "biblioteca",
    title: "Mapa general de guardados",
    subtitle: `${games.length} juegos · vista comparativa`,
    generatedAt: new Date().toISOString(),
    nodes,
    edges,
  };
}

/**
 * Reduce el grafo a una ventana temporal sin romper el nodo principal.
 */
export function filterSaveGraphModelByWindowDays(model: SaveGraphModel, windowDays: number): SaveGraphModel {
  if (!windowDays || windowDays <= 0) {
    return model;
  }

  const cutoff = Date.now() - windowDays * WINDOW_DAY_MS;
  const allowedNodes = new Set<string>();

  for (const node of model.nodes) {
    if (node.kind === "biblioteca" || node.kind === "juego") {
      allowedNodes.add(node.id);
      continue;
    }

    if (!node.timestamp) {
      allowedNodes.add(node.id);
      continue;
    }

    if (Date.parse(node.timestamp) >= cutoff) {
      allowedNodes.add(node.id);
    }
  }

  const nodes = model.nodes.filter((node) => allowedNodes.has(node.id));
  const edges = model.edges.filter((edge) => allowedNodes.has(edge.source) && allowedNodes.has(edge.target));

  return {
    ...model,
    nodes,
    edges,
  };
}

function layoutGraph(nodes: Node<SaveGraphFlowNodeData>[], edges: Edge[]): Node<SaveGraphFlowNodeData>[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: "TB",
    ranksep: 128,
    nodesep: 54,
    edgesep: 36,
    marginx: 40,
    marginy: 56,
  });

  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  });

  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  return nodes.map((node) => {
    const position = graph.node(node.id) as { x: number; y: number };
    return {
      ...node,
      position: {
        x: position.x - NODE_WIDTH / 2,
        y: position.y - NODE_HEIGHT / 2,
      },
    };
  });
}

/**
 * Convierte el modelo del grafo a nodos y aristas de React Flow.
 */
export function toReactFlowGraph(model: SaveGraphModel): {
  nodes: Node<SaveGraphFlowNodeData>[];
  edges: Edge[];
} {
  const nodes: Node<SaveGraphFlowNodeData>[] = model.nodes.map((node) => ({
    id: node.id,
    type: "saveGraphNode",
    data: {
      ...node,
      kindLabel: kindLabel(node.kind),
      toneClassName: TONE_CLASSES[node.tone],
    },
    position: { x: 0, y: 0 },
    selectable: true,
    draggable: false,
    style: {
      width: NODE_WIDTH,
    },
  }));

  const edges: Edge[] = model.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    animated: edge.animated ?? edge.relation === "actividad",
    label: edge.relation,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: "rgba(148, 163, 184, 0.55)",
    },
    style: {
      strokeWidth: 1.8,
      strokeLinecap: "round",
      opacity: 0.78,
    },
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 999,
    labelBgStyle: {
      fill: "rgba(15, 23, 42, 0.82)",
      color: "#e2e8f0",
    },
    labelStyle: {
      fill: "#cbd5e1",
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
    },
  }));

  return {
    nodes: layoutGraph(nodes, edges),
    edges,
  };
}
