"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { buttonClass, Chip } from "@/components/ui";
import type { Role } from "../rules";
import { formatGap, formatSeconds, roleLabels, type BeatView, type Counters, type FactView, type HookView, type ScriptView } from "./scripts";

// Liste des scripts à gauche, détail à droite. Le jaune ne sert qu'aux scripts qui attendent l'humain (V2, blocage).

const roleColors: Record<Role, string> = {
  accroche: "bg-ink text-white",
  contexte: "bg-[#55585D] text-white",
  revelation: "bg-[#ECEDEA] text-ink",
  chute: "bg-[#33363A] text-white",
  boucle: "bg-[#C9CBCE] text-ink",
};

const ROLES: readonly Role[] = ["accroche", "contexte", "revelation", "chute", "boucle"];
const textWrap = "[overflow-wrap:anywhere]";

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
      {!script.status.notice && script.correctionNote ? <TextBlock title="Dernière correction demandée en V2" text={script.correctionNote} /> : null}

      <CounterTiles counters={script.counters} />
      <HookRow hooks={script.hooks} />
      <Timeline beats={script.beats} totalS={script.totalS} />
      <BeatList beats={script.beats} facts={script.facts} />
      <TextBlock title="Appel à l'action" text={script.cta ?? "Aucun (la boucle passe avant)."} />
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

function CounterTiles({ counters }: { counters: Counters }) {
  const targetWords = counters.targetWords === null ? "cible inconnue" : `cible ≈ ${counters.targetWords} mots (± 5 %)`;
  const targetDuration = counters.targetS === null ? "cible inconnue" : `cible ${formatSeconds(counters.targetS)} s`;
  const verdict = counters.withinTolerance === null ? "" : counters.withinTolerance ? "dans la tolérance" : "hors tolérance";
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <Tile label="Mots (recomptés)" value={String(counters.words)} hint={targetWords} />
      <Tile label="Durée estimée" value={`${formatSeconds(counters.estimatedS)} s`} hint={targetDuration} />
      <Tile label="Écart avec la cible" value={formatGap(counters)} hint={verdict} />
    </dl>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <dt className="text-[13px] font-bold text-muted">{label}</dt>
      <dd className="font-display mt-1 text-[26px] tabular-nums">{value}</dd>
      {hint ? <dd className="text-[13px] text-muted">{hint}</dd> : null}
    </div>
  );
}

