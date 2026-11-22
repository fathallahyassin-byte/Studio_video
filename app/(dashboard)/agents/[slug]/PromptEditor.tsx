"use client";

import { buttonClass, FieldLabel, fieldClass, FormMessage, PendingNote } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { savePrompt, type FormState } from "../actions";

type PromptEditorProps = {
  slug: string;
  model: string;
  prompt: string;
  activeVersionId: string;
  activeVersionLabel: string;
};

export function PromptEditor({ slug, model, prompt, activeVersionId, activeVersionLabel }: PromptEditorProps) {
  const { state, pending, onSubmit } = useKeptForm<FormState>(savePrompt.bind(null, slug), null);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="baseVersionId" value={activeVersionId} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="model">Modèle</FieldLabel>
          <input id="model" name="model" type="text" defaultValue={model} placeholder="Aucun : l'agent ne peut pas être appelé" className={fieldClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-bold text-ink">Format de sortie</span>
          <span className="py-2.5 text-[15px] text-text">JSON strict, validé par schema.ts</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="prompt">Prompt système · {activeVersionLabel}</FieldLabel>
        <textarea
          key={activeVersionId}
          id="prompt"
          name="prompt"
          defaultValue={prompt}
          spellCheck={false}
          className={`${fieldClass} min-h-[420px] resize-y font-mono text-[13px] leading-[1.55]`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="notes">Note de version (facultatif)</FieldLabel>
        <input id="notes" name="notes" type="text" maxLength={500} placeholder="Ex. : accroches plus courtes" className={fieldClass} />
      </div>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2.5">
        <button type="submit" className={buttonClass("ink")} disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer une nouvelle version"}
        </button>
        <button type="button" className={buttonClass("ghost")} disabled>
          Tester sur la dernière vidéo
        </button>
      </div>
      <PendingNote>Le test sur la dernière vidéo arrivera avec le fork de l&apos;agent (étape 4), une fois un fournisseur LLM choisi.</PendingNote>
    </form>
  );
}
