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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['"Plus Jakarta Sans"', 'sans-serif'],
          },
          colors: {
            primary: '#006FEE',
            'primary-hover': '#005bc4',
            background: '#09090b',
            surface: '#121216',
            'surface-border': 'rgba(255, 255, 255, 0.08)',
          }
        }
      }
    }
  </script>
  <style>
    body {
      background-color: #09090b;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }
    video::-webkit-media-controls-panel {
      background-image: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
    }
  </style>
</head>
<body class="min-h-screen text-zinc-100 flex flex-col justify-between selection:bg-blue-500/30 selection:text-blue-200">
  <header class="w-full max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between border-b border-zinc-800/60">
    <div class="flex items-center gap-3">
      <img
        src="${safeLogoUrl}"
        alt="SaveCloud"
        class="size-8 object-contain"
      />
      <div>
        <div class="flex items-center gap-2">
          <span class="font-bold tracking-tight text-white text-lg">SaveCloud</span>
          <span class="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-semibold border border-blue-500/20">Clips</span>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2.5">
      <button id="copyBtn" onclick="copyShareUrl()" class="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-zinc-800/90 hover:bg-zinc-700 active:scale-95 transition-all text-zinc-200 border border-zinc-700/50 shadow-sm cursor-pointer">
        <svg id="copyIcon" class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        <span id="copyText">Copiar Enlace</span>
      </button>
      
      <button id="downloadBtn" onclick="downloadClipDirect('${cdnUrl}', '${safeFilename}')" class="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all text-white shadow-md shadow-blue-600/25 cursor-pointer">
        <svg id="downloadIcon" class="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        <span id="downloadText">Descargar</span>
      </button>
    </div>
  </header>

  <main class="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col justify-center">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          ${safeGameTitle}
        </h1>
        <p class="text-xs sm:text-sm text-zinc-400 mt-0.5">
          Clip compartido por <span class="text-zinc-200 font-medium">${safeUser}</span> &bull; ${formattedDate}
        </p>
      </div>
      <div class="flex items-center gap-2 text-xs text-zinc-400 bg-zinc-900/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-zinc-800">
        <span class="inline-block size-2 rounded-full bg-blue-500"></span>
        <span class="truncate max-w-[200px] sm:max-w-xs font-mono text-zinc-300">${safeFilename}</span>
      </div>
    </div>

    <div class="relative w-full rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-2xl shadow-black/80 aspect-video flex items-center justify-center group">
      <video
        id="player"
        src="${cdnUrl}"
        controls
        autoplay
        playsinline
        preload="auto"
        class="w-full h-full object-contain"
      >
        Tu navegador no soporta la reproducción de este vídeo HTML5.
      </video>
    </div>
  </main>

  <footer class="py-6 text-center text-xs text-zinc-500 border-t border-zinc-800/40">
    <p>SaveCloud &bull; Guardado y clips en la nube de alta velocidad</p>
  </footer>

  <script>
    function copyShareUrl() {
      const url = window.location.href;
      navigator.clipboard.writeText(url).then(() => {
        const textEl = document.getElementById('copyText');
        const originalText = textEl.textContent;
        textEl.textContent = '¡Copiado!';
        textEl.classList.add('text-emerald-400');
        setTimeout(() => {
          textEl.textContent = originalText;
          textEl.classList.remove('text-emerald-400');
        }, 2000);
      }).catch(() => {
        prompt('Copia este enlace:', url);
      });
    }

    async function downloadClipDirect(url, filename) {
      const btn = document.getElementById('downloadBtn');
      const textEl = document.getElementById('downloadText');
      const originalText = textEl.textContent;

      textEl.textContent = 'Descargando...';
      btn.disabled = true;

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Fallo al descargar archivo');
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
          textEl.textContent = originalText;
          btn.disabled = false;
        }, 2000);
      } catch (err) {
        console.error(err);
        window.open(url, '_blank');
        textEl.textContent = originalText;
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clip no encontrado - SaveCloud</title>
  <link rel="icon" type="image/png" href="${logoUrl}">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-zinc-950 text-zinc-100 min-h-screen flex items-center justify-center p-4 font-sans">
  <div class="text-center max-w-md">
    <img src="${logoUrl}" alt="SaveCloud" class="size-16 mx-auto mb-4 object-contain" />
    <h1 class="text-xl font-bold text-white mb-2">Clip no encontrado</h1>
    <p class="text-zinc-400 text-sm">El clip que estás buscando no existe o ha sido eliminado.</p>
  </div>
</body>
</html>`;
}
