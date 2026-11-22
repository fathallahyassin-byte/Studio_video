"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { buttonClass, Chip } from "@/components/ui";
import { ScriptReview, TextBlock, textWrap } from "./ScriptParts";
import { formatSeconds, type ScriptView } from "./scripts";

// Liste des scripts à gauche, détail à droite. Le jaune ne sert qu'aux scripts qui attendent l'humain (V2, blocage).

export function ScriptBrowser({ scripts }: { scripts: ScriptView[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = scripts.find((script) => script.videoId === selectedId) ?? scripts[0] ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
      <ScriptList scripts={scripts} selectedId={selected?.videoId ?? null} onSelect={setSelectedId} />
      {selected ? <ScriptDetail key={selected.videoId} script={selected} /> : null}
    </div>
  );
}

function ScriptList({ scripts, selectedId, onSelect }: { scripts: ScriptView[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul aria-label="Scripts récents" className="flex min-w-0 flex-col gap-2">
      {scripts.map((script) => {
        const isSelected = script.videoId === selectedId;
        return (
          <li key={script.videoId}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(script.videoId)}
              className={`flex w-full flex-col gap-2 rounded-2xl px-4 py-3 text-left transition-colors duration-150 ${
                isSelected ? "bg-ink text-white" : "bg-white text-text shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-paper"
              }`}
            >
              <span className={`text-[15px] font-bold ${textWrap}`}>
                {script.label} · {script.title}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <Chip tone={script.status.tone}>{script.status.label}</Chip>
                <Chip tone="run">
                  {script.counters.words} mots · {formatSeconds(script.counters.estimatedS)} s
                </Chip>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ScriptDetail({ script }: { script: ScriptView }) {
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-muted">
            {script.label} · mis à jour {script.updatedLabel}
          </p>
          <h3 id={titleId} className={`font-display mt-1 text-[28px] ${textWrap}`}>
            {script.title}
          </h3>
          {script.titreInterne.trim() && script.titreInterne !== script.title ? <p className={`text-muted ${textWrap}`}>Titre interne : {script.titreInterne}</p> : null}
        </div>
        <Chip tone={script.status.tone}>{script.status.label}</Chip>
      </header>

      {script.status.notice ? <AwaitingNotice videoId={script.videoId} notice={script.status.notice} /> : null}
      {!script.status.notice && script.correctionNote ? <TextBlock title="Dernière correction demandée en V2" text={script.correctionNote} heading="h4" /> : null}

      <ScriptReview content={script} headingLevel="h4" />
    </article>
  );
}

function AwaitingNotice({ videoId, notice }: { videoId: string; notice: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-wait p-4 text-ink">
      <p className="font-bold">{notice}</p>
      <Link href={`/validations?item=${videoId}`} className={`${buttonClass("ink")} self-start`}>
        Ouvrir dans Validations
      </Link>
    </div>
  );
}
