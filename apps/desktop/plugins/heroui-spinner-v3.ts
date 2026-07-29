import type { Plugin } from "vite";

/**
 * Opciones de configuración para el plugin de Vite `herouiSpinnerV3Plugin`.
 */
export interface HeroUISpinnerV3PluginOptions {
  /**
   * Ruta o alias del módulo al cual redirigir las importaciones de `Spinner`.
   * @default "@/components/ui/HeroUISpinnerV3"
   */
  targetModule?: string;
}

/**
 * Plugin personalizado de Vite que intercepta las importaciones de `Spinner` desde `@heroui/react`
 * y las redirige de forma transparente al componente de spinner de HeroUI v3.
 *
 * @param options - Opciones de configuración opcionales.
 * @returns Instancia del Plugin de Vite.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { herouiSpinnerV3Plugin } from "./plugins/heroui-spinner-v3";
 *
 * export default defineConfig({
 *   plugins: [herouiSpinnerV3Plugin()],
 * });
 * ```
 */
export function herouiSpinnerV3Plugin(options: HeroUISpinnerV3PluginOptions = {}): Plugin {
  const { targetModule = "@/components/ui/HeroUISpinnerV3" } = options;

  return {
    name: "heroui-spinner-v3",
    enforce: "pre",

    /**
     * Inspecciona y transforma los archivos fuente TypeScript / JSX para redirigir las importaciones de `Spinner`.
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

      // No transformar el propio componente objetivo del spinner
      if (id.includes("HeroUISpinnerV3.tsx")) {
        return null;
      }

      // Comprobación rápida: omitir si el archivo no hace referencia a @heroui/react o Spinner
      if (!code.includes("@heroui/react") || !code.includes("Spinner")) {
        return null;
      }

      // Expresión regular para coincidir con declaraciones de importación nombradas desde "@heroui/react"
      const importRegex = /import\s+\{([^}]+)\}\s+from\s+["']@heroui\/react["'];?/g;

      const newCode = code.replace(importRegex, (match, specifiersString) => {
        const specifiers = specifiersString
          .split(",")
          .map((item: string) => item.trim())
          .filter(Boolean);

        if (!specifiers.includes("Spinner")) {
          return match;
        }

        const remainingSpecifiers = specifiers.filter((s: string) => s !== "Spinner");
        const spinnerImportStatement = `import { HeroUISpinnerV3 as Spinner } from "${targetModule}";`;

        if (remainingSpecifiers.length === 0) {
          return spinnerImportStatement;
        }

        return `import { ${remainingSpecifiers.join(", ")} } from "@heroui/react";\n${spinnerImportStatement}`;
      });

      if (newCode !== code) {
        return { code: newCode, map: null };
      }

      return null;
    },
  };
}
