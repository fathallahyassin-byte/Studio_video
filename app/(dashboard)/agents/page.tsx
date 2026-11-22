import type { Metadata } from "next";
import { AgentGrid } from "@/components/AgentGrid";
import { PageHeader } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getAgentCards } from "@/lib/dashboard/queries";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Agents · Studio" };

export default async function AgentsPage() {
  const channel = await requireCurrentChannel();
  const agents = await getAgentCards(getDb(), channel.id);
  return (
    <>
      <PageHeader title="Agents" description="Onze agents, un prompt chacun. Sélectionne un agent pour modifier son prompt et son modèle." />
      <AgentGrid agents={agents} />
    </>
  );
}
