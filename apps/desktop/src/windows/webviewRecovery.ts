import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Después de recargar el webview principal, `getByLabel` usa `get_all_windows` y puede
 * no devolver ventanas secundarias que siguen vivas pero ocultas en Rust.
 * Si entonces intentas crear otra con el mismo label, el backend emite error y la UI
 * parece «rota». Un {@link WebviewWindow} con `skip: true` solo enlaza el handle JS
 * a la ventana existente (no llama al create).
 * @see https://github.com/tauri-apps/tauri/discussions/11351
 */
export async function resolveExistingWebviewWindow(label: string): Promise<WebviewWindow | null> {
  try {
    const byLabel = await WebviewWindow.getByLabel(label);
    if (byLabel) return byLabel;
  } catch {
    /* ignore */
  }

  // @ts-expect-error `skip` existe en runtime pero no figura en los tipos públicos de la API.
  const skipped = new WebviewWindow(label, { skip: true });
  try {
    await skipped.scaleFactor();
    return skipped;
  } catch {
    return null;
  }
}

export async function showCenteredAndFocus(w: WebviewWindow): Promise<void> {
  try {
    await w.center();
  } catch {
    /* ignore */
  }
  await w.show();
  await w.setFocus();
}
