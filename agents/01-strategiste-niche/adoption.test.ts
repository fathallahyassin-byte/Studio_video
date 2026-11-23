import { describe, expect, it } from "vitest";
import { adoptDraft } from "./adoption";
import { BIBLE_TEMPLATE, fillTemplate, PAYLOAD } from "./fixtures";
import { launchStrategy, strategyJobKey } from "./launch";
import { createWorld, fakeAdoptionPorts, fakeLaunchPorts, snapshotVersions } from "./testing";

const CHANNEL_ID = "chaine-1";

function worldWithDraft() {
  return createWorld([
    { content: fillTemplate({ NOM: "Ancienne" }), author: "HUMAN", active: true },
    { content: fillTemplate(), author: "AGENT_1" },
  ]);
}

describe("Adopter cette bible", () => {
  it("rend le brouillon actif sans modifier ni créer de BibleVersion", async () => {
    const world = worldWithDraft();
    const before = snapshotVersions(world);
    const result = await adoptDraft(fakeAdoptionPorts(world), { channelId: CHANNEL_ID, versionId: "bible-2" });
    expect(result).toEqual({ ok: true, changed: true, message: expect.stringContaining("Bible v2 adoptée") });
    expect(world.activeBibleId).toBe("bible-2");
    expect(snapshotVersions(world)).toBe(before);
  });

  it("est idempotente : un second clic ne réécrit rien", async () => {
    const world = worldWithDraft();
    const ports = fakeAdoptionPorts(world);
    await adoptDraft(ports, { channelId: CHANNEL_ID, versionId: "bible-2" });
    const again = await adoptDraft(ports, { channelId: CHANNEL_ID, versionId: "bible-2" });
    expect(again).toEqual({ ok: true, changed: false, message: "La bible v2 est déjà active." });
    expect(world.writes.activate).toBe(1);
  });

  it("refuse une version introuvable ou d'une autre chaîne", async () => {
    const world = worldWithDraft();
    expect(await adoptDraft(fakeAdoptionPorts(world), { channelId: CHANNEL_ID, versionId: "inconnue" })).toMatchObject({ ok: false, changed: false });
    expect(await adoptDraft(fakeAdoptionPorts(world), { channelId: "autre", versionId: "bible-2" })).toMatchObject({ ok: false });
    expect(world.activeBibleId).toBe("bible-1");
  });

  it("refuse une version qui ne vient pas du stratège", async () => {
    const world = createWorld([
      { content: fillTemplate(), author: "AGENT_1", active: true },
      { content: fillTemplate({ NOM: "Humaine" }), author: "HUMAN" },
    ]);
    const result = await adoptDraft(fakeAdoptionPorts(world), { channelId: CHANNEL_ID, versionId: "bible-2" });
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("écran Bible") });
    expect(world.writes.activate).toBe(0);
  });

  it("refuse une bible illisible ou avec des champs du modèle à remplir", async () => {
    const world = createWorld([
      { content: "chaine: [", author: "AGENT_1" },
      { content: BIBLE_TEMPLATE, author: "AGENT_1" },
    ]);
    const ports = fakeAdoptionPorts(world);
    expect(await adoptDraft(ports, { channelId: CHANNEL_ID, versionId: "bible-1" })).toMatchObject({ ok: false, message: expect.stringContaining("YAML invalide") });
    expect(await adoptDraft(ports, { channelId: CHANNEL_ID, versionId: "bible-2" })).toMatchObject({ ok: false, message: expect.stringContaining("{{NOM}}") });
    expect(world.activeBibleId).toBeNull();
  });
});

describe("lancement depuis la page", () => {
  const now = new Date("2026-11-23T09:00:00Z");

  it("met une tâche de l'agent 1 en file avec le formulaire en payload", async () => {
    const world = createWorld();
    const result = await launchStrategy(fakeLaunchPorts(world), { channelId: CHANNEL_ID, payload: PAYLOAD, now });
    expect(result.ok).toBe(true);
    expect(world.jobs).toEqual([{ jobKey: strategyJobKey(CHANNEL_ID, PAYLOAD, now), channelId: CHANNEL_ID, payload: PAYLOAD, status: "QUEUED" }]);
  });

  it("double envoi du même formulaire le même jour : une seule tâche", async () => {
    const world = createWorld();
    const ports = fakeLaunchPorts(world);
    await launchStrategy(ports, { channelId: CHANNEL_ID, payload: PAYLOAD, now });
    const job = world.jobs[0];
    if (job) job.status = "DONE";
    const again = await launchStrategy(ports, { channelId: CHANNEL_ID, payload: PAYLOAD, now: new Date("2026-11-23T18:00:00Z") });
    expect(again).toMatchObject({ ok: true, message: expect.stringContaining("déjà été lancée") });
    expect(world.jobs).toHaveLength(1);
  });

  it("refuse une seconde analyse tant que la première est en file ou en cours", async () => {
    const world = createWorld();
    const ports = fakeLaunchPorts(world);
    await launchStrategy(ports, { channelId: CHANNEL_ID, payload: PAYLOAD, now });
    const other = await launchStrategy(ports, { channelId: CHANNEL_ID, payload: { ...PAYLOAD, pistes: [] }, now });
    expect(other).toMatchObject({ ok: false });
    expect(world.jobs).toHaveLength(1);
  });

  it("clé : dépend de la chaîne, du jour et des réponses", () => {
    const key = strategyJobKey(CHANNEL_ID, PAYLOAD, now);
    expect(key).toMatch(/^strategie:chaine-1:2026-11-23:[0-9a-f]{16}$/);
    expect(strategyJobKey(CHANNEL_ID, { ...PAYLOAD, budgetMensuel: 81 }, now)).not.toBe(key);
    expect(strategyJobKey(CHANNEL_ID, PAYLOAD, new Date("2026-12-23T09:00:00Z"))).not.toBe(key);
  });
});
