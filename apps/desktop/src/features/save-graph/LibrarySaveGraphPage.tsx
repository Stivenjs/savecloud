import { useEffect, useMemo } from "react";
import { Button, Card, CardBody, Spinner } from "@heroui/react";
import { ArrowLeft, Network } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSaveGraphStore } from "@store/SaveGraphStore";
import { filterSaveGraphModelByWindowDays, toReactFlowGraph } from "@utils/saveGraph.mapper";
import { useLibrarySaveGraphData } from "@hooks/useLibrarySaveGraphData";
import { SaveGraphCanvas } from "@components/save-graph/SaveGraphCanvas";
import { SaveGraphFilters } from "@components/save-graph/SaveGraphFilters";
import { SaveGraphLegend } from "@components/save-graph/SaveGraphLegend";
import { SaveGraphDetailPanel } from "@components/save-graph/SaveGraphDetailPanel";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";

/**
 * Vista general de toda la biblioteca como grafo de guardados.
 */
export function LibrarySaveGraphPage() {
  const navigate = useNavigate();
  const selectedNodeId = useSaveGraphStore((state) => state.selectedNodeId);
  const windowDays = useSaveGraphStore((state) => state.filters.windowDays);
  const setSelectedNodeId = useSaveGraphStore((state) => state.setSelectedNodeId);
  const { configQuery, statsQuery, historyQuery, remoteSummaryQuery, fullBackupsQuery, model } =
    useLibrarySaveGraphData();

  useEffect(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  useRegisterGlobalBack(() => {
    navigate("/");
    return true;
  });

  const filteredModel = useMemo(() => filterSaveGraphModelByWindowDays(model, windowDays), [model, windowDays]);
  const flow = useMemo(() => toReactFlowGraph(filteredModel), [filteredModel]);
  const selectedNode = useMemo(
    () => filteredModel.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [filteredModel, selectedNodeId]
  );

  const summaryCards = [
    {
      label: "Juegos",
      value: `${configQuery.data?.games.length ?? 0}`,
      hint: "Catálogo visible en biblioteca",
    },
    {
      label: "Eventos",
      value: `${historyQuery.data?.length ?? 0}`,
      hint: "Subidas, descargas y copias",
    },
    {
      label: "Guardados en nube",
      value: `${remoteSummaryQuery.data?.length ?? 0}`,
      hint: "Resumen agregado por juego",
    },
    {
      label: "Ventana",
      value: `${windowDays} días`,
      hint: model.generatedAt ? `Actualizado ${new Date(model.generatedAt).toLocaleDateString()}` : "Sin datos",
    },
  ];

  return (
    <main className="text-foreground">
      <div className="flex w-full max-w-[100rem] flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <header>
          <section className="space-y-4 rounded-3xl border border-divider bg-content1 p-5">
            <div className="flex flex-wrap items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-default-500">
              <span className="rounded-full border border-divider bg-default-100 px-3 py-1">Mapa global</span>
            </div>
            <div className="max-w-3xl space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                Mapa general de guardados
              </h1>
              <p className="max-w-2xl text-sm text-default-600 md:text-base">
                Vista comparativa de toda tu biblioteca para detectar actividad reciente, estado de nube y respaldos.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button radius="full" startContent={<ArrowLeft size={16} />} variant="flat" onPress={() => navigate("/")}>
                Volver a juegos
              </Button>
              <Button
                radius="full"
                color="primary"
                startContent={<Network size={16} />}
                onPress={() => navigate("/games/" + (configQuery.data?.games[0]?.id ?? ""))}
                isDisabled={!configQuery.data?.games.length}>
                Abrir un juego
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
                {configQuery.isPending ||
                statsQuery.isPending ||
                historyQuery.isPending ||
                remoteSummaryQuery.isPending ||
                fullBackupsQuery.isPending ? (
                  <div className="flex min-h-[52vh] flex-col items-center justify-center gap-3">
                    <Spinner size="lg" color="primary" />
                    <p className="text-default-500">Construyendo el mapa general...</p>
                  </div>
                ) : null}

                {configQuery.isError ||
                statsQuery.isError ||
                historyQuery.isError ||
                remoteSummaryQuery.isError ||
                fullBackupsQuery.isError ? (
                  <div className="flex min-h-[52vh] items-center justify-center rounded-3xl border border-danger/20 bg-danger/10 p-6 text-danger">
                    No se pudo cargar el mapa general. Revisa la conexión o vuelve a intentar.
                  </div>
                ) : null}

                {!configQuery.isPending &&
                !statsQuery.isPending &&
                !historyQuery.isPending &&
                !remoteSummaryQuery.isPending &&
                !fullBackupsQuery.isPending ? (
                  <SaveGraphCanvas nodes={flow.nodes} edges={flow.edges} onNodeSelect={setSelectedNodeId} />
                ) : null}
              </CardBody>
            </Card>
          </section>

          <aside className="space-y-4">
            <SaveGraphDetailPanel
              node={selectedNode}
              emptyLabel="Selecciona un juego o un nodo de actividad para revisar su estado, últimos eventos y backups."
            />
          </aside>
        </div>
      </div>
    </main>
  );
}
