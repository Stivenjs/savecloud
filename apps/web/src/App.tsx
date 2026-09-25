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
    <div className="relative min-h-dvh bg-background text-foreground overflow-x-hidden selection:bg-primary/30 selection:text-indigo-200">
      {/* Background ambient SaveCloud indigo lighting */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {/* Top-right SaveCloud Primary Glow (#4f46e5) */}
        <div className="absolute -top-32 -right-32 h-150 w-150 rounded-full bg-primary/12 blur-[130px]" />
        {/* Mid-left SaveCloud Indigo Glow (#6366f1) */}
        <div className="absolute top-[30%] -left-32 h-125 w-125 rounded-full bg-[#6366f1]/8 blur-[140px]" />
        {/* Lower-right SaveCloud Blue Accent Glow (#4338ca) */}
        <div className="absolute top-[65%] right-10 h-137.5 w-137.5 rounded-full bg-[#4338ca]/8 blur-[160px]" />
        {/* Subtle Architectural Grid Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-size-[4rem_4rem] mask-[radial-gradient(ellipse_75%_60%_at_50%_0%,#000_65%,transparent_100%)]" />
      </div>

      {/* Page Content */}
      <div className="relative z-10 min-h-dvh">{children}</div>
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
