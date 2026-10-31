import catalogData from "../../../../catalog/emulators.json";
import type { EmulatorCatalogEntry } from "../types/emulatorCatalog";

/** Catálogo estático de emuladores que SaveCloud sabe detectar y configurar. */
export const emulatorCatalog: readonly EmulatorCatalogEntry[] = catalogData;
