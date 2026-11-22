// Seed : `npm run db:seed` (après `npm run db:migrate`). Idempotent : on peut le relancer à chaque modification d'un prompt.md.
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { agentCatalog, type AgentMeta } from "@/agents/_shared/catalog";
import { normalizePromptFile, planPromptSync } from "@/lib/agents/promptSync";
import { getDb } from "@/lib/db";
import type { PrismaClient } from "@/lib/generated/prisma/client";

loadEnvConfig(process.cwd());

async function ensureChannel(db: PrismaClient): Promise<void> {
  if ((await db.channel.count()) > 0) return;
  await db.channel.create({
    data: { name: "Ma chaîne", niche: "À définir avec le stratège de niche", platforms: ["TIKTOK", "INSTAGRAM", "YOUTUBE"] },
  });
  console.log("Chaîne créée : « Ma chaîne » (sans bible : c'est le rôle de l'agent 1).");
}

/** Crée l'agent s'il manque ; ne touche jamais au modèle ni à l'activation réglés depuis l'interface. */
async function upsertAgent(db: PrismaClient, meta: AgentMeta): Promise<void> {
  await db.agent.upsert({
    where: { id: meta.id },
    create: {
      id: meta.id,
      slug: meta.slug,
      name: meta.name,
      role: meta.role,
      model: process.env.LLM_DEFAULT_MODEL ?? "",
      active: meta.activeByDefault,
    },
    update: { slug: meta.slug, name: meta.name, role: meta.role },
  });
}

async function syncPrompt(db: PrismaClient, meta: AgentMeta): Promise<string> {
  const file = readFileSync(path.join(process.cwd(), "agents", meta.slug, "prompt.md"), "utf8");
  const agent = await db.agent.findUniqueOrThrow({ where: { id: meta.id }, select: { activePromptVersionId: true } });
  const versions = await db.promptVersion.findMany({ where: { agentId: meta.id }, select: { id: true, version: true, content: true, source: true } });
  const plan = planPromptSync(file, versions, agent.activePromptVersionId);

  if (plan.action === "none") return "prompt inchangé";
  if (plan.action === "activate") {
    await db.agent.update({ where: { id: meta.id }, data: { activePromptVersionId: plan.versionId } });
    return "prompt réactivé";
  }
  await db.$transaction(async (tx) => {
    const created = await tx.promptVersion.create({
      data: { agentId: meta.id, version: plan.version, content: normalizePromptFile(file), source: "FILE", notes: "Importé depuis prompt.md" },
    });
    if (plan.activate) await tx.agent.update({ where: { id: meta.id }, data: { activePromptVersionId: created.id } });
  });
  return plan.activate
    ? `prompt v${plan.version} importé et actif`
    : `prompt v${plan.version} importé, NON activé : la version en production vient de l'interface`;
}

async function main(): Promise<void> {
  const db = getDb();
  try {
    await ensureChannel(db);
    for (const meta of agentCatalog) {
      await upsertAgent(db, meta);
      console.log(`Agent ${String(meta.id).padStart(2, "0")} ${meta.name} : ${await syncPrompt(db, meta)}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
