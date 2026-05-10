import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

function readAppVersion(): string {
  try {
    const raw = readFileSync(resolve(__dirname, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readGitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf-8",
      cwd: resolve(__dirname, "../.."),
    }).trim();
  } catch {
    return "";
  }
}

const savecloudBuildDefines = {
  __SAVECLOUD_APP_VERSION__: JSON.stringify(readAppVersion()),
  __SAVECLOUD_GIT_SHORT_SHA__: JSON.stringify(readGitShortSha()),
} as const;

const ReactCompilerConfig = {
  target: "19" as const,
};

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
    tailwindcss(),
  ].flat(),

  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@components": resolve(__dirname, "src/components"),
      "@features": resolve(__dirname, "src/features"),
      "@hooks": resolve(__dirname, "src/hooks"),
      "@services": resolve(__dirname, "src/services"),
      "@utils": resolve(__dirname, "src/utils"),
      "@app-types": resolve(__dirname, "src/types"),
      "@store": resolve(__dirname, "src/store"),
      "@styles": resolve(__dirname, "src/styles"),
      "@lib": resolve(__dirname, "src/lib"),
      "@router": resolve(__dirname, "src/router"),
    },
  },

  clearScreen: false,
  define: savecloudBuildDefines,
  esbuild: {
    drop: process.env.TAURI_ENV_DEBUG ? [] : ["console", "debugger"],
  },

  optimizeDeps: {
    include: ["react", "react-dom", "@tanstack/react-query"],
  },

  build: {
    cssCodeSplit: true,
    target: "esnext",
    minify: (!process.env.TAURI_ENV_DEBUG ? "esbuild" : false) as "esbuild" | false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,

    manualChunks(id, { getModuleInfo }) {
      if (!id.includes("node_modules")) return;

      const info = getModuleInfo(id);

      if (info?.dynamicImporters?.length) {
        return "lazy";
      }

      return "vendor";
    },

    rollupOptions: {
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        entryFileNames: "entry/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    fs: {
      allow: [resolve(__dirname, "..", "..")],
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  envPrefix: ["VITE_", "TAURI_ENV_*"],
}));
