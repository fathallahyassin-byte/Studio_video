"use client";

import { buttonClass, FieldLabel, fieldClass, FormMessage } from "@/components/ui";
import { useKeptForm } from "@/components/useKeptForm";
import type { BibleFields } from "@/lib/bible/bible";
import { saveBibleFields, saveBibleYaml, type BibleFormState } from "./actions";

function TextField({ id, label, defaultValue, type = "text" }: { id: keyof BibleFields; label: string; defaultValue: string | number; type?: "text" | "number" }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input id={id} name={id} type={type} min={type === "number" ? 1 : undefined} defaultValue={defaultValue} required={id !== "cta"} className={fieldClass} />
    </div>
  );
}

function NoteField({ id }: { id: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>Note de version (facultatif)</FieldLabel>
      <input id={id} name="note" type="text" maxLength={500} placeholder="Ex. : on teste 70 secondes" className={fieldClass} />
    </div>
  );
}

export function BibleFieldsForm({ baseVersionId, fields }: { baseVersionId: string; fields: BibleFields }) {
  const { state, pending, onSubmit } = useKeptForm<BibleFormState>(saveBibleFields.bind(null, baseVersionId), null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-x-6 gap-y-4">
        <TextField id="niche" label="Niche" defaultValue={fields.niche} />
        <TextField id="promesse" label="Promesse" defaultValue={fields.promesse} />
        <TextField id="ton" label="Ton" defaultValue={fields.ton} />
        <div className="grid grid-cols-2 gap-3">
          <TextField id="dureeMin" label="Durée minimale (s)" defaultValue={fields.dureeMin} type="number" />
          <TextField id="dureeMax" label="Durée maximale (s)" defaultValue={fields.dureeMax} type="number" />
        </div>
        <TextField id="voix" label="Voix" defaultValue={fields.voix} />
        <TextField id="cta" label="Appel à l'action" defaultValue={fields.cta} />
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="piliers">Piliers (un par ligne)</FieldLabel>
          <textarea id="piliers" name="piliers" defaultValue={fields.piliers.join("\n")} className={`${fieldClass} min-h-24 resize-y`} />
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="sujetsInterdits">Sujets interdits (un par ligne)</FieldLabel>
          <textarea id="sujetsInterdits" name="sujetsInterdits" defaultValue={fields.sujetsInterdits.join("\n")} className={`${fieldClass} min-h-24 resize-y`} />
        </div>
      </div>
      <NoteField id="note-fields" />
      <FormMessage state={state} />
      <div>
        <button type="submit" className={buttonClass("ink")} disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer la version"}
        </button>
      </div>
    </form>
  );
}

export function BibleYamlForm({ baseVersionId, content }: { baseVersionId: string; content: string }) {
  const { state, pending, onSubmit } = useKeptForm<BibleFormState>(saveBibleYaml.bind(null, baseVersionId), null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="bible-yaml">Texte complet (YAML)</FieldLabel>
        <textarea id="bible-yaml" name="content" defaultValue={content} spellCheck={false} className={`${fieldClass} min-h-[480px] resize-y font-mono text-[13px] leading-[1.55]`} />
      </div>
      <NoteField id="note-yaml" />
      <FormMessage state={state} />
      <div>
        <button type="submit" className={buttonClass("ink")} disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer la version"}
        </button>
      </div>
    </form>
  );
}
