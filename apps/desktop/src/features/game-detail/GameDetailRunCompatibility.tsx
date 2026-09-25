import { Card, CardBody, Chip, Skeleton } from "@heroui/react";
import { AlertCircle, CheckCircle2, HelpCircle, Monitor, XCircle } from "lucide-react";
import type { CompatibilityLevel, RunCompatibilityReport } from "@app-types/runCompatibility";

function overallLabel(level: CompatibilityLevel): string {
  switch (level) {
    case "likely":
      return "Probablemente compatible";
    case "uncertain":
      return "No concluyente";
    case "unlikely":
      return "Puede no cumplir el mínimo";
    default:
      return "Sin evaluar";
  }
}

function overallColor(level: CompatibilityLevel): "success" | "warning" | "danger" | "default" {
  switch (level) {
    case "likely":
      return "success";
    case "uncertain":
      return "warning";
    case "unlikely":
      return "danger";
    default:
      return "default";
  }
}

function OverallIcon({ level }: { level: CompatibilityLevel }) {
  switch (level) {
    case "likely":
      return <CheckCircle2 size={18} className="text-success" />;
    case "uncertain":
      return <HelpCircle size={18} className="text-warning" />;
    case "unlikely":
      return <XCircle size={18} className="text-danger" />;
    default:
      return <AlertCircle size={18} className="text-default-400" />;
  }
}

function formatRamMb(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) {
    return `${mb / 1024} GB`;
  }
  return `${mb} MB`;
}

export function GameDetailRunCompatibility(props: {
  report: RunCompatibilityReport | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const { report, isLoading, isError } = props;

  if (isLoading) {
    return (
      <Card className="border border-default-200/60 dark:border-default-100/20">
        <CardBody className="space-y-3 px-4 py-4">
          <Skeleton className="h-6 w-52 rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </CardBody>
      </Card>
    );
  }

  if (isError || !report) {
    return (
      <Card className="border border-warning/30 bg-warning/5 dark:border-warning/20">
        <CardBody className="flex flex-row items-start gap-3 px-4 py-3">
          <AlertCircle className="mt-0.5 shrink-0 text-warning" size={20} />
          <div>
            <p className="text-sm font-medium text-foreground">No se pudo evaluar tu equipo</p>
            <p className="mt-1 text-xs leading-relaxed text-default-600 dark:text-default-400">
              Vuelve a intentar más tarde. La comparación depende de leer tu hardware y el texto de requisitos de la
              tienda.
            </p>
          </div>
        </CardBody>
      </Card>
    );
  }

  const minRamParsed = report.minimum.ramMb != null;

  return (
    <Card className="border border-default-200/60 shadow-sm dark:border-default-100/20">
      <CardBody className="space-y-4 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Monitor size={18} className="text-default-500" />
            <span className="text-sm font-semibold text-foreground">Tu PC frente a la ficha</span>
          </div>
          <Chip
            size="sm"
            variant="flat"
            color={overallColor(report.overall)}
            startContent={<OverallIcon level={report.overall} />}>
            {overallLabel(report.overall)}
          </Chip>
        </div>

        <p className="text-xs leading-relaxed text-default-500">
          Estimación automática a partir del texto de Steam; no sustituye a pruebas reales en tu máquina.
        </p>

        <div className="rounded-lg border border-default-200/50 bg-default-50/50 px-3 py-2.5 text-xs dark:border-default-100/15 dark:bg-default-50/10">
          <p className="mb-1.5 font-medium text-default-700 dark:text-default-300">Este equipo</p>
          <ul className="space-y-1 text-default-600 dark:text-default-400">
            <li>
              <span className="text-default-500">RAM: </span>
              {formatRamMb(report.host.totalMemoryMb)}
            </li>
            <li>
              <span className="text-default-500">CPU: </span>
              {report.host.cpuBrand || "—"} ({report.host.cpuLogicalCores} hilos)
            </li>
            <li>
              <span className="text-default-500">GPU: </span>
              {report.host.gpuName ?? "No detectada o no disponible en este sistema."}
            </li>
            <li>
              <span className="text-default-500">Sistema: </span>
              {report.host.osLabel}
            </li>
          </ul>
        </div>

        {!minRamParsed && (
          <div className="flex gap-2 rounded-lg border border-default-200/60 bg-content1/60 px-3 py-2 dark:border-default-100/20">
            <HelpCircle size={16} className="mt-0.5 shrink-0 text-default-400" />
            <p className="text-xs leading-relaxed text-default-600 dark:text-default-400">
              No pudimos extraer la RAM mínima del texto de la tienda (formato poco habitual). Revisa los requisitos en
              las tarjetas de abajo y compáralos con tu equipo manualmente.
            </p>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-default-400">
          La GPU se compara por coincidencia con el texto de la tienda (no por rendimiento). DirectX y espacio libre por
          disco no se validan automáticamente; revisa la lista y las tablas de abajo.
        </p>

        <ul className="space-y-2">
          {report.factors.map((f) => (
            <li key={f.id} className="flex gap-2 text-xs leading-relaxed text-default-600 dark:text-default-400">
              {f.status === "pass" ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
              ) : f.status === "fail" ? (
                <XCircle size={14} className="mt-0.5 shrink-0 text-danger" />
              ) : (
                <HelpCircle size={14} className="mt-0.5 shrink-0 text-default-400" />
              )}
              <span>{f.summary}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
