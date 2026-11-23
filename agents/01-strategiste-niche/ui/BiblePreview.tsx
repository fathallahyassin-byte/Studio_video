import Link from "next/link";
import { Chip } from "@/components/ui";
import type { DiffKind } from "./diff";
import { AdoptForm } from "./StrategyForm";
import type { BibleDraftView } from "./view";

// Bible proposée, ligne à ligne, comparée à la bible active ; « Adopter cette bible » si le brouillon attend.

const lineStyles: Record<DiffKind, { prefix: string; label: string; className: string }> = {
  same: { prefix: "  ", label: "", className: "text-text" },
  added: { prefix: "+ ", label: "ajoutée : ", className: "bg-[#E3E5E0] font-semibold text-ink" },
  removed: { prefix: "− ", label: "retirée : ", className: "text-muted line-through" },
};

function DiffSummary({ bible }: { bible: BibleDraftView }) {
  if (bible.activeVersion === null) return <p className="text-muted">Aucune bible active : tout le texte est nouveau.</p>;
  if (bible.added === 0 && bible.removed === 0) return <p className="text-muted">Identique à la bible active (v{bible.activeVersion}).</p>;
  return (
    <p className="text-muted">
      Comparée à la bible active (v{bible.activeVersion}) : {bible.added} ligne(s) ajoutée(s) ou modifiée(s), {bible.removed} retirée(s).
    </p>
  );
}

function StatusChip({ bible }: { bible: BibleDraftView }) {
  if (bible.status === "pending") return <Chip tone="wait">Brouillon v{bible.draft?.version} à adopter</Chip>;
  if (bible.status === "active") return <Chip tone="ok">Adoptée (v{bible.draft?.version})</Chip>;
  return <Chip tone="run">Brouillon pas encore enregistré</Chip>;
}

export function BiblePreview({ bible }: { bible: BibleDraftView }) {
  return (
    <section aria-labelledby="bible-proposee" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="bible-proposee" className="text-lg font-[750] text-ink">
          Bible proposée
        </h2>
        <StatusChip bible={bible} />
      </div>
      <DiffSummary bible={bible} />
      <pre className="max-h-[480px] overflow-y-auto rounded-xl bg-paper p-3 font-mono text-xs leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere]">
        {bible.lines.map((line, index) => (
          <span key={index} className={`block ${lineStyles[line.kind].className}`}>
            <span aria-hidden="true">{lineStyles[line.kind].prefix}</span>
            {line.kind === "same" ? null : <span className="sr-only">{lineStyles[line.kind].label}</span>}
            {line.text === "" ? " " : line.text}
          </span>
        ))}
      </pre>
      {bible.status === "pending" && bible.draft ? <AdoptForm versionId={bible.draft.id} version={bible.draft.version} /> : null}
      {bible.status === "active" ? (
        <p className="text-[13px] text-muted">
          Pour la modifier ou revenir à une version précédente : <Link href="/bible" className="font-bold text-ink underline">écran Bible</Link>.
        </p>
      ) : null}
    </section>
  );
}
