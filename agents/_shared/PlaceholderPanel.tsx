import { getAgentMeta } from "./catalog";
import type { AgentPanelProps } from "./types";

export function PlaceholderPanel({ agentId, slug }: AgentPanelProps) {
  const meta = getAgentMeta(agentId);
  return (
    <section
      aria-label={`Panneau de l'agent ${meta.name}`}
      className="rounded-2xl bg-white p-7 shadow-[inset_0_0_0_1px_var(--color-line)]"
    >
      <p className="font-display text-3xl">Agent à implémenter</p>
      <p className="mt-2 text-muted">
        Le panneau de « {meta.name} » arrivera avec son fork : <code>agents/{slug}/ui/Panel.tsx</code>.
      </p>
    </section>
  );
}
