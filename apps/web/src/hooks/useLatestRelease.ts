import { useState, useEffect } from "react";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface ReleaseData {
  tag_name: string;
  assets: ReleaseAsset[];
}

export interface LatestRelease {
  version: string;
  windowsExeUrl: string;
  windowsMsiUrl: string;
  linuxDebUrl: string;
  linuxAppImageUrl: string;
  macOSDmgUrl: string;
  loading: boolean;
  error: string | null;
}

const REPO = "https://github.com/Stivenjs/savecloud";
const RELEASES_PAGE = `${REPO}/releases`;

export function useLatestRelease(): LatestRelease {
  const [data, setData] = useState<LatestRelease>({
    version: "",
    windowsExeUrl: "",
    windowsMsiUrl: "",
    linuxDebUrl: "",
    linuxAppImageUrl: "",
    macOSDmgUrl: "",
    loading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;

    async function fetchRelease() {
      try {
        const res = await fetch("https://api.github.com/repos/Stivenjs/savecloud/releases/latest");
        if (!res.ok) {
          throw new Error(`Error HTTP: ${res.status}`);
        }
        const json = (await res.json()) as ReleaseData;
        if (!active) return;

        const tag = json.tag_name;
        if (!tag) {
          throw new Error("No tag_name found in release data");
        }
        const assets = json.assets || [];

        const winExe = assets.find((a) => a.name.endsWith("-setup.exe")) || assets.find((a) => a.name.endsWith(".exe"));
        const winMsi = assets.find((a) => a.name.endsWith(".msi"));
        const linDeb = assets.find((a) => a.name.endsWith(".deb"));
        const linAppImage = assets.find((a) => a.name.endsWith(".AppImage"));
        const macDmg = assets.find((a) => a.name.endsWith(".dmg"));

        setData({
          version: tag,
          windowsExeUrl: winExe
            ? winExe.browser_download_url
            : `${RELEASES_PAGE}/download/${tag}/SaveCloud_${tag.replace("v", "")}_x64-setup.exe`,
          windowsMsiUrl: winMsi
            ? winMsi.browser_download_url
            : `${RELEASES_PAGE}/download/${tag}/SaveCloud_${tag.replace("v", "")}_x64_en-US.msi`,
          linuxDebUrl: linDeb
            ? linDeb.browser_download_url
            : `${RELEASES_PAGE}/download/${tag}/SaveCloud_${tag.replace("v", "")}_amd64.deb`,
          linuxAppImageUrl: linAppImage
            ? linAppImage.browser_download_url
            : `${RELEASES_PAGE}/download/${tag}/SaveCloud_${tag.replace("v", "")}_amd64.AppImage`,
          macOSDmgUrl: macDmg
            ? macDmg.browser_download_url
            : `${RELEASES_PAGE}/download/${tag}/SaveCloud_${tag.replace("v", "")}_universal.dmg`,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (!active) return;
        console.error("Error al obtener la versión de lanzamiento de GitHub:", err);
        setData((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    }

    fetchRelease();
    return () => {
      active = false;
    };
  }, []);

  return data;
}
