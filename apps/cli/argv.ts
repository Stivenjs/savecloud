import { KNOWN_COMMANDS } from "@cli/constants";

/**
 * Argumentos del CLI sin el ejecutable ni rutas internas de Bun.
 * Con script: argv[0]=bun, argv[1]=script → args desde 2.
 * Con exe: argv[1] puede ser ruta interna → filtramos la ruta del exe.
 */
export function getCliArgs(): string[] {
  const first = process.argv[1];
  const isUserCommand = typeof first === "string" && KNOWN_COMMANDS.includes(first as (typeof KNOWN_COMMANDS)[number]);
  const raw = isUserCommand ? process.argv.slice(1) : process.argv.slice(2);
  const exePath = process.argv[0] ?? process.execPath ?? "";
  const isExePath = (arg: string) =>
    arg === exePath || arg === process.execPath || arg.endsWith("SaveCloud.exe") || arg.endsWith("SaveCloud");
  return raw.filter((arg) => !isExePath(arg));
}
