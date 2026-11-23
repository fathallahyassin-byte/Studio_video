import { describe, expect, it } from "vitest";
import type { Stage } from "@/lib/generated/prisma/client";
import { makeScript, makeStoryboard } from "./fixtures";
import type { StoryboardVideo } from "./ports";
import { PLAN_FILE_MAX_BYTES } from "./ui/limits";
import { checkPlanFile, storageKey, uploadKey, uploadPlanFile, type PlanUpload, type UploadPorts, type UploadRecord } from "./upload";

const VIDEO_ID = "video-1";

function makeUploadPorts(options: { stage?: Stage; blockedAt?: Stage | null; storage?: boolean; exists?: boolean } = {}) {
  const video: StoryboardVideo = {
    stage: options.stage ?? "EDIT",
    blockedAt: options.blockedAt ?? null,
    script: makeScript(),
    storyboard: makeStoryboard(),
    previousStoryboard: null,
    totalCost: 0,
  };
  const stored: { key: string; contentType: string; size: number }[] = [];
  const records: UploadRecord[] = [];
  const ports: UploadPorts = {
    async loadVideo() {
      return options.exists === false ? null : { ...video };
    },
    storeFile:
      options.storage === false
        ? null
        : async ({ key, bytes, contentType }) => {
            stored.push({ key, contentType, size: bytes.byteLength });
            return { url: `https://media.test/${key}` };
          },
    async recordUpload(record) {
      if (!records.some((entry) => entry.key === record.key)) records.push(record);
    },
  };
  return { ports, stored, records };
}

const bytes = (text: string) => new TextEncoder().encode(text);

function makeUpload(changes: Partial<PlanUpload> = {}): PlanUpload {
  return { videoId: VIDEO_ID, planId: "P03", license: "Pexels License, usage commercial", file: { type: "video/mp4", bytes: bytes("clip") }, ...changes };
}

describe("checkPlanFile", () => {
  it("exige une licence, un format accepté et une taille raisonnable", () => {
    expect(checkPlanFile(makeUpload())).toBeNull();
    expect(checkPlanFile(makeUpload({ license: "   " }))).toMatch(/licence est obligatoire/);
    expect(checkPlanFile(makeUpload({ license: "x".repeat(301) }))).toMatch(/300 caractères/);
    expect(checkPlanFile(makeUpload({ file: { type: "application/pdf", bytes: bytes("x") } }))).toMatch(/Format refusé/);
    expect(checkPlanFile(makeUpload({ file: { type: "image/png", bytes: new Uint8Array() } }))).toMatch(/vide/);
    expect(checkPlanFile(makeUpload({ file: { type: "image/png", bytes: new Uint8Array(PLAN_FILE_MAX_BYTES + 1) } }))).toMatch(/50 Mo/);
  });
});

describe("uploadPlanFile", () => {
  it("envoie le fichier au stockage et enregistre l'Asset du plan avec sa licence", async () => {
    const { ports, stored, records } = makeUploadPorts();
    const result = await uploadPlanFile(ports, makeUpload());

    expect(result).toEqual({ ok: true, message: "Fichier ajouté pour P03." });
    expect(stored).toEqual([{ key: expect.stringMatching(/^videos\/video-1\/plans\/P03-[0-9a-f]{16}\.mp4$/), contentType: "video/mp4", size: 4 }]);
    expect(records).toEqual([
      { videoId: VIDEO_ID, planId: "P03", kind: "VIDEO", url: `https://media.test/${stored[0]?.key}`, license: "Pexels License, usage commercial", key: uploadKey(makeUpload()) },
    ]);
  });

  it("une image devient un Asset IMAGE", async () => {
    const { ports, records } = makeUploadPorts();
    await uploadPlanFile(ports, makeUpload({ planId: "P02", file: { type: "image/webp", bytes: bytes("img") } }));
    expect(records[0]).toMatchObject({ planId: "P02", kind: "IMAGE" });
  });

  it("même fichier envoyé deux fois : même clé, un seul Asset", async () => {
    const { ports, records } = makeUploadPorts();
    await uploadPlanFile(ports, makeUpload());
    await uploadPlanFile(ports, makeUpload());
    expect(records).toHaveLength(1);
    expect(uploadKey(makeUpload())).not.toBe(uploadKey(makeUpload({ file: { type: "video/mp4", bytes: bytes("autre clip") } })));
  });

  it("vidéo bloquée au montage : rappelle de relancer l'étape", async () => {
    const { ports } = makeUploadPorts({ stage: "NEEDS_FIX", blockedAt: "EDIT" });
    expect(await uploadPlanFile(ports, makeUpload())).toEqual({ ok: true, message: expect.stringContaining("relance l'étape du montage") });
  });

  it.each([
    ["sans stockage S3", { storage: false }, makeUpload(), /stockage S3/],
    ["vidéo introuvable", { exists: false }, makeUpload(), /introuvable/],
    ["après le rendu", { stage: "QA" as Stage }, makeUpload(), /avant le rendu/],
    ["plan inconnu", {}, makeUpload({ planId: "P99" }), /P99 introuvable/],
    ["plan de texte animé", {}, makeUpload({ planId: "P04" }), /texte animé/],
    ["sans licence", {}, makeUpload({ license: "" }), /licence est obligatoire/],
  ] as const)("%s : refusé, rien n'est envoyé ni enregistré", async (_label, options, upload, message) => {
    const { ports, stored, records } = makeUploadPorts(options);
    expect(await uploadPlanFile(ports, upload)).toEqual({ ok: false, message: expect.stringMatching(message) });
    expect(stored).toEqual([]);
    expect(records).toEqual([]);
  });
});

describe("storageKey", () => {
  it("range le fichier par vidéo et par plan, avec l'empreinte du contenu", () => {
    expect(storageKey({ videoId: "v", planId: "P01" }, "v:P01:manuel:abcdef0123456789ffff", "png")).toBe("videos/v/plans/P01-abcdef0123456789.png");
  });
});
