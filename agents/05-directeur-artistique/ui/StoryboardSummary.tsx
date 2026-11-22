import { Chip } from "@/components/ui";
import type { StoryboardView } from "./storyboards";

// Résumé des plans pour le détail V3 de « À valider » : l'humain voit quels plans portent le label IA avant le GO.

const textWrap = "[overflow-wrap:anywhere]";

export function StoryboardSummary({ storyboard, headingLevel: Heading = "h3" }: { storyboard: StoryboardView; headingLevel?: "h3" | "h4" }) {
  const labelled = storyboard.plans.filter((plan) => plan.aiLabel).map((plan) => plan.id);
  const seconds = String(storyboard.budget.totalS).replace(".", ",");
  return (
    <section className="flex flex-col gap-3">
      <Heading className="text-[13px] font-bold text-ink">Plans du directeur artistique</Heading>
      <p className="text-sm text-text">
        {storyboard.plans.length} plans · {seconds} s de vidéo IA ·{" "}
        {labelled.length === 0 ? "aucun plan ne demande le label IA" : `label IA demandé pour ${labelled.join(", ")}`}
      </p>
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-2">
        {storyboard.plans.map((plan) => (
          <li key={plan.id} className="flex min-w-0 flex-col gap-1 rounded-[10px] bg-paper px-3 py-2.5 text-sm">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-bold text-ink">{plan.id}</span>
              <Chip tone="run">{plan.typeLabel}</Chip>
              {plan.aiLabel ? <Chip tone="ok">Label IA</Chip> : null}
            </span>
            <span className="text-xs text-muted">
              {plan.timeLabel} · {plan.media.label}
            </span>
            <span className={`text-text ${textWrap}`}>{plan.description}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
