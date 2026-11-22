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

export function VideoDecisionForm({ videoId, gate, suggestedReturn }: { videoId: string; gate: "V2" | "V3"; suggestedReturn?: V3ReturnStage }) {
  const { state, pending, onSubmit } = useKeptForm<DecisionState>(decideVideoAction.bind(null, videoId, gate), null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <NoteField hint={gate === "V2" ? "Ex. : accroche plus courte, éviter le mot « secret »" : "Ex. : la dernière phrase doit reprendre le mot « trombone »"} />
      {gate === "V3" ? (
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="returnTo">En cas de correction, renvoyer à</FieldLabel>
          <select id="returnTo" name="returnTo" defaultValue={suggestedReturn ?? "EDIT"} className={fieldClass}>
            {V3_RETURN_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stageLabels[stage]}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <FormMessage state={state} />
      <Actions pending={pending} approveLabel={gate === "V3" ? "Valider (GO)" : "Valider"} secondaryLabel="Demander une correction" secondaryIntent="changes" />
    </form>
  );
}

export function FixForm({ videoId }: { videoId: string }) {
  const { state, pending, onSubmit } = useKeptForm<DecisionState>(resolveFixAction.bind(null, videoId), null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <NoteField hint="Ex. : nouvel angle à creuser, source à utiliser" />
      <FormMessage state={state} />
      <Actions pending={pending} approveIntent="resume" approveLabel="Relancer l'étape" secondaryLabel="Abandonner la vidéo" secondaryIntent="abandon" />
    </form>
  );
}
