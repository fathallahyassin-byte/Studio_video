"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useState } from "react";
import { buttonClass, Chip, FieldLabel, fieldClass, FormMessage, PendingNote } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { regeneratePlanAction, type RegenerateFormState } from "./actions";
import { MAX_PROMPT_LENGTH } from "./limits";
import { PlanFileForm, type UploadAvailability } from "./PlanFileForm";
import type { BudgetView, PlanView, StoryboardView } from "./storyboards";

// Liste des storyboards à gauche, grille de plans 9:16 à droite. Le jaune ne sert qu'à ce qui attend l'humain.

const textWrap = "[overflow-wrap:anywhere]";

export type RegenerationAvailability = { enabled: boolean; note: string | null };

export function StoryboardBrowser({ storyboards, regeneration, uploads }: { storyboards: StoryboardView[]; regeneration: RegenerationAvailability; uploads: UploadAvailability }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = storyboards.find((storyboard) => storyboard.videoId === selectedId) ?? storyboards[0] ?? null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
      <StoryboardList storyboards={storyboards} selectedId={selected?.videoId ?? null} onSelect={setSelectedId} />
      {selected ? <StoryboardDetail key={selected.videoId} storyboard={selected} regeneration={regeneration} uploads={uploads} /> : null}
    </div>
  );
}

