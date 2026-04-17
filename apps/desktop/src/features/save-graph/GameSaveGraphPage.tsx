import { useEffect, useMemo } from "react";
import { Button, Card, CardBody, Spinner } from "@heroui/react";
import { ArrowLeft, Network } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useSaveGraphStore } from "@store/SaveGraphStore";
import { filterSaveGraphModelByWindowDays, mapGameSaveGraphToModel, toReactFlowGraph } from "@utils/saveGraph.mapper";
import { useGameSaveGraphData } from "@hooks/useGameSaveGraphData";
import { SaveGraphCanvas } from "@components/save-graph/SaveGraphCanvas";
import { SaveGraphFilters } from "@components/save-graph/SaveGraphFilters";
import { SaveGraphLegend } from "@components/save-graph/SaveGraphLegend";
import { SaveGraphDetailPanel } from "@components/save-graph/SaveGraphDetailPanel";
import { formatGameDisplayName } from "@utils/gameImage";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";

/**
 * Vista detallada del grafo de guardados de un juego.
 */
export function GameSaveGraphPage() {
  const navigate = useNavigate();
  const { gameId } = useParams<{ gameId: string }>();
  const selectedNodeId = useSaveGraphStore((state) => state.selectedNodeId);
  const windowDays = useSaveGraphStore((state) => state.filters.windowDays);
  const setSelectedNodeId = useSaveGraphStore((state) => state.setSelectedNodeId);
  const { data, isPending, isError, error } = useGameSaveGraphData(gameId ?? "");

  useEffect(() => {
    setSelectedNodeId(null);
  }, [gameId, setSelectedNodeId]);

  useRegisterGlobalBack(() => {
    navigate(`/games/${gameId ?? ""}`);
    return true;
  });

  const model = useMemo(() => {
    if (!data) return null;
    return filterSaveGraphModelByWindowDays(mapGameSaveGraphToModel(data), windowDays);
  }, [data, windowDays]);

  const flow = useMemo(() => (model ? toReactFlowGraph(model) : { nodes: [], edges: [] }), [model]);
  const selectedNode = useMemo(
    () => model?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [model, selectedNodeId]
  );
  const title = formatGameDisplayName(gameId ?? "");

  const summaryCards = [
    { label: "Juego", value: title, hint: "Mapa detallado" },
    {
      label: "Eventos",
      value: `${data?.nodes.filter((node) => node.kind === "actividad").length ?? 0}`,
      hint: "Subidas, descargas y copias",
    },
    {
      label: "Backups",
      value: `${data?.nodes.filter((node) => node.kind === "respaldo").length ?? 0}`,
      hint: "Copias completas enlazadas",
    },
    {
      label: "Ventana",
      value: `${windowDays} días`,
      hint: model?.generatedAt ? `Actualizado ${new Date(model.generatedAt).toLocaleDateString()}` : "Sin datos",
    },
  ];

  if (!gameId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Card>
          <CardBody className="py-8 text-danger">No se encontró el juego para generar el mapa.</CardBody>
        </Card>
      </div>
    );
  }

  return (
    <main className="text-foreground">
      <div className="mx-auto flex w-full flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <header>
          <section className="space-y-4 rounded-3xl border border-divider bg-content1 p-5">
            <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-default-500">
              <span className="rounded-full border border-divider bg-default-100 px-3 py-1">Mapa por juego</span>
            </div>
            <div className="max-w-3xl space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{title}</h1>
              <p className="max-w-2xl text-sm text-default-600 md:text-base">
                Guardados, actividad y respaldos de este juego en una vista unificada para revisar estado y cronología.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                radius="full"
                startContent={<ArrowLeft size={16} />}
                variant="flat"
                onPress={() => navigate(`/games/${gameId}`)}>
                Volver al juego
              </Button>
              <Button
                radius="full"
                color="primary"
                startContent={<Network size={16} />}
                onPress={() => navigate("/graph")}>
                Ver mapa general
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {summaryCards.map((card) => (
                <div key={card.label} className="rounded-2xl border border-divider bg-content2 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-default-500">{card.label}</p>
                  <p className="truncate text-base font-semibold text-foreground">{card.value}</p>
                  <p className="truncate text-xs text-default-500">{card.hint}</p>
                </div>
              ))}
            </div>
          </section>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.7fr)]">
          <section className="space-y-4">
            <SaveGraphFilters onResetSelection={() => setSelectedNodeId(null)} />
            <SaveGraphLegend />
            <Card className="border border-divider bg-content1">
              <CardBody className="p-3">
                {isPending ? (
                  <div className="flex min-h-[52vh] flex-col items-center justify-center gap-3">
                    <Spinner size="lg" color="primary" />
                    <p className="text-default-500">Construyendo el mapa del juego...</p>
                  </div>
                ) : null}

                {isError ? (
                  <div className="flex min-h-[52vh] items-center justify-center rounded-3xl border border-danger/20 bg-danger/10 p-6 text-danger">
                    No se pudo cargar el mapa: {error instanceof Error ? error.message : "Error desconocido"}
                  </div>
                ) : null}

                {!isPending && !isError ? (
                  <SaveGraphCanvas nodes={flow.nodes} edges={flow.edges} onNodeSelect={setSelectedNodeId} />
                ) : null}
              </CardBody>
            </Card>
          </section>

          <aside className="space-y-4">
            <SaveGraphDetailPanel
              node={selectedNode}
              emptyLabel="Selecciona un nodo para ver métricas, estado y relación con el resto del mapa."
            />
          </aside>
        </div>
      </div>
    </main>
  );
}
