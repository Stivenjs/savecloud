import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { HeroUIProvider } from "@heroui/react";
import App from "./App";
import "./styles/index.css";

const THEME_CONFIG = {
  attribute: "class" as const,
  defaultTheme: "dark",
  storageKey: "savecloud-web-theme",
  enableSystem: true,
} as const;

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("No se encontró el elemento root en el DOM");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider {...THEME_CONFIG}>
      <HeroUIProvider>
        <App />
      </HeroUIProvider>
    </ThemeProvider>
  </React.StrictMode>
);
