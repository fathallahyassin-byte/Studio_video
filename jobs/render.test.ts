import { describe, expect, it } from "vitest";
import { makeAssets, makeContext, makeTimeline, makeVideo, MUSIC_URL } from "@/agents/07-monteur/fixtures";
import { normalizeTimeline } from "@/agents/07-monteur/rules";
import type { Stage } from "@/lib/generated/prisma/client";
import type { RenderProvider, RenderRequest } from "@/lib/providers/render";
import { RENDER_NOT_CONFIGURED, renderKey, renderRefusal, runRenderJob, TIMELINE_UNREADABLE, type RenderPorts, type RenderRecord } from "./render";

const timeline = normalizeTimeline(makeTimeline(), makeContext());
const job = { id: "job-1", videoId: "video-1", transitionId: "tr-9", attempts: 1 };

function makeRenderer(): RenderProvider & { requests: RenderRequest[] } {
  const requests: RenderRequest[] = [];
  return {
    name: "faux-rendu",
    requests,
    async render(request) {
      requests.push(request);
      return { url: `https://media.test/${request.outputKey}`, durationS: 12.2, cost: 0 };
    },
  };
}

function makeRenderPorts(options: { stage?: Stage; timeline?: unknown; music?: string[]; existing?: boolean; failComplete?: boolean } = {}) {
  const state = { stage: options.stage ?? "RENDER", records: [] as RenderRecord[], blocked: [] as string[], completed: 0 };
  const ports: RenderPorts = {
    loadVideo: async () => ({ stage: state.stage, timeline: "timeline" in options ? options.timeline : timeline }),
    licensedMusicUrls: async () => options.music ?? [MUSIC_URL],
    findRender: async (key) => (options.existing || state.records.some((record) => record.generationKey === key) ? { url: "https://media.test/deja.mp4" } : null),
    async recordRender(_videoId, record) {
      state.records.push(record);
    },
    async completeRender() {
      if (options.failComplete) {
        state.stage = "REJECTED";
        throw new Error("La vidéo a changé d'étape entre-temps");
      }
      state.completed += 1;
      state.stage = "QA";
    },
    async blockVideo(_videoId, reason) {
      state.blocked.push(reason);
      state.stage = "NEEDS_FIX";
    },
  };
  return { ports, state };
}

describe("tâche RENDER", () => {
  it("rend la timeline telle quelle, enregistre l'Asset RENDER et passe au contrôle qualité", async () => {
    const renderer = makeRenderer();
    const { ports, state } = makeRenderPorts();
    expect(await runRenderJob(job, ports, renderer)).toEqual({ kind: "done" });
    expect(renderer.requests).toEqual([{ compositionId: "Montage", inputProps: timeline, outputKey: "rendus/video-1/video-1-render-tr-9.mp4" }]);
    expect(state.records).toEqual([{ url: "https://media.test/rendus/video-1/video-1-render-tr-9.mp4", durationS: 12.2, cost: 0, provider: "faux-rendu", generationKey: "video-1:render:tr-9" }]);
    expect(state).toMatchObject({ completed: 1, stage: "QA" });
  });

  it("idempotente : un rendu déjà enregistré pour ce passage n'est pas refait", async () => {
    const renderer = makeRenderer();
    const { ports, state } = makeRenderPorts({ existing: true });
    await runRenderJob(job, ports, renderer);
    expect(renderer.requests).toEqual([]);
    expect(state.completed).toBe(1);
  });

  it("vidéo qui n'est plus au rendu : ignorée", async () => {
    const renderer = makeRenderer();
    expect(await runRenderJob(job, makeRenderPorts({ stage: "QA" }).ports, renderer)).toMatchObject({ kind: "done", note: expect.stringContaining("Ignorée") });
    expect(renderer.requests).toEqual([]);
  });

  it("refus avant tout rendu : timeline illisible, plan manquant, musique sans licence (la vidéo est bloquée)", async () => {
    const renderer = makeRenderer();
    const unreadable = makeRenderPorts({ timeline: { pistes: 1 } });
    await runRenderJob(job, unreadable.ports, renderer);
    expect(unreadable.state.blocked).toEqual([TIMELINE_UNREADABLE]);

    const missing = normalizeTimeline(makeTimeline(), makeContext(makeVideo(), makeAssets().filter((asset) => asset.planId !== "P03")));
    expect(renderRefusal(missing, [MUSIC_URL])).toBe("Rendu refusé : média manquant pour P03.");
    expect(renderRefusal(timeline, [])).toBe("Rendu refusé : la musique de la timeline n'a pas de licence enregistrée.");
    const unlicensed = makeRenderPorts({ music: [] });
    await runRenderJob(job, unlicensed.ports, renderer);
    expect(unlicensed.state.blocked).toHaveLength(1);
    expect(renderer.requests).toEqual([]);
  });

  it("sans stockage configuré : la tâche attend, avec une alerte à la première prise", async () => {
    expect(await runRenderJob(job, makeRenderPorts().ports, null)).toEqual({ kind: "retry", delayMs: 3_600_000, reason: RENDER_NOT_CONFIGURED, alert: true });
    expect(await runRenderJob({ ...job, attempts: 2 }, makeRenderPorts().ports, null)).toMatchObject({ alert: false });
  });

  it("vidéo abandonnée pendant le rendu : le MP4 reste enregistré, sans erreur", async () => {
    const { ports, state } = makeRenderPorts({ failComplete: true });
    await expect(runRenderJob(job, ports, makeRenderer())).resolves.toEqual({ kind: "done" });
    expect(state.records).toHaveLength(1);
  });

  it("tâche sans vidéo ou vidéo introuvable : échec", async () => {
    expect(await runRenderJob({ ...job, videoId: null }, makeRenderPorts().ports, null)).toMatchObject({ kind: "failed" });
    const gone = makeRenderPorts();
    gone.ports.loadVideo = async () => null;
    expect(await runRenderJob(job, gone.ports, null)).toMatchObject({ kind: "failed", reason: "Vidéo introuvable." });
  });

  it("clé du rendu : par vidéo et par passage au rendu (une relance manuelle garde la même)", () => {
    expect(renderKey({ ...job, videoId: "v" })).toBe("v:render:tr-9");
    expect(renderKey({ ...job, videoId: "v", transitionId: null })).toBe("v:render:job-1");
  });
});