function HookRow({ hooks }: { hooks: HookView[] }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h4 className="text-base font-[750] text-ink">Les 3 accroches</h4>
      <ol className="grid gap-3 sm:grid-cols-3">
        {hooks.map((hook, index) => (
          <li key={index} className={`flex min-w-0 flex-col gap-2 rounded-2xl p-4 ${hook.recommended ? "shadow-[inset_0_0_0_2px_var(--color-ink)]" : "shadow-[inset_0_0_0_1px_var(--color-line)]"}`}>
            <span className="flex flex-wrap gap-1.5">
              <Chip tone="run">{hook.type}</Chip>
              {hook.recommended ? <Chip tone="ok">Recommandée</Chip> : null}
            </span>
            <p className={textWrap}>{hook.voix}</p>
            <p className={`text-[14px] font-bold text-ink ${textWrap}`}>Écran : {hook.texteEcran}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Timeline({ beats, totalS }: { beats: BeatView[]; totalS: number }) {
  const presentRoles = ROLES.filter((role) => beats.some((beat) => beat.role === role));
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-base font-[750] text-ink">Frise minutée</h4>
      <p className="sr-only">
        {beats.length} beats, de 0 à {formatSeconds(totalS)} secondes. Le détail de chaque beat suit.
      </p>
      <div aria-hidden="true" className="relative h-10 w-full overflow-hidden rounded-xl bg-paper">
        {beats.map((beat) => (
          <div
            key={beat.n}
            className={`absolute inset-y-0 flex items-center justify-center border-r-2 border-white text-[13px] font-bold ${roleColors[beat.role]}`}
            style={{ left: `${beat.offsetPct}%`, width: `${beat.widthPct}%` }}
            title={`${beat.n} · ${beat.roleLabel} · ${beat.timeLabel}`}
          >
            {beat.widthPct >= 4 ? beat.n : null}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex justify-between text-[12px] text-muted tabular-nums">
        <span>0 s</span>
        <span>{formatSeconds(totalS)} s</span>
      </div>
      <ul aria-hidden="true" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
        {presentRoles.map((role) => (
          <li key={role} className="flex items-center gap-1.5">
            <span className={`inline-block size-3 rounded-sm ${roleColors[role]}`} />
            {roleLabels[role]}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BeatList({ beats, facts }: { beats: BeatView[]; facts: Record<string, FactView> }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h4 className="text-base font-[750] text-ink">Beats</h4>
      <ol className="flex flex-col gap-2.5">
        {beats.map((beat) => (
          <BeatItem key={beat.n} beat={beat} facts={facts} />
        ))}
      </ol>
    </section>
  );
}

function BeatItem({ beat, facts }: { beat: BeatView; facts: Record<string, FactView> }) {
  const [openFact, setOpenFact] = useState<string | null>(null);
  const panelId = useId();
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-2xl p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-muted">
        <span className={`inline-flex size-6 items-center justify-center rounded-full text-[12px] ${roleColors[beat.role]}`}>{beat.n}</span>
        {beat.roleLabel} · <span className="tabular-nums">{beat.timeLabel}</span>
      </p>
      <p className={textWrap}>{beat.voix}</p>
      <p className={`text-[14px] font-bold text-ink ${textWrap}`}>Écran : {beat.texteEcran}</p>
      <p className={`text-[14px] text-muted ${textWrap}`}>Visuel : {beat.intention}</p>
      {beat.factIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-bold text-muted">Faits :</span>
          {beat.factIds.map((factId) => (
            <button
              key={factId}
              type="button"
              aria-expanded={openFact === factId}
              aria-controls={panelId}
              onClick={() => setOpenFact(openFact === factId ? null : factId)}
              className={`min-h-9 rounded-full px-3 text-[13px] font-bold transition-colors duration-150 ${
                openFact === factId ? "bg-ink text-white" : "bg-white text-ink shadow-[inset_0_0_0_2px_var(--color-ink)] hover:bg-paper"
              }`}
            >
              {factId}
            </button>
          ))}
        </div>
      ) : null}
      <div id={panelId} aria-live="polite">
        {openFact ? <FactCard factId={openFact} fact={facts[openFact] ?? null} /> : null}
      </div>
    </li>
  );
}

function FactCard({ factId, fact }: { factId: string; fact: FactView | null }) {
  if (!fact) return <p className="rounded-xl bg-paper p-3 text-[14px]">{factId} : absent du dossier (ou dossier illisible).</p>;
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-paper p-3 text-[14px]">
      <p className={textWrap}>
        <span className="mr-2 font-bold text-ink">{fact.id}</span>
        {fact.fait} <span className="text-muted">({fact.confidenceLabel})</span>
      </p>
      {fact.formulationPrudente.trim() ? <p className={`text-muted ${textWrap}`}>Formulation prudente : {fact.formulationPrudente}</p> : null}
      <p className={textWrap}>
        <span className="font-bold text-ink">Source : </span>
        {fact.href ? (
          <a href={fact.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline underline-offset-2">
            {fact.sourceText}
            <span className="sr-only"> (ouvre un nouvel onglet)</span>
          </a>
        ) : (
          <span>{fact.sourceText} · lien à trouver</span>
        )}
      </p>
    </div>
  );
}

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <section className="rounded-2xl p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <h4 className="text-[13px] font-bold text-muted">{title}</h4>
      <p className={`mt-1 ${textWrap}`}>{text}</p>
    </section>
  );
}
