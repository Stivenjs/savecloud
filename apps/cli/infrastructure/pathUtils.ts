import { join } from "path";

/**
 * Sustituye %VAR% por valores de entorno y ~ por el directorio home.
 */
export function expandPath(raw: string): string {
  const withEnv = raw.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? "");
  if (withEnv.startsWith("~")) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return home ? join(home, withEnv.slice(1)) : withEnv;
  }
  return withEnv;
}
