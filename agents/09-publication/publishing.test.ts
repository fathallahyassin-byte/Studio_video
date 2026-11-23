import { describe, expect, it } from "vitest";
import { makeFakeProvider, makeOutput, makePublishingPorts, makeReport, makeStoredPublication, NOW } from "./fixtures";
import { markPublishedManually, NO_V3, runPublication } from "./publishing";

const HUMAN = { kind: "human", name: "moi" } as const;

describe("publication à l'heure prévue", () => {
  it("mode manuel (aucune API) : notification « à publier à la main » avec le lien, rien n'est publié", async () => {
    const fake = makePublishingPorts(makeStoredPublication());
    const outcome = await runPublication(fake.ports, "pub-tiktok");
    expect(outcome).toEqual({ kind: "done", note: "Publication manuelle : l'humain est prévenu." });
    expect(fake.calls.notifications).toEqual([
      expect.objectContaining({ kind: "validation_waiting", title: "À publier à la main : TikTok · V-007", path: "/agents/09-publication?video=video-1" }),
    ]);
    expect(fake.state?.status).toBe("SCHEDULED");
    expect(fake.calls.completed).toEqual([]);
  });

  it("mode API mais fournisseur pas prêt : repli en manuel", async () => {
    const provider = makeFakeProvider("TIKTOK", { ready: false });
    const fake = makePublishingPorts(makeStoredPublication({ mode: "API" }), provider);
    await runPublication(fake.ports, "pub-tiktok");
    expect(provider.requests).toEqual([]);
    expect(fake.calls.notifications).toHaveLength(1);
  });

  it("mode API et faux fournisseur prêt : publie avec les étiquettes du rapport qualité, puis la vidéo passe en PUBLISHED", async () => {
    const provider = makeFakeProvider("YOUTUBE");
    const publication = makeStoredPublication({ id: "pub-yt", platform: "YOUTUBE", mode: "API", aiLabel: false });
    const report = makeReport({ etiquettes: { ...makeReport().etiquettes, youtube_utilisation_ia: true } });
    const fake = makePublishingPorts({ ...publication, video: { ...publication.video, qaReport: report } }, provider);
    const outcome = await runPublication(fake.ports, "pub-yt");
    expect(outcome).toEqual({ kind: "done" });
    expect(provider.requests).toEqual([
      expect.objectContaining({ videoUrl: "https://media.example.org/rendus/video-1.mp4", title: makeOutput().youtube.titre, aiLabel: true, hashtags: makeOutput().youtube.hashtags }),
    ]);
    expect(fake.state?.status).toBe("PUBLISHED");
    expect(fake.calls.externalIds).toEqual(["ext-1"]);
    expect(fake.calls.completed).toEqual([{ kind: "system" }]);
  });

  it("aucune publication sans V3 approuvée : le fournisseur n'est jamais appelé", async () => {
    const provider = makeFakeProvider("TIKTOK");
    const fake = makePublishingPorts(makeStoredPublication({ mode: "API" }, { hasV3Approval: false }), provider);
    expect(await runPublication(fake.ports, "pub-tiktok")).toEqual({ kind: "failed", reason: NO_V3 });
    expect(provider.requests).toEqual([]);
    expect(fake.calls.notifications).toEqual([]);
  });

  it("créneau modifié depuis la création de la tâche : l'ancienne tâche ne fait rien", async () => {
    const fake = makePublishingPorts(makeStoredPublication());
    expect(await runPublication(fake.ports, "pub-tiktok", { slot: new Date(2026, 10, 20, 9, 0) })).toEqual({ kind: "done", note: "Créneau modifié : une autre tâche s'en charge." });
    expect(fake.calls.notifications).toEqual([]);
  });

  it("pas encore l'heure : la tâche est remise à plus tard", async () => {
    const fake = makePublishingPorts(makeStoredPublication({ scheduledFor: new Date(NOW.getTime() + 30 * 60_000) }));
    expect(await runPublication(fake.ports, "pub-tiktok")).toEqual({ kind: "retry", delayMs: 30 * 60_000, reason: "Pas encore l'heure prévue." });
  });

  it("rapport qualité illisible, textes illisibles, vidéo abandonnée : refusé", async () => {
    const reasons = await Promise.all([
      runPublication(makePublishingPorts(makeStoredPublication({}, { qaReport: null })).ports, "p"),
      runPublication(makePublishingPorts(makeStoredPublication({}, { texts: { tiktok: {} } })).ports, "p"),
      runPublication(makePublishingPorts(makeStoredPublication({}, { stage: "REJECTED" })).ports, "p"),
    ]);
    expect(reasons.map((outcome) => outcome.kind)).toEqual(["failed", "failed", "failed"]);
  });

  it("idempotent : déjà publiée = rien ; interrompue en cours d'envoi = jamais relancée seule", async () => {
    const provider = makeFakeProvider("TIKTOK");
    expect(await runPublication(makePublishingPorts(makeStoredPublication({ status: "PUBLISHED", mode: "API" }), provider).ports, "p")).toEqual({ kind: "done", note: "Déjà publiée." });
    const stuck = await runPublication(makePublishingPorts(makeStoredPublication({ status: "PUBLISHING", mode: "API" }), provider).ports, "p");
    expect(stuck).toMatchObject({ kind: "failed", reason: expect.stringContaining("vérifie sur la plateforme") });
    expect(provider.requests).toEqual([]);
  });

  it("erreur du fournisseur : publication en échec, à vérifier par l'humain (pas de nouvel envoi automatique)", async () => {
    const provider = makeFakeProvider("TIKTOK", { fail: true });
    const fake = makePublishingPorts(makeStoredPublication({ mode: "API" }), provider);
    const outcome = await runPublication(fake.ports, "pub-tiktok");
    expect(outcome).toMatchObject({ kind: "failed", reason: expect.stringContaining("quota dépassé") });
    expect(fake.state?.status).toBe("FAILED");
    expect(await runPublication(fake.ports, "pub-tiktok")).toEqual({ kind: "done", note: "En échec : à reprendre à la main." });
    expect(provider.requests).toHaveLength(1);
  });
});

