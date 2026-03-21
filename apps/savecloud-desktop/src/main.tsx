import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeroUIProvider, ToastProvider } from "@heroui/react";
import { AppErrorBoundary } from "@components/error/AppErrorBoundary";
import App from "./App";
import "./index.css";

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
          <AppErrorBoundary>
            <App />
          </AppErrorBoundary>
        </QueryClientProvider>
      </HeroUIProvider>
    </ThemeProvider>
  </React.StrictMode>
);
