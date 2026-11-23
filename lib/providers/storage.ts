// Stockage des médias (compatible S3 : Cloudflare R2, AWS S3…). Les URL renvoyées sont durables :
// le panneau, la publication et le contrôle qualité les relisent longtemps après l'écriture.

export type StoredFile = { url: string; key: string };

export type StorageProvider = {
  readonly name: string;
  /** Envoie un fichier local sous `key` ; écrase un objet de même clé (une clé = un contenu). */
  putFile(request: { key: string; filePath: string; contentType: string }): Promise<StoredFile>;
};

export type S3Config = {
  /** vide pour AWS S3 (point d'accès par défaut de la région) */
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** adresse publique du bucket (domaine R2, CloudFront…), sans « / » final */
  publicBaseUrl: string;
};

const value = (raw: string | undefined) => raw?.trim() ?? "";

/** null tant que le bucket, les clés et l'adresse publique ne sont pas tous renseignés. */
export function readS3Config(env: Record<string, string | undefined> = process.env): S3Config | null {
  const bucket = value(env.S3_BUCKET);
  const accessKeyId = value(env.S3_ACCESS_KEY_ID);
  const secretAccessKey = value(env.S3_SECRET_ACCESS_KEY);
  const publicBaseUrl = value(env.S3_PUBLIC_BASE_URL).replace(/\/+$/, "");
  if (!bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) return null;
  return { endpoint: value(env.S3_ENDPOINT) || null, region: value(env.S3_REGION) || "auto", bucket, accessKeyId, secretAccessKey, publicBaseUrl };
}

export function isStorageConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readS3Config(env) !== null;
}

/** Adresse publique d'un objet : chaque segment de la clé est encodé. */
export function publicUrl(config: Pick<S3Config, "publicBaseUrl">, key: string): string {
  return `${config.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