describe("« Marquer comme publié »", () => {
  it("passe la publication et la vidéo en PUBLISHED, avec l'humain comme acteur", async () => {
    const fake = makePublishingPorts(makeStoredPublication());
    const result = await markPublishedManually(fake.ports, { publicationId: "pub-tiktok", link: "https://www.tiktok.com/@moi/video/1", actor: HUMAN });
    expect(result).toEqual({ ok: true, message: "TikTok : marquée comme publiée." });
    expect(fake.state?.status).toBe("PUBLISHED");
    expect(fake.calls.externalIds).toEqual(["https://www.tiktok.com/@moi/video/1"]);
    expect(fake.calls.completed).toEqual([HUMAN]);
  });

  it("refusé sans V3 approuvée", async () => {
    const fake = makePublishingPorts(makeStoredPublication({}, { hasV3Approval: false }));
    expect(await markPublishedManually(fake.ports, { publicationId: "pub-tiktok", link: null, actor: HUMAN })).toEqual({ ok: false, message: NO_V3 });
    expect(fake.state?.status).toBe("SCHEDULED");
    expect(fake.calls.completed).toEqual([]);
  });

  it("refusé pour une vidéo abandonnée ; sans effet si déjà publiée", async () => {
    expect(await markPublishedManually(makePublishingPorts(makeStoredPublication({}, { stage: "REJECTED" })).ports, { publicationId: "p", link: null, actor: HUMAN })).toMatchObject({ ok: false });
    const already = makePublishingPorts(makeStoredPublication({ status: "PUBLISHED" }));
    expect(await markPublishedManually(already.ports, { publicationId: "p", link: null, actor: HUMAN })).toEqual({ ok: true, message: "Déjà marquée comme publiée." });
    expect(already.calls.completed).toEqual([]);
  });

  it("deuxième plateforme d'une vidéo déjà publiée : la publication passe, la vidéo ne bouge plus", async () => {
    const fake = makePublishingPorts(makeStoredPublication({ platform: "INSTAGRAM" }, { stage: "PUBLISHED" }));
    expect(await markPublishedManually(fake.ports, { publicationId: "p", link: null, actor: HUMAN })).toMatchObject({ ok: true });
    expect(fake.state?.status).toBe("PUBLISHED");
    expect(fake.calls.completed).toEqual([]);
  });
});
