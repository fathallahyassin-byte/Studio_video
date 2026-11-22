import Link from "next/link";
import { agentStateLabels, type AgentState } from "@/lib/dashboard/agentStatus";
import type { AgentCard } from "@/lib/dashboard/queries";
import { Chip, type ChipTone } from "./ui";

const stateTones: Record<AgentState, ChipTone> = { working: "ok", waiting: "wait", idle: "run", disabled: "run" };

export function AgentGrid({ agents, currentSlug }: { agents: AgentCard[]; currentSlug?: string }) {
  return (
    <nav aria-label="Agents" className="grid grid-cols-[repeat(auto-fit,minmax(min(210px,100%),1fr))] gap-3">
      {agents.map((agent) => {
        const current = agent.slug === currentSlug;
        return (
          <Link
            key={agent.slug}
            href={`/agents/${agent.slug}`}
            aria-current={current ? "page" : undefined}
            className={`flex flex-col items-start gap-1.5 rounded-2xl bg-white p-4 transition-shadow duration-150 ${
              current ? "shadow-[inset_0_0_0_2px_#000,0_0_0_4px_var(--color-wait)]" : "shadow-[inset_0_0_0_1px_var(--color-line)] hover:shadow-[inset_0_0_0_2px_#000]"
            }`}
          >
            <span className="text-xs font-bold text-muted">Agent {agent.id}</span>
            <span className="text-base font-[750] text-ink">{agent.name}</span>
            <Chip tone={stateTones[agent.state]}>{agentStateLabels[agent.state]}</Chip>
          </Link>
        );
      })}
    </nav>
  );
}
