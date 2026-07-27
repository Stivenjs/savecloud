import React from "react";
import Hero from "@/components/sections/Hero";
import WhatIs from "@/components/sections/WhatIs";
import Features from "@/components/sections/Features";
import PrivacySection from "@/components/sections/PrivacySection";
import Deploy from "@/components/sections/Deploy";
import Downloads from "@/components/sections/Downloads";
import Store from "@/components/sections/Store";
import Share from "@/components/sections/Share";
import WhySelfHosted from "@/components/sections/WhySelfHosted";
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
        <WhatIs />
        <Features />
        <PrivacySection />
        <Deploy />
        <Downloads />
        <Store />
        <Share />
        <WhySelfHosted />
        <Security />
        <CTA />
        <Footer />
      </div>
    </AppAmbientBackground>
  );
}
