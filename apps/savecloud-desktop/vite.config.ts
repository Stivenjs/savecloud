import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

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
      "@contexts": resolve(__dirname, "src/contexts"),
    },
  },

  // Vite options tailored for Tauri development
  clearScreen: false,

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: (!process.env.TAURI_ENV_DEBUG ? "esbuild" : false) as "esbuild" | false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,

    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-ui": ["@heroui/react", "lucide-react", "framer-motion"],
          "vendor-utils": ["gsap", "@tanstack/react-query", "hls.js", "three"],
        },
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
