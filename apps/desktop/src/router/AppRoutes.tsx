import { Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { AnimatedPage } from "@components/navigation/AnimatedPage";
import { PageLoader } from "@components/ui/PageLoader";
import { routeConfig } from "@router/routeConfig";

export function AppRoutes() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {routeConfig.map(({ path, element }) => (
          <Route key={path} path={path} element={<AnimatedPage>{element}</AnimatedPage>} />
        ))}
      </Routes>
    </Suspense>
  );
}
