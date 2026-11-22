import { Client } from "pg";
import { e2eDatabaseUrl } from "./fixtures";

// Accès SQL direct pour l'e2e : Playwright charge les tests en CommonJS, le client Prisma généré est en ESM.

export async function withDb<T>(run: (client: Client) => Promise<T>, url = e2eDatabaseUrl()): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

export async function videoState(title: string): Promise<{ stage: string; agents: number[] }> {
  return withDb(async (client) => {
    const video = await client.query<{ id: string; stage: string }>('SELECT "id", "stage" FROM "Video" WHERE "title" = $1', [title]);
    const row = video.rows[0];
    if (!row) throw new Error(`Vidéo introuvable : ${title}`);
    const jobs = await client.query<{ agentId: number }>('SELECT "agentId" FROM "AgentJob" WHERE "videoId" = $1 ORDER BY "createdAt", "agentId"', [row.id]);
    return { stage: row.stage, agents: jobs.rows.map((job) => job.agentId) };
  });
}

export async function v3Decisions(title: string): Promise<string[]> {
  return withDb(async (client) => {
    const result = await client.query<{ decision: string }>(
      'SELECT v."decision" FROM "Validation" v JOIN "Video" x ON x."id" = v."videoId" WHERE x."title" = $1 AND v."gate" = \'V3\' ORDER BY v."createdAt"',
      [title],
    );
    return result.rows.map((row) => row.decision);
  });
}

/** Une base neuve (sans tables) compte comme vide. */
export async function hasData(url: string): Promise<boolean> {
  try {
    return await withDb(async (client) => {
      const result = await client.query<{ count: string }>('SELECT (SELECT COUNT(*) FROM "Agent") + (SELECT COUNT(*) FROM "Video") AS count');
      return Number(result.rows[0]?.count ?? 0) > 0;
    }, url);
  } catch {
    return false;
  }
}
