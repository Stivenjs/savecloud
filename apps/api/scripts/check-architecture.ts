import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(scriptDirectory, "..", "src");

interface DependencyRule {
  directory: string;
  forbidden: RegExp[];
  description: string;
}

const rules: DependencyRule[] = [
  {
    directory: "domain",
    forbidden: [/@application\//, /@infrastructure\//, /@interfaces\//, /@adapters\//, /@shared\//],
    description: "El dominio no debe depender de otras capas ni de utilidades compartidas técnicas.",
  },
  {
    directory: "application",
    forbidden: [/@infrastructure\//, /@interfaces\//, /@adapters\//],
    description: "La aplicación no debe depender de adaptadores o interfaces de entrada.",
  },
  {
    directory: "infrastructure",
    forbidden: [/@interfaces\//],
    description: "La infraestructura no debe depender de los entrypoints o adaptadores de entrada.",
  },
  {
    directory: "interfaces/http/routes",
    forbidden: [/@infrastructure\//],
    description: "Las rutas HTTP deben depender de contratos y casos de uso, no de adaptadores concretos.",
  },
  {
    directory: "interfaces/http/views",
    forbidden: [/@infrastructure\//, /@application\//],
    description: "Las vistas HTTP deben recibir datos ya preparados, sin acoplarse a capas internas.",
  },
];

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

const violations: string[] = [];
for (const rule of rules) {
  const directory = join(sourceDirectory, rule.directory);
  for (const file of listTypeScriptFiles(directory)) {
    const source = readFileSync(file, "utf8");
    for (const forbiddenImport of rule.forbidden) {
      if (forbiddenImport.test(source)) {
        violations.push(`${relative(sourceDirectory, file)}: ${rule.description}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Se encontraron dependencias que rompen las reglas de arquitectura de la API:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Reglas de dependencias de la API verificadas correctamente.");
}
