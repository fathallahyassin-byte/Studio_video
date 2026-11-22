import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseAgentId } from "@/agents/_shared/catalog";
import { agentPanels } from "@/agents/panels";
import { AgentGrid } from "@/components/AgentGrid";
import { buttonClass, Chip, PageHeader, Panel, type ChipTone } from "@/components/ui";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { formatDateTime, formatInteger, formatMoney, formatRelative, formatVideoNumber } from "@/lib/dashboard/format";
import { getAgentCards, getAgentDetail } from "@/lib/dashboard/queries";
import { getDb } from "@/lib/db";
import type { RunStatus } from "@/lib/generated/prisma/client";
import { activatePromptVersion } from "../actions";
import { PromptEditor } from "./PromptEditor";

type AgentPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: AgentPageProps): Promise<Metadata> {
  const { slug } = await params;
  const agent = await getAgentDetail(getDb(), slug);
  return { title: `${agent?.name ?? "Agent"} · Studio` };
}

const runStatus: Record<RunStatus, { tone: ChipTone; label: string }> = {
  OK: { tone: "ok", label: "OK" },
  INVALID_JSON: { tone: "run", label: "JSON invalide" },
  CONTROL_FAILED: { tone: "run", label: "Contrôle refusé" },
  ERROR: { tone: "run", label: "Erreur" },
};

const cell = "px-4 py-3 text-left";

export default async function AgentPage({ params }: AgentPageProps) {
  const { slug } = await params;
  const channel = await requireCurrentChannel();
  const db = getDb();
  const [agent, cards] = await Promise.all([getAgentDetail(db, slug), getAgentCards(db, channel.id)]);
  if (!agent) notFound();

  const card = cards.find((entry) => entry.slug === slug);
  const active = agent.activePromptVersion;
  const AgentPanel = agentPanels[parseAgentId(agent.id)];
  const now = new Date();

  return (
    <>
      <PageHeader title="Agents" description="Onze agents, un prompt chacun. Sélectionne un agent pour modifier son prompt et son modèle." />
      <AgentGrid agents={cards} currentSlug={slug} />

      <Panel className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[13px] font-bold text-muted">Agent {agent.id}</p>
            <h2 className="font-display mt-1 text-[32px]">{agent.name}</h2>
            <p className="mt-1 text-muted">{agent.role}</p>
          </div>
          <p className="text-[13px] text-muted">
            {agent.active ? "" : "Désactivé · "}Dernier passage : {card?.lastRunAt ? formatRelative(card.lastRunAt, now) : "jamais"}
          </p>
        </div>
        {active ? (
          <PromptEditor
            slug={slug}
            model={agent.model}
            prompt={active.content}
            activeVersionId={active.id}
            activeVersionLabel={`v${active.version} en production`}
          />
        ) : (
          <p className="text-muted">Aucune version de prompt en base : lance <code className="font-mono">npm run db:seed</code>.</p>
        )}
      </Panel>

      <Panel className="flex flex-col gap-4">
        <h2 className="text-lg font-[750] text-ink">Versions du prompt</h2>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead className="text-muted">
              <tr>
                <th scope="col" className={cell}>Version</th>
                <th scope="col" className={cell}>Origine</th>
                <th scope="col" className={cell}>Date</th>
                <th scope="col" className={cell}>Note</th>
                <th scope="col" className={cell}><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {agent.promptVersions.map((version) => (
                <tr key={version.id} className="border-t border-[#ECEDEA]">
                  <td className={`${cell} font-bold text-ink`}>v{version.version}</td>
                  <td className={cell}>{version.source === "FILE" ? "prompt.md" : "Interface"}</td>
                  <td className={cell}>{formatDateTime(version.createdAt)}</td>
                  <td className={cell}>{version.notes ?? "—"}</td>
                  <td className={cell}>
                    {version.id === active?.id ? (
                      <Chip tone="ok">En production</Chip>
                    ) : (
                      <form action={activatePromptVersion.bind(null, slug, version.id)}>
                        <button type="submit" className={`${buttonClass("ghost")} min-h-9 px-3.5 text-sm`}>
                          Remettre en production
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="flex flex-col gap-4">
        <h2 className="text-lg font-[750] text-ink">Dernières exécutions</h2>
        {agent.runs.length === 0 ? (
          <p className="text-muted">Aucune exécution pour l&apos;instant.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="text-muted">
                <tr>
                  <th scope="col" className={cell}>Date</th>
                  <th scope="col" className={cell}>Vidéo</th>
                  <th scope="col" className={cell}>Tentative</th>
                  <th scope="col" className={cell}>Statut</th>
                  <th scope="col" className={cell}>Prompt</th>
                  <th scope="col" className={`${cell} text-right`}>Tokens</th>
                  <th scope="col" className={`${cell} text-right`}>Coût</th>
                  <th scope="col" className={`${cell} text-right`}>Durée</th>
                </tr>
              </thead>
              <tbody>
                {agent.runs.map((run) => (
                  <tr key={run.id} className="border-t border-[#ECEDEA] align-top">
                    <td className={cell}>{formatDateTime(run.createdAt)}</td>
                    <td className={cell}>{run.video ? `${formatVideoNumber(run.video.number)} · ${run.video.title}` : "—"}</td>
                    <td className={`${cell} tabular-nums`}>{run.attempt}/3</td>
                    <td className={cell}>
                      <Chip tone={runStatus[run.status].tone}>{runStatus[run.status].label}</Chip>
                      {run.error ? <span className="mt-1 block max-w-[32ch] text-xs text-muted">{run.error}</span> : null}
                    </td>
                    <td className={cell}>v{run.promptVersion.version}</td>
                    <td className={`${cell} text-right tabular-nums`}>{formatInteger(run.inputTokens + run.outputTokens)}</td>
                    <td className={`${cell} text-right tabular-nums`}>{formatMoney(run.cost.toNumber())}</td>
                    <td className={`${cell} text-right tabular-nums`}>{Math.round(run.durationMs / 1000)} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <AgentPanel agentId={parseAgentId(agent.id)} slug={slug} />
    </>
  );
}
