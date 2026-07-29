import type { Plugin } from "vite";

/**
 * Configuración de mapeo para la sustitución de un componente de HeroUI v3.
 */
export interface ComponentOverrideConfig {
  /**
   * Lista de nombres exportados a interceptar desde `@heroui/react`.
   */
  exports: string[];

  /**
   * Ruta o alias del módulo personalizado que implementa el componente v3.
   */
  targetModule: string;

  /**
   * Función opcional para formatear la especificación de importación (ej. `HeroUISpinnerV3 as Spinner`).
   */
  getImportSpecifier?: (exportName: string) => string;
}

/**
 * Opciones de configuración para el plugin `herouiV3ComponentsPlugin`.
 */
export interface HeroUIV3ComponentsPluginOptions {
  /**
   * Registro de sustituciones de componentes para personalizar o agregar más componentes.
   */
  overrides?: Record<string, ComponentOverrideConfig>;
}

/**
 * Registro predeterminado de componentes de HeroUI v3 sustituidos.
 * Para agregar más componentes en el futuro, basta con agregar una entrada a este mapa.
 */
const DEFAULT_OVERRIDES: Record<string, ComponentOverrideConfig> = {
  Spinner: {
    exports: ["Spinner"],
    targetModule: "@/components/ui/HeroUISpinnerV3",
    getImportSpecifier: () => "HeroUISpinnerV3 as Spinner",
  },
};

/**
 * Plugin extensible de Vite que intercepta las importaciones de componentes desde `@heroui/react`
 * y las redirige automáticamente a implementaciones personalizadas de HeroUI v3.
 *
 * @param options - Opciones de configuración opcionales para extender los componentes interceptados.
 * @returns Instancia del Plugin de Vite.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { herouiV3ComponentsPlugin } from "./plugins/heroui-v3-components.plugin";
 *
 * export default defineConfig({
 *   plugins: [herouiV3ComponentsPlugin()],
 * });
 * ```
 */
export function herouiV3ComponentsPlugin(options: HeroUIV3ComponentsPluginOptions = {}): Plugin {
  const overrides = { ...DEFAULT_OVERRIDES, ...options.overrides };

  // Mapa de consulta rápida: nombreExportado -> { config, exportName }
  const exportToConfigMap = new Map<string, { config: ComponentOverrideConfig; exportName: string }>();

  for (const config of Object.values(overrides)) {
    for (const exp of config.exports) {
      exportToConfigMap.set(exp, { config, exportName: exp });
    }
  }

  return {
    name: "heroui-v3-components",
    enforce: "pre",

    /**
     * Inspecciona y transforma los archivos fuente TypeScript / JSX para redirigir las importaciones configuradas.
     *
     * @param code - Código fuente del archivo.
     * @param id - Ruta absoluta del archivo.
     * @returns Código transformado o `null` si no se realizó modificación.
     */
    transform(code: string, id: string) {
      // Procesar únicamente archivos fuente dentro de /src/
      if (!id.includes("/src/") || (!id.endsWith(".tsx") && !id.endsWith(".ts"))) {
        return null;
      }

      // No transformar los propios componentes de interfaz de la carpeta /src/components/ui/
      if (id.includes("/src/components/ui/HeroUI")) {
        return null;
      }

      // Comprobación rápida: omitir si el archivo no hace referencia a @heroui/react
      if (!code.includes("@heroui/react")) {
        return null;
      }

      // Expresión regular para coincidir con declaraciones de importación nombradas desde "@heroui/react"
      const importRegex = /import\s+\{([^}]+)\}\s+from\s+["']@heroui\/react["'];?/g;

      const newCode = code.replace(importRegex, (match, specifiersString) => {
        const specifiers = specifiersString
          .split(",")
          .map((item: string) => item.trim())
          .filter(Boolean);

        // Separar especificaciones interceptadas de las normales
        const interceptedImports: Array<{ exportName: string; config: ComponentOverrideConfig }> = [];
        const remainingSpecifiers: string[] = [];

        for (const spec of specifiers) {
          const matchOverride = exportToConfigMap.get(spec);
          if (matchOverride) {
            interceptedImports.push({ exportName: spec, config: matchOverride.config });
          } else {
            remainingSpecifiers.push(spec);
          }
        }

        // Si ninguna especificación fue interceptada, mantener la importación original
        if (interceptedImports.length === 0) {
          return match;
        }

        // Agrupar importaciones interceptadas por módulo destino
        const moduleToImportsMap = new Map<string, string[]>();

        for (const { exportName, config } of interceptedImports) {
          const specifierStr = config.getImportSpecifier ? config.getImportSpecifier(exportName) : exportName;

          const existing = moduleToImportsMap.get(config.targetModule) || [];
          existing.push(specifierStr);
          moduleToImportsMap.set(config.targetModule, existing);
        }

        // Generar sentencias de importación redirigidas
        const redirectedStatements: string[] = [];

        moduleToImportsMap.forEach((specs, targetModule) => {
          redirectedStatements.push(`import { ${specs.join(", ")} } from "${targetModule}";`);
        });

        if (remainingSpecifiers.length === 0) {
          return redirectedStatements.join("\n");
        }

        return `import { ${remainingSpecifiers.join(", ")} } from "@heroui/react";\n${redirectedStatements.join("\n")}`;
      });

      if (newCode !== code) {
        return { code: newCode, map: null };
      }

      return null;
    },
  };
}
