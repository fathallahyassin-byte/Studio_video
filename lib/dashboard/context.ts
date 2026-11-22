import { notFound } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/lib/db";
import { getCurrentChannel } from "./queries";

/** Chaîne courante, lue une seule fois par rendu (layout et page partagent le résultat). */
export const loadCurrentChannel = cache(() => getCurrentChannel(getDb()));

/** Pour les pages : le layout affiche déjà un message quand la base est vide. */
export async function requireCurrentChannel() {
  const channel = await loadCurrentChannel();
  if (!channel) notFound();
  return channel;
}
