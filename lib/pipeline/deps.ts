import { getDb } from "@/lib/db";
import { getNotifier } from "@/lib/providers/notify";
import type { Actor, PipelineDeps } from "./service";

export function getPipelineDeps(): PipelineDeps {
  return { db: getDb(), notifier: getNotifier() };
}

/** L'humain connecté (un seul compte). */
export function ownerActor(): Actor {
  return { kind: "human", name: process.env.OWNER_EMAIL || "humain" };
}
