import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentJobInput } from "@/agents/_shared/types";
import { AgentPreconditionError } from "@/lib/agents/errors";
import { createMemoryRunStore } from "@/lib/agents/memoryStore";
import { runAgent } from "@/lib/agents/runAgent";
import type { LlmProvider, LlmRequest } from "@/lib/providers/llm";
import type { Notification } from "@/lib/providers/notify";
import { createPublicationDefinition, definition } from "./definition";
import { makeOutput, makePublicationPorts, makeReport, makeVideo, NOW, TEST_BIBLE } from "./fixtures";
import { recordPublicationPlan } from "./plan";
import type { PublicationVideo } from "./ports";
import { NO_ANALYST_SLOTS, NOTE_HEADING, NO_KEYWORDS } from "./variables";

const PROMPT = readFileSync(path.join(import.meta.dirname, "prompt.md"), "utf8");
const VIDEO_ID = "video-1";
const CHANNEL_ID = "chaine-1";

function makeLlm(answers: string[]): LlmProvider & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    name: "faux",
    requests,
    async complete(request) {
      requests.push(request);
      const text = answers.shift();
      if (text === undefined) throw new Error("plus de réponse prévue");
      return { text, inputTokens: 3000, outputTokens: 900, cost: 0.05 };
    },
  };
}

type SetupOptions = { video?: PublicationVideo | null; keywords?: string; note?: string | null };

function setup(answers: string[], options: SetupOptions = {}) {
  const fake = makePublicationPorts({ video: options.video, keywords: options.keywords });
  const publicationDefinition = createPublicationDefinition(() => fake.ports);
  const store = createMemoryRunStore();
  store.setAgent({ id: 9, slug: "09-publication", name: "Publication", model: "modele-test", active: true, promptVersion: { id: "pv-9", content: PROMPT } });
  store.setActiveBible(CHANNEL_ID, { id: "bible-1", content: TEST_BIBLE });
  const llm = makeLlm(answers);
  const sent: Notification[] = [];
  const notifier = { notify: async (notification: Notification) => void sent.push(notification) };
  const input: AgentJobInput = { jobId: "job-1", channelId: CHANNEL_ID, videoId: VIDEO_ID, note: options.note ?? null, payload: null };
  const run = () => runAgent({ definition: publicationDefinition, input, channelId: CHANNEL_ID, videoId: VIDEO_ID, jobKey: "transition-1:agent-9" }, { store, llm, notifier });
  return { ...fake, publicationDefinition, store, llm, sent, input, run };
}

const json = (value: unknown) => JSON.stringify(value);

describe("définition exportée", () => {
  it("reprend l'identité du catalogue", () => {
    expect(definition).toMatchObject({ id: 9, slug: "09-publication", name: "Publication", promptFile: "prompt.md" });
  });
});

