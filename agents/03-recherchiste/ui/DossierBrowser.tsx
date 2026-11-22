"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { buttonClass, Chip } from "@/components/ui";
import { filterDossiers, verdictDisplay, type DossierView, type FactGroup, type FactView } from "./dossiers";

// Liste des dossiers à gauche, détail à droite. Le jaune ne sert qu'aux vidéos bloquées qui attendent l'humain.

export function DossierBrowser({ dossiers }: { dossiers: DossierView[] }) {
  const filterId = useId();
  const [onlyWeak, setOnlyWeak] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const visible = filterDossiers(dossiers, onlyWeak);
  const selected = visible.find((dossier) => dossier.videoId === selectedId) ?? visible[0] ?? null;
  const weakTotal = filterDossiers(dossiers, true).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <input
          id={filterId}
          type="checkbox"
          checked={onlyWeak}
          onChange={(event) => setOnlyWeak(event.target.checked)}
          className="size-5 accent-black"
        />
        <label htmlFor={filterId} className="text-[15px] font-bold text-ink">
          Faits faibles : seulement les dossiers à compléter ({weakTotal})
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="text-muted">Aucun dossier ne contient de fait faible.</p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(240px,320px)_1fr]">
          <DossierList dossiers={visible} selectedId={selected?.videoId ?? null} onSelect={setSelectedId} />
          {selected ? <DossierDetail dossier={selected} /> : null}
        </div>
      )}
    </div>
  );
}

function DossierList({ dossiers, selectedId, onSelect }: { dossiers: DossierView[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul aria-label="Dossiers récents" className="flex flex-col gap-2">
      {dossiers.map((dossier) => {
        const isSelected = dossier.videoId === selectedId;
        return (
          <li key={dossier.videoId}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(dossier.videoId)}
              className={`flex w-full flex-col gap-2 rounded-2xl px-4 py-3 text-left transition-colors duration-150 ${
                isSelected ? "bg-ink text-white" : "bg-white text-text shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-paper"
              }`}
            >
              <span className="text-[15px] font-bold">
                {dossier.label} · {dossier.title}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <Chip tone={isSelected ? "run" : verdictDisplay[dossier.verdict].tone}>{verdictDisplay[dossier.verdict].label}</Chip>
                {dossier.weakCount > 0 ? <Chip tone="run">{dossier.weakCount} fait(s) faible(s)</Chip> : null}
                {dossier.awaitingFix ? <Chip tone="wait">À corriger</Chip> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DossierDetail({ dossier }: { dossier: DossierView }) {
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-bold text-muted">
            {dossier.label} · mis à jour {dossier.updatedLabel}
          </p>
          <h3 id={titleId} className="font-display mt-1 text-[28px]">
            {dossier.title}
          </h3>
        </div>
        <Chip tone={verdictDisplay[dossier.verdict].tone}>{verdictDisplay[dossier.verdict].label}</Chip>
      </header>

      {dossier.awaitingFix ? <BlockedNotice dossier={dossier} /> : null}
      {!dossier.awaitingFix && dossier.angleDeRemplacement ? <TextBlock title="Angle de remplacement proposé" text={dossier.angleDeRemplacement} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextBlock title="Détail pour l'accroche" text={dossier.detailAccroche} />
        <TextBlock title="Idée reçue" text={dossier.ideeRecue} />
      </div>

      {dossier.groups.map((group) => (
        <FactSection key={group.confidence} group={group} />
      ))}

      <BulletList title="Points sensibles" items={dossier.pointsSensibles} empty="Aucun point sensible signalé." />
      <BulletList title="Erreurs fréquentes des vidéos concurrentes" items={dossier.erreursFrequentes} empty="Aucune erreur relevée." />
    </article>
  );
}

function BlockedNotice({ dossier }: { dossier: DossierView }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-wait p-4 text-ink">
      <p className="font-bold">Vidéo bloquée : elle attend ta décision.</p>
      {dossier.angleDeRemplacement ? <p>Angle de remplacement proposé : {dossier.angleDeRemplacement}</p> : null}
      <Link href={`/validations?item=${dossier.videoId}`} className={`${buttonClass("ink")} self-start`}>
        Ouvrir dans Validations
      </Link>
    </div>
  );
}

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <section className="rounded-2xl p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <h4 className="text-[13px] font-bold text-muted">{title}</h4>
      <p className="mt-1">{text.trim() || "—"}</p>
    </section>
  );
}

function FactSection({ group }: { group: FactGroup }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h4 className="text-base font-[750] text-ink">
        {group.title} ({group.facts.length})
      </h4>
      <ul className="flex flex-col gap-2.5">
        {group.facts.map((fact) => (
          <FactItem key={fact.id} fact={fact} />
        ))}
      </ul>
    </section>
  );
}

function FactItem({ fact }: { fact: FactView }) {
  return (
    <li className="rounded-2xl p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <p>
        <span className="mr-2 font-bold text-ink">{fact.id}</span>
        {fact.fait}
      </p>
      {fact.formulationPrudente.trim() ? <p className="mt-1 text-[14px] text-muted">Formulation prudente : {fact.formulationPrudente}</p> : null}
      <p className="mt-2 text-[14px]">
        <span className="font-bold text-ink">Source ({fact.typeSource}) : </span>
        {fact.href ? (
          <a href={fact.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline underline-offset-2">
            {fact.sourceText}
            <span className="sr-only"> (ouvre un nouvel onglet)</span>
          </a>
        ) : (
          <span>{fact.sourceText} · lien à trouver</span>
        )}
      </p>
    </li>
  );
}

function BulletList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section>
      <h4 className="text-base font-[750] text-ink">{title}</h4>
      {items.length === 0 ? (
        <p className="mt-1 text-muted">{empty}</p>
      ) : (
        <ul className="mt-1 list-disc pl-5">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
