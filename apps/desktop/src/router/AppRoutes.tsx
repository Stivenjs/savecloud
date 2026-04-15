import { Suspense } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatedPage } from "@components/navigation/AnimatedPage";
import { PageLoader } from "@components/ui/PageLoader";
import { routeConfig } from "@router/routeConfig";

export function AppRoutes() {
  const location = useLocation();

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes key={location.pathname}>
        {routeConfig.map(({ path, element }) => (
          <Route key={path} path={path} element={<AnimatedPage>{element}</AnimatedPage>} />
        ))}
      </Routes>
    </Suspense>
  );
}
