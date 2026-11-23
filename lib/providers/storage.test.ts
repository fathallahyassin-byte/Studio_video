import { describe, expect, it } from "vitest";
import { isStorageConfigured, publicUrl, readS3Config } from "./storage";

const FULL = { S3_BUCKET: "studio", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "secret", S3_PUBLIC_BASE_URL: "https://media.example.test/" };

describe("configuration S3", () => {
  it("complète : bucket, clés et adresse publique ; région « auto » et point d'accès facultatifs", () => {
    expect(readS3Config(FULL)).toEqual({ endpoint: null, region: "auto", bucket: "studio", accessKeyId: "id", secretAccessKey: "secret", publicBaseUrl: "https://media.example.test" });
    expect(readS3Config({ ...FULL, S3_ENDPOINT: "https://compte.r2.cloudflarestorage.com", S3_REGION: "eu" })).toMatchObject({ endpoint: "https://compte.r2.cloudflarestorage.com", region: "eu" });
  });

  it("incomplète : non configurée", () => {
    for (const key of Object.keys(FULL)) expect(isStorageConfigured({ ...FULL, [key]: " " })).toBe(false);
    expect(isStorageConfigured({})).toBe(false);
    expect(isStorageConfigured(FULL)).toBe(true);
  });

  it("adresse publique : chaque segment de la clé est encodé", () => {
    expect(publicUrl({ publicBaseUrl: "https://media.example.test" }, "rendus/v 1/rendu.mp4")).toBe("https://media.example.test/rendus/v%201/rendu.mp4");
  });
});