describe("publication avec runAgent (faux LLM)", () => {
  it("sortie valide : variables remplies, AgentRun complet, 3 Publications SCHEDULED en mode manuel", async () => {
    const ctx = setup([json(makeOutput())]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "ok", attempt: 1 });
    const system = ctx.llm.requests[0]?.system ?? "";
    expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/);
    expect(system).toContain('niche: "objets du quotidien"');
    expect(ctx.store.runs).toHaveLength(1);
    expect(ctx.store.runs[0]).toMatchObject({
      status: "OK",
      agentId: 9,
      promptVersionId: "pv-9",
      bibleVersionId: "bible-1",
      inputTokens: 3000,
      outputTokens: 900,
      cost: 0.05,
      input: {
        SCRIPT: expect.stringContaining("trombone"),
        RAPPORT_QA: expect.stringContaining("tiktok_contenu_ia"),
        MOTS_CLES: "- trombone\n- histoire des objets",
        CRENEAUX: expect.stringContaining(NO_ANALYST_SLOTS),
      },
    });
    expect(ctx.store.runs[0]?.input).toMatchObject({ CRENEAUX: expect.stringContaining("Date et heure actuelles (heure locale de publication) : 2026-11-23T10:00.") });

    expect([...ctx.publications.keys()]).toEqual(["TIKTOK", "INSTAGRAM", "YOUTUBE"]);
    expect(ctx.publications.get("TIKTOK")).toMatchObject({ mode: "MANUAL", status: "SCHEDULED", aiLabel: true, brandedContent: false, scheduledFor: new Date(2026, 10, 24, 18, 0) });
    expect(ctx.publications.get("YOUTUBE")).toMatchObject({ aiLabel: false });
    expect(ctx.calls.saves[0]?.texts).toEqual(makeOutput());
  });

  it("sortie invalide trois fois : 3 AgentRun, vidéo en NEEDS_FIX, aucune Publication", async () => {
    const tooShort = makeOutput({ tiktok: { ...makeOutput().tiktok, legende: "Trop court." } });
    const ctx = setup(["pas du JSON", json({ ...makeOutput(), tiktok: { ...makeOutput().tiktok, hashtags: ["#un"] } }), json(tooShort)]);
    const result = await ctx.run();

    expect(result).toMatchObject({ status: "needs_fix", attempts: 3 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["INVALID_JSON", "INVALID_JSON", "CONTROL_FAILED"]);
    expect(ctx.store.runs[2]?.error).toContain("tiktok.legende : 150 à 300 caractères");
    expect(ctx.store.needsFix.get(VIDEO_ID)).toContain("Publication");
    expect(ctx.sent).toEqual([expect.objectContaining({ kind: "agent_failed" })]);
    expect(ctx.publications.size).toBe(0);
  });

  it("un contrôle refusé est renvoyé au modèle, puis la correction est acceptée", async () => {
    const sameTexts = makeOutput({ instagram: { ...makeOutput().instagram, legende: makeOutput().tiktok.legende } });
    const ctx = setup([json(sameTexts), json(makeOutput())]);
    const result = await ctx.run();
    expect(result).toMatchObject({ status: "ok", attempt: 2 });
    expect(ctx.store.runs.map((run) => run.status)).toEqual(["CONTROL_FAILED", "OK"]);
    expect(ctx.llm.requests[1]?.messages.at(-1)?.content).toContain("ont le même texte");
  });

  it("étiquettes IA : le modèle ne peut pas les changer, celles du rapport qualité sont enregistrées", async () => {
    const lowered = makeOutput({
      tiktok: { ...makeOutput().tiktok, etiquette_ia: false, contenu_de_marque: true },
      instagram: { ...makeOutput().instagram, etiquette_ia: false },
      youtube: { ...makeOutput().youtube, contient_media_synthetique: true },
    });
    const ctx = setup([json(lowered)]);
    await ctx.run();
    const saved = ctx.calls.saves[0]?.texts;
    expect(saved?.tiktok).toMatchObject({ etiquette_ia: true, contenu_de_marque: false });
    expect(saved?.instagram.etiquette_ia).toBe(true);
    expect(saved?.youtube.contient_media_synthetique).toBe(false);
    expect(ctx.store.runs[0]?.output).toMatchObject({ tiktok: { etiquette_ia: true } });
    expect(ctx.publications.get("INSTAGRAM")?.aiLabel).toBe(true);
  });

  it("note de l'humain : ajoutée à {{CRENEAUX}} sous un intitulé explicite ; liste de mots-clés vide dite clairement", async () => {
    const ctx = setup([json(makeOutput())], { note: "Publie plutôt en fin de journée.", keywords: "  \n" });
    await ctx.run();
    const input = ctx.store.runs[0]?.input;
    expect(input?.CRENEAUX).toContain(`${NOTE_HEADING} :\nPublie plutôt en fin de journée.`);
    expect(input?.MOTS_CLES).toBe(NO_KEYWORDS);
  });
});

describe("préconditions : aucun appel au modèle", () => {
  const cases: { name: string; video: PublicationVideo | null; message: RegExp }[] = [
    { name: "vidéo introuvable", video: null, message: /introuvable/ },
    { name: "sans V3 approuvée", video: makeVideo({ hasV3Approval: false }), message: /validation V3 approuvée/ },
    { name: "sans script", video: makeVideo({ script: null }), message: /pas de script/ },
    { name: "script illisible", video: makeVideo({ script: { beats: "?" } }), message: /script de la vidéo est illisible/ },
    { name: "sans rapport qualité", video: makeVideo({ qaReport: null }), message: /pas de rapport qualité/ },
    { name: "rapport qualité illisible", video: makeVideo({ qaReport: { decision: "GO" } }), message: /rapport qualité de la vidéo est illisible/ },
  ];

  it.each(cases)("$name", async ({ video, message }) => {
    const ctx = setup([json(makeOutput())], { video });
    const error = await ctx.run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AgentPreconditionError);
    expect(String(error)).toMatch(message);
    expect(ctx.llm.requests).toHaveLength(0);
    expect(ctx.store.runs).toHaveLength(0);
    expect(ctx.publications.size).toBe(0);
  });
});

