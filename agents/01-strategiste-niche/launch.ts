import { createHash } from "node:crypto";
import type { StrategyPayload } from "./payload";
import type { LaunchPorts } from "./ports";

// Lancement manuel depuis la page : une tâche AGENT de l'agent 1, avec le formulaire en payload.

export type LaunchResult = { ok: boolean; message: string };

/** Même formulaire envoyé deux fois le même jour (double clic) = même clé = une seule tâche. */
export function strategyJobKey(channelId: string, payload: StrategyPayload, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
  return `strategie:${channelId}:${day}:${digest}`;
}

export async function launchStrategy(ports: LaunchPorts, input: { channelId: string; payload: StrategyPayload; now: Date }): Promise<LaunchResult> {
  if (await ports.hasPendingStrategy(input.channelId)) {
    return { ok: false, message: "Une analyse des niches est déjà en file ou en cours : attends son résultat." };
  }
  const queued = await ports.enqueueStrategy({ jobKey: strategyJobKey(input.channelId, input.payload, input.now), channelId: input.channelId, payload: input.payload });
  return queued
    ? { ok: true, message: "Analyse des niches mise en file : le résultat et la bible proposée s'afficheront ici." }
    : { ok: true, message: "Cette analyse a déjà été lancée aujourd'hui avec les mêmes réponses : son résultat est ci-dessous." };
}
