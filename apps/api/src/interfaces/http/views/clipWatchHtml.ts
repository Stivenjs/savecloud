import type { ClipMetadata } from "@infrastructure/clips/ClipStore";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function extractSteamAppId(gameId: string, steamAppIdOverride?: string): string | null {
  if (steamAppIdOverride && /^\d+$/.test(steamAppIdOverride.trim())) {
    return steamAppIdOverride.trim();
  }
  const trimmed = gameId.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/-(\d{1,10})$/);
  if (match) {
    return match[1];
  }
  return null;
}

export interface RenderWatchHtmlParams {
  clip: ClipMetadata;
  cdnUrl: string;
  watchUrl: string;
  defaultCoverUrl?: string;
}

export function renderWatchHtml({ clip, cdnUrl, watchUrl, defaultCoverUrl }: RenderWatchHtmlParams): string {
  const safeGameTitle = escapeHtml(
    clip.gameTitle || clip.gameId.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
  );
  const safeUser = escapeHtml(clip.userId);
  const safeFilename = escapeHtml(clip.filename);
  const formattedDate = new Date(clip.createdAt).toLocaleDateString("es-ES", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const logoUrl = defaultCoverUrl || "https://d1imlsrvjyqbfj.cloudfront.net/clips/assets/savecloud-clip-cover.png";
  const safeLogoUrl = escapeHtml(logoUrl);

  const steamAppId = extractSteamAppId(clip.gameId, clip.steamAppId);
  const posterImage =
    clip.posterUrl?.trim() ||
    (steamAppId
      ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/header.jpg`
      : logoUrl);
  const safePosterImage = escapeHtml(posterImage);

  return `<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
  <title>${safeGameTitle} - Clip en SaveCloud</title>
  
  <link rel="icon" type="image/png" href="${safeLogoUrl}">
  <link rel="apple-touch-icon" href="${safeLogoUrl}">

  <meta property="og:site_name" content="SaveCloud">
  <meta property="og:title" content="Clip de ${safeGameTitle}">
  <meta property="og:description" content="Clip de ${safeGameTitle} compartido por ${safeUser} en SaveCloud">
  <meta property="og:type" content="video.other">
  <meta property="og:video" content="${cdnUrl}">
  <meta property="og:video:url" content="${cdnUrl}">
  <meta property="og:video:secure_url" content="${cdnUrl}">
  <meta property="og:video:type" content="${clip.contentType || "video/mp4"}">
  <meta property="og:video:width" content="1280">
  <meta property="og:video:height" content="720">
  <meta property="og:url" content="${watchUrl}">
  <meta name="theme-color" content="#006FEE">

  <meta property="og:image" content="${safePosterImage}">
  <meta property="og:image:secure_url" content="${safePosterImage}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Clip de ${safeGameTitle}">

  <meta name="twitter:card" content="player">
  <meta name="twitter:title" content="Clip de ${safeGameTitle} - SaveCloud">
  <meta name="twitter:description" content="Mira este clip de ${safeGameTitle} compartido en SaveCloud">
  <meta name="twitter:player" content="${watchUrl}">
  <meta name="twitter:player:width" content="1280">
  <meta name="twitter:player:height" content="720">
  <meta name="twitter:player:stream" content="${cdnUrl}">
  <meta name="twitter:player:stream:content_type" content="${clip.contentType || "video/mp4"}">
  <meta name="twitter:image" content="${safePosterImage}">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">

  <style>
    :root {
      --primary: #006FEE;
      --primary-hover: #005bc4;
      --primary-glow: rgba(0, 111, 238, 0.4);
      --bg-base: #09090b;
      --bg-surface: #121216;
      --glass-bg: rgba(14, 14, 18, 0.86);
      --glass-border: rgba(255, 255, 255, 0.09);
      --glass-border-hover: rgba(255, 255, 255, 0.2);
      --text-main: #f4f4f5;
      --text-muted: #a1a1aa;
      --safe-bottom: env(safe-area-inset-bottom, 0px);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    body {
      background-color: var(--bg-base);
      color: var(--text-main);
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow-x: hidden;
      user-select: none;
      -webkit-user-select: none;
    }

    .ambient-glow {
      position: fixed;
      top: 15%;
      left: 50%;
      transform: translate(-50%, -20%) scale(1.1);
      width: 75vw;
      height: 45vh;
      max-width: 960px;
      background: radial-gradient(circle, rgba(0, 111, 238, 0.16) 0%, rgba(147, 51, 234, 0.06) 50%, transparent 75%);
      filter: blur(80px);
      pointer-events: none;
      z-index: 0;
    }

    .app-header {
      position: relative;
      z-index: 10;
      width: 100%;
      max-width: 1120px;
      margin: 0 auto;
      padding: 1.15rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      border-bottom: 1px solid var(--glass-border);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
    }

    .main-container {
      position: relative;
      z-index: 10;
      flex: 1;
      width: 100%;
      max-width: 1080px;
      margin: 0 auto;
      padding: 1.5rem 1.25rem 2rem;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }

    .meta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.85rem;
    }

    .clip-title {
      font-size: clamp(1.15rem, 3.5vw, 1.45rem);
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      letter-spacing: -0.02em;
      line-height: 1.25;
      word-break: break-word;
    }

    .clip-subtitle {
      font-size: clamp(0.75rem, 2.5vw, 0.8125rem);
      color: var(--text-muted);
      margin-top: 0.25rem;
      line-height: 1.4;
    }

    .clip-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.75rem;
      font-family: 'JetBrains Mono', monospace;
      color: #d4d4d8;
      background: rgba(24, 24, 27, 0.75);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      border: 1px solid var(--glass-border);
      max-width: 100%;
    }

    .clip-badge-filename {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: min(240px, 60vw);
    }

    .player-wrapper {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #000;
      border-radius: 1.25rem;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .player-wrapper.hide-cursor {
      cursor: none;
    }

    .player-wrapper:fullscreen,
    .player-wrapper:-webkit-full-screen {
      width: 100vw;
      height: 100vh;
      border-radius: 0;
      border: none;
    }

    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
    }

    .center-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 20;
    }

    .center-play-btn {
      width: clamp(3.75rem, 10vw, 4.5rem);
      height: clamp(3.75rem, 10vw, 4.5rem);
      border-radius: 9999px;
      background: rgba(15, 15, 20, 0.65);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      pointer-events: auto;
      transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.2s, opacity 0.3s;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 25px var(--primary-glow);
    }

    .center-play-btn:hover {
      transform: scale(1.08);
      background: rgba(0, 111, 238, 0.8);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .center-play-btn svg {
      width: clamp(1.6rem, 5vw, 2rem);
      height: clamp(1.6rem, 5vw, 2rem);
      transform: translateX(2px);
    }

    .player-wrapper.is-playing .center-play-btn {
      opacity: 0;
      transform: scale(0.85);
      pointer-events: none;
    }

    .feedback-hud {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) scale(0.7);
      background: rgba(14, 14, 18, 0.9);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 1rem;
      padding: 0.75rem 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #fff;
      font-weight: 600;
      font-size: clamp(0.85rem, 2.5vw, 0.95rem);
      opacity: 0;
      pointer-events: none;
      z-index: 35;
      transition: opacity 0.2s ease, transform 0.2s ease;
      box-shadow: 0 12px 30px rgba(0,0,0,0.7);
      white-space: nowrap;
    }

    .feedback-hud.active {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }

    .buffering-spinner {
      position: absolute;
      width: clamp(2.75rem, 8vw, 3.5rem);
      height: clamp(2.75rem, 8vw, 3.5rem);
      border: 3px solid rgba(255, 255, 255, 0.1);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      z-index: 25;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
    }

    .player-wrapper.is-buffering .buffering-spinner {
      opacity: 1;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .controls-island {
      position: absolute;
      bottom: max(0.65rem, var(--safe-bottom));
      left: 0.65rem;
      right: 0.65rem;
      background: var(--glass-bg);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid var(--glass-border);
      border-radius: 1rem;
      padding: 0.55rem 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      z-index: 30;
      transition: opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1), transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 12px 35px rgba(0, 0, 0, 0.65);
    }

    .player-wrapper:fullscreen .controls-island,
    .player-wrapper:-webkit-full-screen .controls-island {
      max-width: 1040px;
      margin: 0 auto;
      bottom: max(1.25rem, var(--safe-bottom));
      left: 1.25rem;
      right: 1.25rem;
    }

    .player-wrapper.controls-hidden .controls-island {
      opacity: 0;
      transform: translateY(12px);
      pointer-events: none;
    }

    .scrubber-container {
      position: relative;
      width: 100%;
      height: 20px;
      display: flex;
      align-items: center;
      cursor: pointer;
      touch-action: none;
      user-select: none;
    }

    .scrubber-track {
      position: relative;
      width: 100%;
      height: 5px;
      background: rgba(255, 255, 255, 0.14);
      border-radius: 9999px;
      overflow: visible;
      transition: height 0.15s ease;
    }

    .scrubber-container:hover .scrubber-track,
    .scrubber-container.is-dragging .scrubber-track {
      height: 7px;
    }

    .scrubber-buffered {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: rgba(255, 255, 255, 0.28);
      border-radius: 9999px;
      width: 0%;
      transition: width 0.2s ease;
    }

    .scrubber-fill {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: linear-gradient(90deg, #006FEE 0%, #38bdf8 100%);
      border-radius: 9999px;
      width: 0%;
      box-shadow: 0 0 10px var(--primary-glow);
    }

    .scrubber-thumb {
      position: absolute;
      top: 50%;
      left: 0%;
      transform: translate(-50%, -50%) scale(0);
      width: 13px;
      height: 13px;
      background: #fff;
      border-radius: 50%;
      box-shadow: 0 0 10px rgba(0, 111, 238, 0.8);
      pointer-events: none;
      transition: transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    .scrubber-container:hover .scrubber-thumb,
    .scrubber-container.is-dragging .scrubber-thumb {
      transform: translate(-50%, -50%) scale(1.15);
    }

    .seek-tooltip {
      position: absolute;
      bottom: calc(100% + 8px);
      transform: translateX(-50%);
      background: rgba(9, 9, 11, 0.95);
      border: 1px solid var(--glass-border-hover);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      padding: 0.25rem 0.5rem;
      border-radius: 0.4rem;
      font-size: 0.725rem;
      font-family: 'JetBrains Mono', monospace;
      color: #f4f4f5;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s ease;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    }

    .scrubber-container:hover .seek-tooltip {
      opacity: 1;
    }

    .controls-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem;
      flex-wrap: nowrap;
    }

    .btn-group {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      flex-shrink: 0;
    }

    .icon-btn {
      background: transparent;
      border: none;
      color: #d4d4d8;
      width: 2.1rem;
      height: 2.1rem;
      min-width: 2.1rem;
      min-height: 2.1rem;
      border-radius: 0.5rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      margin: 0;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s, transform 0.1s;
    }

    .icon-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }

    .icon-btn:active {
      transform: scale(0.92);
    }

    .icon-btn.is-active {
      color: #38bdf8;
      background: rgba(0, 111, 238, 0.2);
    }

    .icon-btn svg {
      width: 1.2rem;
      height: 1.2rem;
      display: block;
    }

    .time-readout {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.775rem;
      color: #d4d4d8;
      margin-left: 0.35rem;
      letter-spacing: -0.02em;
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      line-height: 1;
    }

    .time-current {
      color: #fff;
      font-weight: 600;
    }

    .volume-group {
      display: flex;
      align-items: center;
      gap: 0.2rem;
    }

    .volume-slider-wrap {
      width: 0;
      overflow: hidden;
      transition: width 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s;
      opacity: 0;
      display: flex;
      align-items: center;
    }

    .volume-group:hover .volume-slider-wrap,
    .volume-group:focus-within .volume-slider-wrap {
      width: 60px;
      opacity: 1;
      margin-right: 0.2rem;
    }

    .volume-range {
      -webkit-appearance: none;
      appearance: none;
      width: 60px;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 9999px;
      outline: none;
      cursor: pointer;
    }

    .volume-range::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 11px;
      height: 11px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 6px rgba(0, 111, 238, 0.8);
      cursor: pointer;
    }

    .speed-container {
      position: relative;
    }

    .speed-btn {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.725rem;
      font-weight: 600;
      padding: 0.25rem 0.5rem;
      border-radius: 0.45rem;
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid var(--glass-border);
      color: #e4e4e7;
      cursor: pointer;
      transition: background 0.15s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
    }

    .speed-btn:hover {
      background: rgba(255, 255, 255, 0.14);
      color: #fff;
    }

    .speed-menu {
      position: absolute;
      bottom: calc(100% + 8px);
      right: 0;
      background: rgba(14, 14, 18, 0.95);
      border: 1px solid var(--glass-border-hover);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 0.75rem;
      padding: 0.35rem;
      display: none;
      flex-direction: column;
      gap: 0.15rem;
      box-shadow: 0 10px 25px rgba(0,0,0,0.7);
      z-index: 50;
      min-width: 5.5rem;
    }

    .speed-menu.show {
      display: flex;
    }

    .speed-opt {
      background: transparent;
      border: none;
      color: #a1a1aa;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      padding: 0.35rem 0.6rem;
      border-radius: 0.4rem;
      text-align: left;
      cursor: pointer;
      transition: background 0.1s, color 0.1s;
    }

    .speed-opt:hover,
    .speed-opt.active {
      background: var(--primary);
      color: #fff;
      font-weight: 600;
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.775rem;
      font-weight: 600;
      padding: 0.45rem 0.85rem;
      border-radius: 0.6rem;
      cursor: pointer;
      text-decoration: none;
      transition: transform 0.12s, background 0.15s, box-shadow 0.2s;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .action-btn:active {
      transform: scale(0.96);
    }

    .btn-secondary {
      background: rgba(39, 39, 42, 0.75);
      color: #f4f4f5;
      border: 1px solid rgba(255, 255, 255, 0.09);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .btn-secondary:hover {
      background: rgba(63, 63, 70, 0.85);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .btn-primary {
      background: var(--primary);
      color: #fff;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 4px 14px var(--primary-glow);
    }

    .btn-primary:hover {
      background: var(--primary-hover);
      box-shadow: 0 6px 20px var(--primary-glow);
    }

    .btn-steam {
      background: #171d25;
      color: #c5c3c0;
      border: 1px solid #2a475e;
    }

    .btn-steam:hover {
      background: #2a475e;
      color: #ffffff;
    }

    .shortcuts-modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 1rem;
    }

    .shortcuts-modal.show {
      display: flex;
    }

    .shortcuts-content {
      background: rgba(18, 18, 22, 0.95);
      border: 1px solid var(--glass-border-hover);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border-radius: 1.25rem;
      max-width: 440px;
      width: 100%;
      padding: 1.5rem;
      box-shadow: 0 25px 60px rgba(0,0,0,0.8);
    }

    .shortcuts-grid {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 0.7rem 1rem;
      margin-top: 1rem;
      font-size: 0.825rem;
    }

    .key-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.725rem;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 0.15rem 0.45rem;
      border-radius: 0.35rem;
      color: #fff;
    }

    footer {
      position: relative;
      z-index: 10;
      padding: 1.25rem 1.5rem;
      text-align: center;
      font-size: 0.75rem;
      color: #71717a;
      border-top: 1px solid var(--glass-border);
    }

    @media (max-width: 768px) {
      .app-header {
        padding: 0.85rem 1.15rem;
      }
      .main-container {
        padding: 1.15rem 1rem 1.75rem;
      }
      .hide-tablet {
        display: none !important;
      }
    }

    @media (max-width: 640px) {
      .app-header {
        padding: 0.75rem 0.9rem;
      }
      .main-container {
        padding: 0.85rem 0.65rem 1.5rem;
      }
      .meta-row {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.45rem;
        margin-bottom: 0.65rem;
      }
      .clip-badge {
        align-self: flex-start;
      }
      .btn-label-mobile {
        display: none !important;
      }
      .action-btn {
        padding: 0.45rem 0.65rem;
      }
      .controls-island {
        bottom: max(0.45rem, var(--safe-bottom));
        left: 0.45rem;
        right: 0.45rem;
        padding: 0.45rem 0.6rem;
        gap: 0.35rem;
        border-radius: 0.85rem;
      }
      .volume-slider-wrap {
        display: none !important;
      }
      .hide-mobile {
        display: none !important;
      }
    }

    @media (max-width: 420px) {
      .app-header {
        padding: 0.65rem 0.75rem;
      }
      .main-container {
        padding: 0.65rem 0.45rem 1.25rem;
      }
      .player-wrapper {
        border-radius: 0.85rem;
      }
      .time-readout {
        font-size: 0.7rem;
        margin-left: 0.15rem;
      }
      .icon-btn {
        width: 1.9rem;
        height: 1.9rem;
        min-width: 1.9rem;
        min-height: 1.9rem;
      }
      .icon-btn svg {
        width: 1.1rem;
        height: 1.1rem;
      }
      .speed-btn {
        padding: 0.2rem 0.35rem;
        font-size: 0.68rem;
      }
      .hide-mini {
        display: none !important;
      }
      .badge-clips {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="ambient-glow"></div>

  <header class="app-header">
    <div style="display: flex; align-items: center; gap: 0.65rem; min-width: 0;">
      <img src="${safeLogoUrl}" alt="SaveCloud" style="width: 1.85rem; height: 1.85rem; object-fit: contain; flex-shrink: 0;">
      <div style="display: flex; align-items: center; gap: 0.45rem; min-width: 0;">
        <span style="font-weight: 800; font-size: clamp(0.95rem, 3.5vw, 1.1rem); color: #fff; letter-spacing: -0.02em; white-space: nowrap;">SaveCloud</span>
        <span class="badge-clips" style="font-size: 0.625rem; font-weight: 700; background: rgba(0, 111, 238, 0.15); color: #38bdf8; border: 1px solid rgba(0, 111, 238, 0.3); padding: 0.125rem 0.45rem; border-radius: 9999px; text-transform: uppercase;">Clips</span>
      </div>
    </div>

    <div style="display: flex; align-items: center; gap: 0.45rem; flex-shrink: 0;">
      ${
        steamAppId
          ? `<a href="https://store.steampowered.com/app/${steamAppId}" target="_blank" rel="noopener noreferrer" class="action-btn btn-steam" title="Ver en Steam">
              <svg style="width: 0.95rem; height: 0.95rem;" viewBox="0 0 24 24" fill="currentColor"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.524-4.524 4.524h-.105l-4.076 2.911c0 .052.005.105.005.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 12-5.373 12-12S18.605 0 11.979 0z"/></svg>
              <span class="btn-label-mobile">Steam</span>
            </a>`
          : ""
      }
      <button id="copyBtn" onclick="copyShareUrl()" class="action-btn btn-secondary" title="Copiar Enlace">
        <svg style="width: 0.95rem; height: 0.95rem;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <span id="copyText" class="btn-label-mobile">Copiar Enlace</span>
      </button>

      <button id="downloadBtn" onclick="downloadClipDirect('${cdnUrl}', '${safeFilename}')" class="action-btn btn-primary" title="Descargar Video">
        <svg style="width: 0.95rem; height: 0.95rem;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span id="downloadText" class="btn-label-mobile">Descargar</span>
      </button>
    </div>
  </header>

  <main class="main-container">
    <div class="meta-row">
      <div style="min-width: 0;">
        <h1 class="clip-title">
          ${safeGameTitle}
        </h1>
        <p class="clip-subtitle">
          Por <strong style="color: #f4f4f5;">${safeUser}</strong> &bull; ${formattedDate}
        </p>
      </div>
      <div class="clip-badge">
        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #006fee; box-shadow: 0 0 8px #006fee; flex-shrink: 0;"></span>
        <span class="clip-badge-filename">${safeFilename}</span>
      </div>
    </div>

    <div id="playerRoot" class="player-wrapper">
      <video
        id="videoEl"
        src="${cdnUrl}"
        poster="${safePosterImage}"
        playsinline
        preload="metadata"
      >
        Tu navegador no soporta vídeo HTML5.
      </video>

      <div class="buffering-spinner"></div>

      <div id="feedbackHud" class="feedback-hud">
        <span id="feedbackIcon"></span>
        <span id="feedbackText"></span>
      </div>

      <div class="center-overlay">
        <button id="centerPlayBtn" class="center-play-btn" aria-label="Reproducir">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72L9.5 4.28a1 1 0 0 0-1.5.86z"/>
          </svg>
        </button>
      </div>

      <div id="controlsIsland" class="controls-island">
        <div id="scrubberContainer" class="scrubber-container">
          <div class="scrubber-track">
            <div id="scrubberBuffered" class="scrubber-buffered"></div>
            <div id="scrubberFill" class="scrubber-fill"></div>
            <div id="scrubberThumb" class="scrubber-thumb"></div>
          </div>
          <div id="seekTooltip" class="seek-tooltip">00:00</div>
        </div>

        <div class="controls-row">
          <div class="btn-group">
            <button id="playPauseBtn" class="icon-btn" title="Reproducir (Espacio)">
              <svg id="playIcon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72L9.5 4.28a1 1 0 0 0-1.5.86z"/>
              </svg>
              <svg id="pauseIcon" style="display:none;" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 5h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm8 0h4a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>
              </svg>
            </button>

            <button id="replay5Btn" class="icon-btn" title="Retroceder 5s (←)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
                <text x="12" y="15.5" text-anchor="middle" font-size="7.5" font-family="'JetBrains Mono', monospace" font-weight="700" fill="currentColor" stroke="none">5</text>
              </svg>
            </button>

            <button id="forward5Btn" class="icon-btn" title="Avanzar 5s (→)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
                <text x="12" y="15.5" text-anchor="middle" font-size="7.5" font-family="'JetBrains Mono', monospace" font-weight="700" fill="currentColor" stroke="none">5</text>
              </svg>
            </button>

            <div class="volume-group">
              <button id="muteBtn" class="icon-btn" title="Silenciar (M)">
                <svg id="volHighIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" fill-opacity="0.2"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                </svg>
                <svg id="volMuteIcon" style="display:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" fill-opacity="0.2"/>
                  <line x1="23" y1="9" x2="17" y2="15"/>
                  <line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
              </button>
              <div class="volume-slider-wrap">
                <input id="volumeSlider" type="range" min="0" max="1" step="0.05" value="1" class="volume-range" />
              </div>
            </div>

            <div class="time-readout">
              <span id="currentTime" class="time-current">00:00</span>&nbsp;/&nbsp;<span id="durationTime">00:00</span>
            </div>
          </div>

          <div class="btn-group">
            <div class="speed-container">
              <button id="speedBtn" class="speed-btn" title="Velocidad">1x</button>
              <div id="speedMenu" class="speed-menu">
                <button class="speed-opt" data-speed="0.25">0.25x</button>
                <button class="speed-opt" data-speed="0.5">0.5x</button>
                <button class="speed-opt" data-speed="0.75">0.75x</button>
                <button class="speed-opt active" data-speed="1">1.0x</button>
                <button class="speed-opt" data-speed="1.25">1.25x</button>
                <button class="speed-opt" data-speed="1.5">1.5x</button>
                <button class="speed-opt" data-speed="2">2.0x</button>
              </div>
            </div>

            <button id="loopBtn" class="icon-btn hide-mini" title="Repetir en bucle (R)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="17 1 21 5 17 9"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7 23 3 19 7 15"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
              </svg>
            </button>

            <button id="pipBtn" class="icon-btn hide-mobile" title="Picture-in-Picture (P)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <rect x="12" y="11" width="8" height="7" rx="1" fill="currentColor" fill-opacity="0.3"/>
              </svg>
            </button>

            <button id="helpBtn" class="icon-btn hide-mobile" title="Atajos de teclado (?)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </button>

            <button id="fullscreenBtn" class="icon-btn" title="Pantalla completa (F)">
              <svg id="enterFsIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
              <svg id="exitFsIcon" style="display:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </main>

  <div id="shortcutsModal" class="shortcuts-modal" onclick="closeShortcutsModal(event)">
    <div class="shortcuts-content" onclick="event.stopPropagation()">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="font-size: 1.1rem; font-weight: 700; color: #fff;">Atajos de Teclado</h2>
        <button onclick="closeShortcutsModal()" class="icon-btn" style="width: 1.5rem; height: 1.5rem;">✕</button>
      </div>
      <div class="shortcuts-grid">
        <span>Reproducir / Pausar</span><span class="key-badge">Espacio / K</span>
        <span>Avanzar / Retroceder 5s</span><span class="key-badge">← / →</span>
        <span>Avanzar / Retroceder 10s</span><span class="key-badge">J / L</span>
        <span>Subir / Bajar Volumen</span><span class="key-badge">↑ / ↓</span>
        <span>Silenciar (Mute)</span><span class="key-badge">M</span>
        <span>Pantalla Completa</span><span class="key-badge">F</span>
        <span>Picture-in-Picture</span><span class="key-badge">P</span>
        <span>Repetir en bucle</span><span class="key-badge">R</span>
        <span>Avanzar 1 fotograma</span><span class="key-badge">, / .</span>
        <span>Saltar al 0% - 90%</span><span class="key-badge">0 - 9</span>
      </div>
    </div>
  </div>

  <footer>
    <p>SaveCloud &bull; Guardado y clips en la nube de alta fidelidad</p>
  </footer>

  <script>
    // --- State & DOM Elements ---
    const playerRoot = document.getElementById('playerRoot');
    const video = document.getElementById('videoEl');
    const centerPlayBtn = document.getElementById('centerPlayBtn');
    const playPauseBtn = document.getElementById('playPauseBtn');
    const playIcon = document.getElementById('playIcon');
    const pauseIcon = document.getElementById('pauseIcon');
    const replay5Btn = document.getElementById('replay5Btn');
    const forward5Btn = document.getElementById('forward5Btn');
    const scrubberContainer = document.getElementById('scrubberContainer');
    const scrubberBuffered = document.getElementById('scrubberBuffered');
    const scrubberFill = document.getElementById('scrubberFill');
    const scrubberThumb = document.getElementById('scrubberThumb');
    const seekTooltip = document.getElementById('seekTooltip');
    const currentTimeEl = document.getElementById('currentTime');
    const durationTimeEl = document.getElementById('durationTime');
    const muteBtn = document.getElementById('muteBtn');
    const volHighIcon = document.getElementById('volHighIcon');
    const volMuteIcon = document.getElementById('volMuteIcon');
    const volumeSlider = document.getElementById('volumeSlider');
    const speedBtn = document.getElementById('speedBtn');
    const speedMenu = document.getElementById('speedMenu');
    const loopBtn = document.getElementById('loopBtn');
    const pipBtn = document.getElementById('pipBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const enterFsIcon = document.getElementById('enterFsIcon');
    const exitFsIcon = document.getElementById('exitFsIcon');
    const feedbackHud = document.getElementById('feedbackHud');
    const feedbackText = document.getElementById('feedbackText');
    const feedbackIcon = document.getElementById('feedbackIcon');
    const helpBtn = document.getElementById('helpBtn');
    const shortcutsModal = document.getElementById('shortcutsModal');

    let isDraggingScrubber = false;
    let hideControlsTimeout = null;
    let feedbackTimeout = null;
    let lastTapTime = 0;

    // --- Helpers ---
    function formatTime(seconds) {
      if (isNaN(seconds) || seconds < 0) return '00:00';
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function showFeedback(text, iconSvg) {
      feedbackText.textContent = text;
      feedbackIcon.innerHTML = iconSvg || '';
      feedbackHud.classList.add('active');
      clearTimeout(feedbackTimeout);
      feedbackTimeout = setTimeout(() => feedbackHud.classList.remove('active'), 850);
    }

    // --- Inactivity Auto-Hide ---
    function resetHideControlsTimer() {
      playerRoot.classList.remove('controls-hidden');
      playerRoot.classList.remove('hide-cursor');
      clearTimeout(hideControlsTimeout);

      if (!video.paused && !isDraggingScrubber && !speedMenu.classList.contains('show')) {
        hideControlsTimeout = setTimeout(() => {
          if (!video.paused && !isDraggingScrubber) {
            playerRoot.classList.add('controls-hidden');
            playerRoot.classList.add('hide-cursor');
          }
        }, 2800);
      }
    }

    playerRoot.addEventListener('mousemove', resetHideControlsTimer);
    playerRoot.addEventListener('touchstart', resetHideControlsTimer, { passive: true });
    playerRoot.addEventListener('touchmove', resetHideControlsTimer, { passive: true });

    // --- Play / Pause ---
    function togglePlay() {
      if (video.paused || video.ended) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }

    centerPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlay();
    });

    playPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlay();
    });

    video.addEventListener('click', (e) => {
      if (e.target !== video) return;
      const now = Date.now();
      const diff = now - lastTapTime;
      const rect = video.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;

      if (diff < 300) {
        if (x < width * 0.35) {
          video.currentTime = Math.max(0, video.currentTime - 5);
          showFeedback('-5s');
        } else if (x > width * 0.65) {
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
          showFeedback('+5s');
        } else {
          toggleFullscreen();
        }
      } else {
        if (window.innerWidth <= 640 && playerRoot.classList.contains('controls-hidden')) {
          resetHideControlsTimer();
        } else {
          togglePlay();
        }
      }
      lastTapTime = now;
    });

    video.addEventListener('play', () => {
      playerRoot.classList.add('is-playing');
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
      resetHideControlsTimer();
    });

    video.addEventListener('pause', () => {
      playerRoot.classList.remove('is-playing');
      playerRoot.classList.remove('controls-hidden');
      playerRoot.classList.remove('hide-cursor');
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
      clearTimeout(hideControlsTimeout);
    });

    video.addEventListener('waiting', () => playerRoot.classList.add('is-buffering'));
    video.addEventListener('playing', () => playerRoot.classList.remove('is-buffering'));
    video.addEventListener('canplay', () => playerRoot.classList.remove('is-buffering'));

    // --- Time & Progress Updates ---
    function updateProgress() {
      if (!isDraggingScrubber && video.duration) {
        const pct = (video.currentTime / video.duration) * 100;
        scrubberFill.style.width = pct + '%';
        scrubberThumb.style.left = pct + '%';
        currentTimeEl.textContent = formatTime(video.currentTime);
      }
      updateBuffer();
    }

    function updateBuffer() {
      if (video.buffered.length > 0 && video.duration) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        const pct = (bufferedEnd / video.duration) * 100;
        scrubberBuffered.style.width = Math.min(pct, 100) + '%';
      }
    }

    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('progress', updateBuffer);
    video.addEventListener('loadedmetadata', () => {
      durationTimeEl.textContent = formatTime(video.duration);
      currentTimeEl.textContent = formatTime(video.currentTime);
    });

    // --- Scrubber Scrubbing ---
    function getScrubberFraction(e) {
      const rect = scrubberContainer.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const pos = Math.max(0, Math.min(clientX - rect.left, rect.width));
      return pos / rect.width;
    }

    function handleScrubberMove(e) {
      const fraction = getScrubberFraction(e);
      const time = fraction * (video.duration || 0);

      if (isDraggingScrubber) {
        const pct = fraction * 100;
        scrubberFill.style.width = pct + '%';
        scrubberThumb.style.left = pct + '%';
        currentTimeEl.textContent = formatTime(time);
      }

      const rect = scrubberContainer.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      seekTooltip.style.left = x + 'px';
      seekTooltip.textContent = formatTime(time);
    }

    scrubberContainer.addEventListener('mousedown', (e) => {
      isDraggingScrubber = true;
      scrubberContainer.classList.add('is-dragging');
      handleScrubberMove(e);
      const fraction = getScrubberFraction(e);
      if (video.duration) video.currentTime = fraction * video.duration;
    });

    window.addEventListener('mousemove', (e) => {
      if (isDraggingScrubber) {
        handleScrubberMove(e);
        const fraction = getScrubberFraction(e);
        if (video.duration) video.currentTime = fraction * video.duration;
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDraggingScrubber) {
        isDraggingScrubber = false;
        scrubberContainer.classList.remove('is-dragging');
        resetHideControlsTimer();
      }
    });

    scrubberContainer.addEventListener('mousemove', handleScrubberMove);

    scrubberContainer.addEventListener('touchstart', (e) => {
      isDraggingScrubber = true;
      scrubberContainer.classList.add('is-dragging');
      handleScrubberMove(e);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (isDraggingScrubber) {
        handleScrubberMove(e);
        const fraction = getScrubberFraction(e);
        if (video.duration) video.currentTime = fraction * video.duration;
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      if (isDraggingScrubber) {
        isDraggingScrubber = false;
        scrubberContainer.classList.remove('is-dragging');
      }
    });

    // --- Replay / Forward 5s ---
    replay5Btn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.currentTime = Math.max(0, video.currentTime - 5);
      showFeedback('-5s');
    });

    forward5Btn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      showFeedback('+5s');
    });

    // --- Volume & Mute ---
    function updateVolumeUI() {
      const isMuted = video.muted || video.volume === 0;
      volHighIcon.style.display = isMuted ? 'none' : 'block';
      volMuteIcon.style.display = isMuted ? 'block' : 'none';
      volumeSlider.value = isMuted ? 0 : video.volume;
      localStorage.setItem('savecloud_clip_volume', String(video.volume));
      localStorage.setItem('savecloud_clip_muted', String(video.muted));
    }

    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.muted = !video.muted;
      updateVolumeUI();
      showFeedback(video.muted ? 'Silenciado' : Math.round(video.volume * 100) + '%');
    });

    volumeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      video.volume = val;
      video.muted = val === 0;
      updateVolumeUI();
    });

    const savedVol = localStorage.getItem('savecloud_clip_volume');
    const savedMuted = localStorage.getItem('savecloud_clip_muted');
    if (savedVol !== null) video.volume = Math.max(0, Math.min(1, parseFloat(savedVol)));
    if (savedMuted === 'true') video.muted = true;
    updateVolumeUI();

    // --- Playback Speed ---
    speedBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      speedMenu.classList.toggle('show');
    });

    document.querySelectorAll('.speed-opt').forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const speed = parseFloat(opt.getAttribute('data-speed'));
        video.playbackRate = speed;
        speedBtn.textContent = speed + 'x';
        document.querySelectorAll('.speed-opt').forEach((o) => o.classList.remove('active'));
        opt.classList.add('active');
        speedMenu.classList.remove('show');
        showFeedback(speed + 'x');
      });
    });

    document.addEventListener('click', () => speedMenu.classList.remove('show'));

    // --- Loop Toggle ---
    loopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      video.loop = !video.loop;
      loopBtn.classList.toggle('is-active', video.loop);
      showFeedback(video.loop ? 'Bucle activado' : 'Bucle desactivado');
    });

    // --- Picture in Picture ---
    pipBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (document.pictureInPictureEnabled) {
          await video.requestPictureInPicture();
        }
      } catch (err) {
        console.error(err);
      }
    });

    // --- Fullscreen ---
    function toggleFullscreen() {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (playerRoot.requestFullscreen) {
          playerRoot.requestFullscreen().catch(() => {});
        } else if (playerRoot.webkitRequestFullscreen) {
          playerRoot.webkitRequestFullscreen();
        } else if (video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    }

    fullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullscreen();
    });

    document.addEventListener('fullscreenchange', () => {
      const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      enterFsIcon.style.display = isFs ? 'none' : 'block';
      exitFsIcon.style.display = isFs ? 'block' : 'none';
    });

    document.addEventListener('webkitfullscreenchange', () => {
      const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
      enterFsIcon.style.display = isFs ? 'none' : 'block';
      exitFsIcon.style.display = isFs ? 'block' : 'none';
    });

    // --- Keyboard Shortcuts ---
    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) return;

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'arrowleft':
        case 'j':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          showFeedback('-5s');
          break;
        case 'arrowright':
        case 'l':
          e.preventDefault();
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
          showFeedback('+5s');
          break;
        case 'arrowup':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          video.muted = false;
          updateVolumeUI();
          showFeedback(Math.round(video.volume * 100) + '%');
          break;
        case 'arrowdown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          updateVolumeUI();
          showFeedback(Math.round(video.volume * 100) + '%');
          break;
        case 'm':
          e.preventDefault();
          video.muted = !video.muted;
          updateVolumeUI();
          showFeedback(video.muted ? 'Silenciado' : Math.round(video.volume * 100) + '%');
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'p':
          e.preventDefault();
          pipBtn.click();
          break;
        case 'r':
          e.preventDefault();
          loopBtn.click();
          break;
        case ',':
          if (video.paused) video.currentTime = Math.max(0, video.currentTime - 0.04);
          break;
        case '.':
          if (video.paused) video.currentTime = Math.min(video.duration || 0, video.currentTime + 0.04);
          break;
        case '?':
          shortcutsModal.classList.toggle('show');
          break;
        case 'escape':
          shortcutsModal.classList.remove('show');
          break;
        default:
          if (e.key >= '0' && e.key <= '9' && video.duration) {
            const pct = parseInt(e.key) / 10;
            video.currentTime = video.duration * pct;
            showFeedback((pct * 100) + '%');
          }
          break;
      }
    });

    helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      shortcutsModal.classList.add('show');
    });

    function closeShortcutsModal(e) {
      shortcutsModal.classList.remove('show');
    }

    // --- Copy & Download Actions ---
    function copyShareUrl() {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => {
        const textEl = document.getElementById('copyText');
        const orig = textEl.textContent;
        textEl.textContent = '¡Copiado!';
        textEl.style.color = '#34d399';
        setTimeout(() => {
          textEl.textContent = orig;
          textEl.style.color = '';
        }, 2000);
      }).catch(() => {
        prompt('Copia este enlace:', url);
      });
    }

    async function downloadClipDirect(url, filename) {
      const btn = document.getElementById('downloadBtn');
      const textEl = document.getElementById('downloadText');
      const orig = textEl.textContent;

      textEl.textContent = 'Descargando...';
      btn.disabled = true;

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Fallo al descargar');
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename || 'clip.mp4';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        textEl.textContent = '¡Listo!';
        setTimeout(() => {
          textEl.textContent = orig;
          btn.disabled = false;
        }, 2000);
      } catch (err) {
        console.error(err);
        window.open(url, '_blank');
        textEl.textContent = orig;
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`;
}

export function renderNotFoundHtml(defaultCoverUrl?: string): string {
  const logoUrl = escapeHtml(
    defaultCoverUrl || "https://d1imlsrvjyqbfj.cloudfront.net/clips/assets/savecloud-clip-cover.png"
  );

  return `<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Clip no encontrado - SaveCloud</title>
  <link rel="icon" type="image/png" href="${logoUrl}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      background-color: #09090b;
      color: #f4f4f5;
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      min-height: 100vh;
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.25rem;
      margin: 0;
      box-sizing: border-box;
    }
    .card {
      text-align: center;
      max-width: 420px;
      width: 100%;
      background: rgba(18, 18, 22, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 2.25rem 1.75rem;
      border-radius: 1.25rem;
      box-shadow: 0 20px 50px rgba(0,0,0,0.7);
    }
    .logo {
      width: 3.25rem;
      height: 3.25rem;
      margin: 0 auto 1.25rem;
      object-fit: contain;
    }
    h1 {
      font-size: 1.3rem;
      font-weight: 700;
      color: #fff;
      margin-bottom: 0.5rem;
    }
    p {
      color: #a1a1aa;
      font-size: 0.875rem;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="card">
    <img src="${logoUrl}" alt="SaveCloud" class="logo" />
    <h1>Clip no encontrado</h1>
    <p>El clip que estás buscando no existe o ha sido eliminado de la nube.</p>
  </div>
</body>
</html>`;
}