describe("onSuccess (recordPublicationPlan)", () => {
  it("aucune Publication sans Validation V3 approuvée, refusé en code avant la base", async () => {
    const fake = makePublicationPorts({ video: makeVideo({ hasV3Approval: false }) });
    await expect(recordPublicationPlan(fake.ports, VIDEO_ID, makeOutput())).rejects.toThrow("validation V3 approuvée");
    expect(fake.calls.saves).toHaveLength(0);
    expect(fake.publications.size).toBe(0);
  });

  it("rapport qualité devenu illisible : refusé, rien n'est enregistré", async () => {
    const fake = makePublicationPorts({ video: makeVideo({ qaReport: null }) });
    await expect(recordPublicationPlan(fake.ports, VIDEO_ID, makeOutput())).rejects.toThrow(AgentPreconditionError);
    expect(fake.publications.size).toBe(0);
  });

  it("idempotent : rejoué après un crash, aucun doublon et les mêmes lignes", async () => {
    const fake = makePublicationPorts();
    await recordPublicationPlan(fake.ports, VIDEO_ID, makeOutput());
    const first = new Map(fake.publications);
    await recordPublicationPlan(fake.ports, VIDEO_ID, makeOutput());
    expect(fake.publications.size).toBe(3);
    expect(fake.publications).toEqual(first);
  });

  it("rejoué via runAgent (onSuccess pas terminé) : pas de second appel au modèle, pas de doublon", async () => {
    const ctx = setup([json(makeOutput())]);
    await ctx.run();
    const run = ctx.store.runs[0];
    if (run) run.successHandledAt = null;
    const again = await ctx.run();
    expect(again).toMatchObject({ status: "ok", reused: true });
    expect(ctx.llm.requests).toHaveLength(1);
    expect(ctx.calls.saves).toHaveLength(2);
    expect(ctx.publications.size).toBe(3);
  });

  it("une Publication déjà publiée n'est jamais modifiée par une reprise", async () => {
    const fake = makePublicationPorts();
    await recordPublicationPlan(fake.ports, VIDEO_ID, makeOutput());
    const tiktok = fake.publications.get("TIKTOK");
    if (tiktok) fake.publications.set("TIKTOK", { ...tiktok, status: "PUBLISHED" });
    await recordPublicationPlan(fake.ports, VIDEO_ID, makeOutput({ tiktok: { ...makeOutput().tiktok, creneau: "2026-11-26T09:00" } }));
    expect(fake.publications.get("TIKTOK")).toMatchObject({ status: "PUBLISHED", scheduledFor: new Date(2026, 10, 24, 18, 0) });
  });

  it("vidéo qui n'est plus programmée (abandonnée, déjà publiée) : rien à faire", async () => {
    for (const stage of ["REJECTED", "PUBLISHED", "NEEDS_FIX"] as const) {
      const fake = makePublicationPorts({ video: makeVideo({ stage }) });
      await recordPublicationPlan(fake.ports, VIDEO_ID, makeOutput());
      expect(fake.calls.saves).toHaveLength(0);
    }
  });

  it("plateformes de la chaîne : seulement celles réglées ; mode API seulement si le fournisseur est prêt", async () => {
    const fake = makePublicationPorts({ video: makeVideo({ channelPlatforms: ["YOUTUBE", "TIKTOK"] }), ready: ["YOUTUBE"] });
    await recordPublicationPlan(fake.ports, VIDEO_ID, makeOutput());
    expect([...fake.publications.keys()]).toEqual(["TIKTOK", "YOUTUBE"]);
    expect(fake.publications.get("TIKTOK")?.mode).toBe("MANUAL");
    expect(fake.publications.get("YOUTUBE")?.mode).toBe("API");
  });

  it("contenu de marque : repris du rapport qualité pour les trois plateformes", async () => {
    const report = makeReport({ etiquettes: { tiktok_contenu_ia: true, instagram_contenu_ia: true, youtube_utilisation_ia: true, contenu_de_marque: true } });
    const fake = makePublicationPorts({ video: makeVideo({ qaReport: report }) });
    await recordPublicationPlan(fake.ports, VIDEO_ID, makeOutput());
    expect([...fake.publications.values()].map((row) => [row.aiLabel, row.brandedContent])).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
    expect(fake.calls.saves[0]?.texts.instagram.partenariat).toBe(true);
  });

  it("NOW de référence des fixtures", () => {
    expect(NOW.getDay()).toBe(1);
  });
});
