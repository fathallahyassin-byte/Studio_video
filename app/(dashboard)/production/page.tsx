import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass, Chip, PageHeader, PendingNote } from "@/components/ui";
import type { BoardCard } from "@/lib/dashboard/board";
import { formatInteger, formatMoney, formatVideoNumber } from "@/lib/dashboard/format";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { getProductionData } from "@/lib/dashboard/queries";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Production · Studio" };

/** Lien vers la validation qui attend, pour les cartes jaunes. */
function validationHref(card: BoardCard): string | null {
  if (card.stage === "AWAITING_V1") return "/validations?item=v1";
  if (card.stage === "AWAITING_V2" || card.stage === "AWAITING_V3") return `/validations?item=${card.id}`;
  return null;
}

function VideoCard({ card }: { card: BoardCard }) {
  const href = validationHref(card);
  const title = <span className="font-[650] leading-[1.3] text-ink">{card.title}</span>;
  return (
    <article className="flex flex-col gap-2.5 rounded-xl bg-white p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <div className="flex gap-2.5">
        <span aria-hidden="true" className="h-[34px] w-5 shrink-0 rounded-[5px]" style={{ background: card.swatch }} />
        {href ? (
          <Link href={href} className="underline-offset-2 hover:underline">
            {title}
          </Link>
        ) : (
          title
        )}
      </div>
      {card.stage === "NEEDS_FIX" && card.blockedReason ? <p className="line-clamp-3 text-xs text-muted">{card.blockedReason}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <Chip tone={card.status.tone}>{card.status.label}</Chip>
        <span className="text-xs text-muted">{formatVideoNumber(card.number)}</span>
      </div>
    </article>
  );
}

export default async function ProductionPage() {
  const channel = await requireCurrentChannel();
  const data = await getProductionData(getDb(), channel.id, new Date());
  const monthlyBudget = Number(process.env.BUDGET_MENSUEL ?? "");
  const kpis = [
    { label: "Vidéos en cours", value: formatInteger(data.inProgress) },
    { label: "À valider", value: formatInteger(data.queueCount) },
    { label: "Publiées ce mois", value: formatInteger(data.publishedThisMonth) },
    {
      label: "Coût ce mois",
      value: formatMoney(data.costThisMonth),
      hint: Number.isFinite(monthlyBudget) && monthlyBudget > 0 ? `sur ${formatMoney(monthlyBudget)} de budget` : undefined,
    },
  ];

  return (
    <>
      <PageHeader
        title="Production"
        description="Chaque vidéo avance d'un agent à l'autre. Les cartes jaunes attendent ta validation."
        actions={
          <>
            <button type="button" className={buttonClass("ghost")} disabled>
              Nouvelle vidéo
            </button>
            <button type="button" className={buttonClass("ink")} disabled>
              Lancer la veille de la semaine
            </button>
          </>
        }
      />
      <PendingNote>Les deux boutons seront branchés à l&apos;étape 3, avec la machine à états.</PendingNote>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-3">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-2xl bg-white px-[18px] py-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
            <p className="text-[13px] text-muted">{kpi.label}</p>
            <p className="font-display mt-1.5 text-[34px] tabular-nums">{kpi.value}</p>
            {kpi.hint ? <p className="mt-1 text-xs text-muted">{kpi.hint}</p> : null}
          </div>
        ))}
      </div>

      <div className="relative overflow-x-auto pb-2" tabIndex={0} aria-label="Tableau de production, défilable horizontalement">
        <div className="grid min-w-[1380px] grid-cols-6 gap-3">
          {data.columns.map((column) => (
            <section key={column.key} aria-labelledby={`col-${column.key}`} className="flex flex-col gap-2.5 rounded-[18px] bg-column p-3">
              <div className="flex items-center justify-between gap-2 px-1 pt-1 pb-0.5">
                <h2 id={`col-${column.key}`} className="text-[15px] font-[750] text-ink">
                  {column.label}
                </h2>
                <span className="text-[13px] font-semibold text-muted">
                  <span className="sr-only">Nombre de vidéos : </span>
                  {column.cards.length}
                </span>
              </div>
              <p className="px-1 text-xs text-muted">{column.agents}</p>
              {column.cards.map((card) => (
                <VideoCard key={card.id} card={card} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
