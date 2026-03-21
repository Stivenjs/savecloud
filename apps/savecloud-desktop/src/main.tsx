import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeroUIProvider, ToastProvider } from "@heroui/react";
import App from "./App";
import "./index.css";

window.addEventListener("error", (e) => {
  const message = e.error?.stack || e.message || "Unknown error";
  console.error("Global error:", message);

  document.body.innerHTML = `
    <pre style="color:red; padding:20px; white-space:pre-wrap;">
${message}
    </pre>
  `;
});

window.addEventListener("unhandledrejection", (e) => {
  const message = (e.reason && (e.reason.stack || e.reason.message)) || JSON.stringify(e.reason);

  console.error("Unhandled promise rejection:", message);

  document.body.innerHTML = `
    <pre style="color:red; padding:20px; white-space:pre-wrap;">
${message}
    </pre>
  `;
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" storageKey="savecloud-theme" enableSystem>
      <HeroUIProvider>
        <ToastProvider toastOffset={40} placement="top-right" toastProps={{ timeout: 3000 }} />
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </HeroUIProvider>
    </ThemeProvider>
  </React.StrictMode>
);
