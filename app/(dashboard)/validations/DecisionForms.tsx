"use client";

import type { ReactNode } from "react";
import { buttonClass, FieldLabel, fieldClass, FormMessage } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { stageLabels, V3_RETURN_STAGES, type V3ReturnStage } from "@/lib/pipeline/machine";
import { decideIdeasAction, decideVideoAction, resolveFixAction, type DecisionState } from "./actions";

function NoteField({ hint }: { hint: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor="note">Note pour l&apos;agent</FieldLabel>
      <textarea id="note" name="note" maxLength={2000} className={`${fieldClass} min-h-24 resize-y`} placeholder={hint} />
    </div>
  );
}

function Actions({ pending, approveLabel, secondaryLabel, secondaryIntent, approveIntent = "approve" }: { pending: boolean; approveLabel: string; secondaryLabel: string; secondaryIntent: string; approveIntent?: string }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      <button type="submit" name="intent" value={approveIntent} className={buttonClass("hi")} disabled={pending}>
        {approveLabel}
      </button>
      <button type="submit" name="intent" value={secondaryIntent} className={buttonClass("ghost")} disabled={pending}>
        {secondaryLabel}
      </button>
    </div>
  );
}

/** V1 : la liste des idées (cases à cocher) est passée en enfant, rendue côté serveur. */
export function IdeasDecisionForm({ children }: { children: ReactNode }) {
  const { state, pending, onSubmit } = useKeptForm<DecisionState>(decideIdeasAction, null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {children}
      <NoteField hint="Ex. : privilégier l'angle historique pour la recherche" />
      <FormMessage state={state} />
      <Actions pending={pending} approveLabel="Valider la sélection" secondaryLabel="Écarter la sélection" secondaryIntent="reject" />
    </form>
  );
}

function ReturnStageSelect({ label, defaultValue, hint }: { label: string; defaultValue: V3ReturnStage; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor="returnTo">{label}</FieldLabel>
      <select id="returnTo" name="returnTo" defaultValue={defaultValue} aria-describedby={hint ? "returnTo-hint" : undefined} className={fieldClass}>
        {V3_RETURN_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {stageLabels[stage]}
          </option>
        ))}
      </select>
      {hint ? (
        <p id="returnTo-hint" className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Partenariat commercial lu par le contrôle qualité (étiquette « contenu de marque », mentions) : à fixer avant la production. */
function PartnershipField({ defaultValue }: { defaultValue: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor="partnership">Partenariat commercial</FieldLabel>
      <input id="partnership" name="partnership" type="text" maxLength={300} defaultValue={defaultValue} aria-describedby="partnership-hint" className={fieldClass} />
      <p id="partnership-hint" className="text-[13px] text-muted">
        Marque et contrepartie, ou « aucun ». Le contrôle qualité en déduit l&apos;étiquette « contenu de marque » et les mentions obligatoires.
      </p>
    </div>
  );
}

export function VideoDecisionForm({ videoId, gate, suggestedReturn, partnership }: { videoId: string; gate: "V2" | "V3"; suggestedReturn?: V3ReturnStage; partnership?: string }) {
  const { state, pending, onSubmit } = useKeptForm<DecisionState>(decideVideoAction.bind(null, videoId, gate), null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {gate === "V2" && partnership !== undefined ? <PartnershipField defaultValue={partnership} /> : null}
      <NoteField hint={gate === "V2" ? "Ex. : accroche plus courte, éviter le mot « secret »" : "Ex. : la dernière phrase doit reprendre le mot « trombone »"} />
      {gate === "V3" ? <ReturnStageSelect label="En cas de correction, renvoyer à" defaultValue={suggestedReturn ?? "EDIT"} /> : null}
      <FormMessage state={state} />
      <Actions pending={pending} approveLabel={gate === "V3" ? "Valider (GO)" : "Valider"} secondaryLabel="Demander une correction" secondaryIntent="changes" />
    </form>
  );
}

/** `sources` : présent seulement pour une vidéo bloquée en recherche (liens donnés au recherchiste). */
export function FixForm({ videoId, sources, suggestedReturn }: { videoId: string; sources?: readonly string[]; suggestedReturn?: V3ReturnStage | null }) {
  const { state, pending, onSubmit } = useKeptForm<DecisionState>(resolveFixAction.bind(null, videoId), null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {sources ? (
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="sources">Sources pour le recherchiste (une adresse par ligne)</FieldLabel>
          <textarea
            id="sources"
            name="sources"
            defaultValue={sources.join("\n")}
            aria-describedby="sources-hint"
            spellCheck={false}
            className={`${fieldClass} min-h-28 resize-y font-mono text-[13px]`}
            placeholder="https://…"
          />
          <p id="sources-hint" className="text-[13px] text-muted">
            Sans source fournie, le recherchiste n&apos;invente aucune adresse : ses faits restent « faibles ». Ajoute des liens fiables avant de relancer.
          </p>
        </div>
      ) : null}
      {suggestedReturn ? (
        <ReturnStageSelect
          label="Relancer à l'étape"
          defaultValue={suggestedReturn}
          hint="NO-GO du contrôle qualité : relance l'étape de l'agent responsable (proposée d'après le premier point « ko »). Relancer le contrôle seul redonnerait le même verdict."
        />
      ) : null}
      <NoteField hint="Ex. : nouvel angle à creuser, source à utiliser" />
      <FormMessage state={state} />
      <Actions pending={pending} approveIntent="resume" approveLabel="Relancer l'étape" secondaryLabel="Abandonner la vidéo" secondaryIntent="abandon" />
    </form>
  );
}
