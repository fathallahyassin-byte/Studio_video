import { readFile } from "node:fs/promises";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { publicUrl, readS3Config, type S3Config, type StorageProvider } from "./storage";

// Stockage S3 (ou R2) avec le SDK officiel. Serveur et worker uniquement.

export function createS3Storage(config: S3Config): StorageProvider {
  const client = new S3Client({
    region: config.region,
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    name: config.endpoint ? `s3 (${new URL(config.endpoint).host})` : "s3",
    async putFile({ key, filePath, contentType }) {
      const body = await readFile(filePath);
      await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.byteLength }));
      return { key, url: publicUrl(config, key) };
    },
  };
}

/** null tant que S3_* n'est pas rempli (voir .env.example). */
export function getStorageProvider(env: Record<string, string | undefined> = process.env): StorageProvider | null {
  const config = readS3Config(env);
  return config ? createS3Storage(config) : null;
}
