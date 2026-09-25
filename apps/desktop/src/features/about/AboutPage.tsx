import { useNavigationStore } from "@features/input/store";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { Github, ArrowUpRight, ShoppingBag, Download, Flame } from "lucide-react";
import { Button, Link } from "@heroui/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Trans, useTranslation } from "react-i18next";

const FEATURE_KEYS = ["01", "02", "03", "04"] as const;
const STORE_KEYS = ["01", "02", "03", "04"] as const;
const BENEFIT_KEYS = ["01", "02", "03", "04", "05"] as const;
const SECURITY_KEYS = ["files", "encrypted", "telemetry", "auditable"] as const;
const DEPLOY_STEP_KEYS = ["clone", "run"] as const;

export function AboutPage() {
  const { t } = useTranslation();
  const popLayer = useNavigationStore((s) => s.popLayer);

  useRegisterGlobalBack(() => {
    popLayer();
    return true;
  });

  return (
    <div className="w-full">
      <section className="border-b border-divider py-16 px-6 md:px-12">
        <p className="text-xs uppercase tracking-widest text-default-400 mb-4 font-medium">{t("about.heroTagline")}</p>
        <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6 max-w-3xl">SaveCloud</h1>
        <p className="text-lg md:text-xl text-default-500 max-w-xl leading-relaxed">{t("about.heroSubtitle")}</p>
      </section>

      <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
        <div>
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium">{t("about.whatIsLabel")}</p>
        </div>
        <div>
          <p className="text-base md:text-lg text-default-600 leading-relaxed mb-4">
            <Trans
              i18nKey="about.whatIsP1"
              components={{ strong: <span className="text-foreground font-semibold" /> }}
            />
          </p>
          <p className="text-base md:text-lg text-default-600 leading-relaxed">
            <Trans
              i18nKey="about.whatIsP2"
              components={{ strong: <span className="text-foreground font-semibold" /> }}
            />
          </p>
        </div>
      </section>

      <section className="border-b border-divider py-14 px-6 md:px-12">
        <div className="grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start mb-10">
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium">{t("about.featuresLabel")}</p>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-divider border border-divider rounded-xl overflow-hidden">
          {FEATURE_KEYS.map((key) => (
            <div key={key} className="p-6 md:p-8">
              <p className="text-xs text-default-300 font-mono mb-4">{key}</p>
              <h3 className="text-sm font-semibold mb-2">{t(`about.features.${key}.title`)}</h3>
              <p className="text-xs text-default-500 leading-relaxed">{t(`about.features.${key}.description`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-divider py-14 px-6 md:px-12">
        <div className="grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start mb-10">
          <div>
            <p className="text-xs uppercase tracking-widest text-default-400 font-medium mb-3">
              {t("about.storeLabel")}
            </p>
            <div className="flex items-center gap-2 text-default-400">
              <ShoppingBag className="w-4 h-4" />
              <Download className="w-4 h-4" />
            </div>
          </div>
          <div>
            <h2 className="text-2xl md:text-3xl font-bold mb-2">{t("about.storeTitle")}</h2>
            <p className="text-default-500 text-sm md:text-base leading-relaxed max-w-lg">{t("about.storeDesc")}</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-divider border border-divider rounded-xl overflow-hidden">
          {STORE_KEYS.map((key) => (
            <div key={key} className="p-6 md:p-8">
              <p className="text-xs text-default-300 font-mono mb-4">{key}</p>
              <h3 className="text-sm font-semibold mb-2">{t(`about.storeHighlights.${key}.title`)}</h3>
              <p className="text-xs text-default-500 leading-relaxed">
                {t(`about.storeHighlights.${key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
        <div>
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium">
            {t("about.inspirationLabel")}
          </p>
        </div>
        <div>
          <div className="flex items-center gap-3 mb-4">
            <Flame className="w-5 h-5 text-default-400" />
            <h2 className="text-2xl md:text-3xl font-bold">{t("about.inspirationTitle")}</h2>
          </div>
          <p className="text-default-500 leading-relaxed text-sm md:text-base max-w-lg mb-4">
            <Trans
              i18nKey="about.inspirationP1"
              components={{ strong: <span className="text-foreground font-semibold" /> }}
            />
          </p>
          <p className="text-default-500 leading-relaxed text-sm md:text-base max-w-lg">{t("about.inspirationP2")}</p>
        </div>
      </section>

      <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
        <div>
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium">{t("about.deployLabel")}</p>
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-bold mb-2">{t("about.deployTitle")}</h2>
          <p className="text-default-500 mb-8 text-sm">{t("about.deploySubtitle")}</p>
          <div className="space-y-3">
            {DEPLOY_STEP_KEYS.map((key, i) => (
              <div
                key={key}
                className="flex items-center gap-4 bg-default-100 rounded-lg px-5 py-4 border border-default-200">
                <span className="text-xs text-default-400 font-mono shrink-0 w-4">{i + 1}</span>
                <code className="text-sm font-mono text-foreground flex-1 overflow-x-auto">
                  $ {t(`about.deploySteps.${key}.cmd`)}
                </code>
                <span className="text-xs text-default-400 hidden md:block">{t(`about.deploySteps.${key}.label`)}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-default-400 mt-4">{t("about.deployHint")}</p>
        </div>
      </section>

      <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
        <div>
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium">{t("about.selfHostedLabel")}</p>
        </div>
        <div className="space-y-4">
          {BENEFIT_KEYS.map((key, i) => (
            <div key={key} className="flex items-start gap-3 py-3 border-b border-divider last:border-0">
              <span className="text-xs font-mono text-default-300 mt-0.5">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-sm md:text-base text-default-700">{t(`about.benefits.${key}`)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-divider py-14 px-6 md:px-12 grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start">
        <div>
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium">{t("about.shareLabel")}</p>
        </div>
        <div>
          <h2 className="text-2xl md:text-3xl font-bold mb-4">{t("about.shareTitle")}</h2>
          <p className="text-default-500 leading-relaxed text-sm md:text-base max-w-lg">{t("about.shareDesc")}</p>
        </div>
      </section>

      <section className="border-b border-divider py-14 px-6 md:px-12">
        <div className="grid md:grid-cols-[1fr_2fr] gap-8 md:gap-16 items-start mb-10">
          <p className="text-xs uppercase tracking-widest text-default-400 font-medium">{t("about.securityLabel")}</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-px bg-divider border border-divider rounded-xl overflow-hidden">
          {SECURITY_KEYS.map((key) => (
            <div key={key} className="bg-background px-7 py-6">
              <h3 className="text-sm font-semibold mb-1">{t(`about.security.${key}.title`)}</h3>
              <p className="text-xs text-default-500">{t(`about.security.${key}.desc`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-16 px-6 md:px-12 flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div>
          <h2 className="text-3xl md:text-5xl font-bold mb-3">{t("about.ctaTitle")}</h2>
          <p className="text-default-500 text-sm md:text-base max-w-md">{t("about.ctaDesc")}</p>
        </div>
        <div className="flex gap-3 shrink-0">
          <Button
            as={Link}
            href="https://github.com/Stivenjs/savecloud"
            target="_blank"
            rel="noopener noreferrer"
            color="primary"
            size="lg"
            onPress={async () => {
              await openUrl("https://github.com/Stivenjs/savecloud");
            }}
            startContent={<Github className="w-4 h-4" />}
            endContent={<ArrowUpRight className="w-4 h-4" />}>
            {t("about.githubButton")}
          </Button>
        </div>
      </section>

      <div className="border-t border-divider px-6 md:px-12 py-6 flex items-center justify-between">
        <span className="text-xs text-default-400 font-medium">SaveCloud</span>
        <span className="text-xs text-default-300">{t("about.footerTagline")}</span>
      </div>
    </div>
  );
}
