import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { RenderProvider } from "@/lib/providers/render";
import { getStorageProvider } from "@/lib/providers/s3";
import type { StorageProvider } from "@/lib/providers/storage";

// Rendu Remotion sur la machine du worker (docs/decisions.md, 2026-11-23). Worker uniquement : jamais
// importé par l'appli Next (Chromium, ffmpeg et webpack). Au premier rendu, Remotion télécharge son Chromium.

export type LocalRendererOptions = {
  storage: StorageProvider;
  /** point d'entrée du bundle (remotion/index.ts) */
  entryPoint?: string;
  /** images rendues en parallèle ; null = choix de Remotion (moitié des cœurs) */
  concurrency?: number | null;
  /** clé de licence Remotion (entreprise) ; null pour un usage individuel */
  licenseKey?: string | null;
};

const DEFAULT_ENTRY = path.join(process.cwd(), "remotion", "index.ts");

export function createLocalRemotionRenderer(options: LocalRendererOptions): RenderProvider {
  let serveUrl: Promise<string> | null = null;
  // Le bundle est construit une fois par processus ; un échec est oublié pour être retenté au rendu suivant.
  const getServeUrl = () => {
    serveUrl ??= bundle({ entryPoint: options.entryPoint ?? DEFAULT_ENTRY }).catch((error: unknown) => {
      serveUrl = null;
      throw error;
    });
    return serveUrl;
  };

  return {
    name: "remotion-local",
    async render({ compositionId, inputProps, outputKey }) {
      const url = await getServeUrl();
      const composition = await selectComposition({ serveUrl: url, id: compositionId, inputProps });
      const dir = await mkdtemp(path.join(tmpdir(), "studio-render-"));
      const outputLocation = path.join(dir, "rendu.mp4");
      try {
        await renderMedia({
          serveUrl: url,
          composition,
          inputProps,
          codec: "h264",
          audioCodec: "aac",
          sampleRate: 48000,
          outputLocation,
          concurrency: options.concurrency ?? null,
          licenseKey: options.licenseKey ?? null,
        });
        const stored = await options.storage.putFile({ key: outputKey, filePath: outputLocation, contentType: "video/mp4" });
        return { url: stored.url, durationS: composition.durationInFrames / composition.fps, cost: 0 };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

function readConcurrency(raw: string | undefined): number | null {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** null tant que le stockage n'est pas configuré : le MP4 n'aurait nulle part où aller. */
export function getRenderProvider(env: Record<string, string | undefined> = process.env): RenderProvider | null {
  const storage = getStorageProvider(env);
  if (!storage) return null;
  return createLocalRemotionRenderer({ storage, concurrency: readConcurrency(env.RENDER_CONCURRENCY), licenseKey: env.REMOTION_LICENSE_KEY?.trim() || null });
}