function StoryboardList({ storyboards, selectedId, onSelect }: { storyboards: StoryboardView[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul aria-label="Storyboards récents" className="flex min-w-0 flex-col gap-2">
      {storyboards.map((storyboard) => {
        const isSelected = storyboard.videoId === selectedId;
        return (
          <li key={storyboard.videoId}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(storyboard.videoId)}
              className={`flex w-full flex-col gap-2 rounded-2xl px-4 py-3 text-left transition-colors duration-150 ${
                isSelected ? "bg-ink text-white" : "bg-white text-text shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-paper"
              }`}
            >
              <span className={`text-[15px] font-bold ${textWrap}`}>
                {storyboard.label} · {storyboard.title}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <Chip tone={storyboard.status.tone}>{storyboard.status.label}</Chip>
                <Chip tone="run">{storyboard.plans.length} plans</Chip>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function StoryboardDetail({ storyboard, regeneration, uploads }: { storyboard: StoryboardView; regeneration: RegenerationAvailability; uploads: UploadAvailability }) {
  const titleId = useId();
  const canRegenerate: RegenerationAvailability = storyboard.editable
    ? regeneration
    : { enabled: false, note: "Le rendu est lancé ou passé : un plan ne se régénère plus à cette étape." };
  const canUpload: UploadAvailability = storyboard.editable ? uploads : { enabled: false, note: "Le rendu est lancé ou passé : le fichier d'un plan ne se change plus à cette étape." };
  return (
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-muted">
            {storyboard.label} · mis à jour {storyboard.updatedLabel}
          </p>
          <h3 id={titleId} className={`font-display mt-1 text-[28px] ${textWrap}`}>
            {storyboard.title}
          </h3>
        </div>
        <Chip tone={storyboard.status.tone}>{storyboard.status.label}</Chip>
      </header>

      {storyboard.status.notice ? <AwaitingNotice videoId={storyboard.videoId} notice={storyboard.status.notice} /> : null}
      <BudgetMeter budget={storyboard.budget} />
      <p className={`text-[14px] text-muted ${textWrap}`}>
        Couverture : plan {storyboard.cover.plan} · « {storyboard.cover.text} »
      </p>
      {storyboard.recurringCharacters.length > 0 ? <Characters characters={storyboard.recurringCharacters} /> : null}

      <ol aria-label="Plans" className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-3">
        {storyboard.plans.map((plan) => (
          <li key={plan.id} className="min-w-0">
            <PlanCard videoId={storyboard.videoId} plan={plan} regeneration={canRegenerate} uploads={canUpload} />
          </li>
        ))}
      </ol>
    </article>
  );
}

function AwaitingNotice({ videoId, notice }: { videoId: string; notice: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-wait p-4 text-ink">
      <p className={`font-bold ${textWrap}`}>{notice}</p>
      <Link href={`/validations?item=${videoId}`} className={`${buttonClass("ink")} self-start`}>
        Ouvrir dans Validations
      </Link>
    </div>
  );
}

function BudgetMeter({ budget }: { budget: BudgetView }) {
  const seconds = (value: number) => String(value).replace(".", ",");
  if (budget.budgetS === null) {
    return <p className="text-[14px] text-muted">Vidéo IA : {seconds(budget.totalS)} s · BUDGET_SECONDES_VIDEO_IA n&apos;est pas renseigné.</p>;
  }
  const label = `Vidéo IA : ${seconds(budget.totalS)} s sur ${seconds(budget.budgetS)} s de budget`;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[14px] font-bold text-ink">
        {label}
        {budget.over ? " · dépassé" : ""}
      </p>
      <div
        role="meter"
        aria-label="Secondes de vidéo IA utilisées"
        aria-valuemin={0}
        aria-valuemax={budget.budgetS}
        aria-valuenow={budget.totalS}
        aria-valuetext={label}
        className="h-2.5 w-full overflow-hidden rounded-full bg-[#ECEDEA]"
      >
        <div className={`h-full rounded-full ${budget.over ? "bg-wait" : "bg-ink"}`} style={{ width: `${Math.round(budget.ratio * 100)}%` }} />
      </div>
    </div>
  );
}

function Characters({ characters }: { characters: StoryboardView["recurringCharacters"] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-[15px] font-[750] text-ink">Personnages récurrents</h4>
      <ul className="flex flex-col gap-1 text-[14px]">
        {characters.map((character) => (
          <li key={character.name} className={textWrap}>
            <span className="font-bold">{character.name}</span> : {character.description}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanCard({ videoId, plan, regeneration, uploads }: { videoId: string; plan: PlanView; regeneration: RegenerationAvailability; uploads: UploadAvailability }) {
  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl bg-white p-3 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <Thumbnail plan={plan} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[15px] font-[750] text-ink">{plan.id}</span>
        <Chip tone="run">{plan.typeLabel}</Chip>
        <Chip tone="run">{plan.durationLabel}</Chip>
        {plan.aiLabel ? <Chip tone="ok">Label IA</Chip> : null}
        {plan.isCover ? <Chip tone="ok">Couverture</Chip> : null}
      </div>
      <p className="text-[13px] text-muted">
        Beat {plan.beat} · {plan.timeLabel} · {plan.media.label}
      </p>
      <p className={`text-[14px] ${textWrap}`}>{plan.description}</p>
      {plan.prompt ? <PromptText label="Prompt" text={plan.prompt} /> : null}
      {plan.negativePrompt ? <PromptText label="Négatif" text={plan.negativePrompt} /> : null}
      {plan.stockKeywords.length > 0 ? <PromptText label="Mots-clés" text={plan.stockKeywords.join(", ")} /> : null}
      <div className="mt-auto flex flex-col gap-2">
        {plan.regenerable ? <RegenerateForm videoId={videoId} plan={plan} regeneration={regeneration} /> : null}
        {plan.acceptsFile ? <PlanFileForm videoId={videoId} planId={plan.id} hasFile={plan.media.url !== null} uploads={uploads} /> : null}
      </div>
    </div>
  );
}

function PromptText({ label, text }: { label: string; text: string }) {
  return (
    <p className={`font-mono text-[12.5px] leading-snug text-text ${textWrap}`}>
      <span className="font-sans text-[13px] font-bold text-ink">{label} : </span>
      {text}
    </p>
  );
}

/** Vignette 9:16 : le média généré s'il existe, sinon le texte écran sur fond noir. */
function Thumbnail({ plan }: { plan: PlanView }) {
  const { media } = plan;
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-ink">
      {media.url && media.kind === "IMAGE" ? <Image src={media.url} alt={plan.description} fill unoptimized sizes="(min-width: 1280px) 20vw, (min-width: 480px) 40vw, 90vw" className="object-cover" /> : null}
      {media.url && media.kind === "VIDEO" ? <video src={media.url} controls muted playsInline preload="metadata" aria-label={plan.description} className="h-full w-full object-cover" /> : null}
      {media.url ? null : (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-white">
          <span className="text-[12px] font-bold uppercase tracking-wide text-white/75">{plan.typeLabel}</span>
          <span className={`font-display text-[20px] leading-tight ${textWrap}`}>{plan.screenText || plan.id}</span>
        </div>
      )}
    </div>
  );
}

function RegenerateForm({ videoId, plan, regeneration }: { videoId: string; plan: PlanView; regeneration: RegenerationAvailability }) {
  const promptId = useId();
  const { state, pending, onSubmit } = useKeptForm<RegenerateFormState>(regeneratePlanAction, null);
  return (
    <details className="rounded-xl bg-paper p-3">
      <summary className="cursor-pointer text-[14px] font-bold text-ink">Modifier le prompt et régénérer</summary>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="videoId" value={videoId} />
        <input type="hidden" name="planId" value={plan.id} />
        <FieldLabel htmlFor={promptId}>Prompt en anglais ({plan.id})</FieldLabel>
        <textarea id={promptId} name="prompt" rows={6} maxLength={MAX_PROMPT_LENGTH} defaultValue={plan.prompt ?? ""} className={`${fieldClass} font-mono text-[13px]`} />
        <button type="submit" disabled={!regeneration.enabled || pending} className={`${buttonClass("ink")} self-start`}>
          {pending ? "Régénération…" : "Régénérer ce plan"}
        </button>
        {regeneration.note ? <PendingNote>{regeneration.note}</PendingNote> : null}
        <FormMessage state={state} />
      </form>
    </details>
  );
}
