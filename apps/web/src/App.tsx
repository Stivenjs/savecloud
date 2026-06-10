import React from "react";
import Hero from "@/components/sections/Hero";
import Downloads from "@/components/sections/Downloads";
import WhatIs from "@/components/sections/WhatIs";
import Features from "@/components/sections/Features";
import Store from "@/components/sections/Store";
import Inspiration from "@/components/sections/Inspiration";
import Deploy from "@/components/sections/Deploy";
import WhySelfHosted from "@/components/sections/WhySelfHosted";
import Share from "@/components/sections/Share";
import Security from "@/components/sections/Security";
import CTA from "@/components/sections/CTA";
import Footer from "@/components/sections/Footer";

function AppAmbientBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-dvh bg-background text-foreground overflow-x-hidden">
      <div className="absolute inset-0 bg-linear-to-br from-background via-default-50/55 to-default-100/80 dark:from-default-200/10 dark:via-default-100/5 dark:to-background" />
      <div className="absolute inset-0 backdrop-blur-sm" />
      <div className="relative min-h-dvh">{children}</div>
    </div>
  );
}

export default function App() {
  return (
    <AppAmbientBackground>
      <div className="w-full">
        <Hero />
        <Downloads />
        <WhatIs />
        <Features />
        <Store />
        <Inspiration />
        <Deploy />
        <WhySelfHosted />
        <Share />
        <Security />
        <CTA />
        <Footer />
      </div>
    </AppAmbientBackground>
  );
}
