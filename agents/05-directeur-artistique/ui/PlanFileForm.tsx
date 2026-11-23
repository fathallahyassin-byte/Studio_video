"use client";

import { useId } from "react";
import { buttonClass, FieldLabel, fieldClass, FormMessage, PendingNote } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import { uploadPlanFileAction, type UploadFormState } from "./actions";
import { MAX_LICENSE_LENGTH, PLAN_FILE_ACCEPT, PLAN_FILE_MAX_BYTES } from "./limits";

// « Ajouter le fichier du plan » : séquence libre de droits ou visuel fourni à la main, avec sa licence.

export type UploadAvailability = { enabled: boolean; note: string | null };

export function PlanFileForm({ videoId, planId, hasFile, uploads }: { videoId: string; planId: string; hasFile: boolean; uploads: UploadAvailability }) {
  const fileId = useId();
  const licenseId = useId();
  const { state, pending, onSubmit } = useKeptForm<UploadFormState>(uploadPlanFileAction, null);
  return (
    <details className="rounded-xl bg-paper p-3">
      <summary className="cursor-pointer text-[14px] font-bold text-ink">{hasFile ? "Remplacer le fichier du plan" : "Ajouter le fichier du plan"}</summary>
      <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="videoId" value={videoId} />
        <input type="hidden" name="planId" value={planId} />
        <FieldLabel htmlFor={fileId}>Image ou vidéo ({planId}), {PLAN_FILE_MAX_BYTES / (1024 * 1024)} Mo au plus</FieldLabel>
        <input id={fileId} name="file" type="file" required accept={PLAN_FILE_ACCEPT} className="w-full min-w-0 text-[14px] file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-3 file:py-1.5 file:font-bold file:text-white" />
        <FieldLabel htmlFor={licenseId}>Licence (obligatoire)</FieldLabel>
        <input id={licenseId} name="license" type="text" required maxLength={MAX_LICENSE_LENGTH} placeholder="Ex. : Pexels License, usage commercial autorisé" className={fieldClass} />
        <button type="submit" disabled={!uploads.enabled || pending} className={`${buttonClass("ink")} self-start`}>
          {pending ? "Envoi…" : "Enregistrer le fichier"}
        </button>
        {uploads.note ? <PendingNote>{uploads.note}</PendingNote> : null}
        <FormMessage state={state} />
      </form>
    </details>
  );
}
