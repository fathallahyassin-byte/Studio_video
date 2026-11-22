import { isNode, isSeq, parseDocument, type Document } from "yaml";
import { z } from "zod";
import { listTemplateVariables } from "@/lib/agents/template";

// La bible est un texte YAML (docs/bible.template.yaml). Le formulaire édite quelques champs ;
// on les réécrit dans le document YAML pour garder les commentaires et les autres clés.

/** Ce que les agents lisent dans la bible : le reste est libre. */
const bibleSchema = z.looseObject({
  chaine: z.looseObject({ nom: z.string(), niche: z.string(), promesse: z.string() }),
  ligne_editoriale: z.looseObject({ ton: z.string(), piliers: z.array(z.string()), sujets_interdits: z.array(z.string()) }),
  format_video: z.looseObject({
    duree_cible_s: z.tuple([z.number().positive(), z.number().positive()]),
    debit_voix_mots_par_s: z.number().positive(),
  }),
  identite: z.looseObject({ voix: z.string(), cta: z.string() }),
});

export type BibleFields = {
  niche: string;
  promesse: string;
  ton: string;
  dureeMin: number;
  dureeMax: number;
  /** format_video.debit_voix_mots_par_s : sert au calcul du nombre de mots d'un script */
  debitVoix: number;
  voix: string;
  cta: string;
  piliers: string[];
  sujetsInterdits: string[];
};

export type BibleCheck = { ok: true; fields: BibleFields; placeholders: string[] } | { ok: false; error: string };

const PATHS = {
  niche: ["chaine", "niche"],
  promesse: ["chaine", "promesse"],
  ton: ["ligne_editoriale", "ton"],
  duree: ["format_video", "duree_cible_s"],
  debitVoix: ["format_video", "debit_voix_mots_par_s"],
  voix: ["identite", "voix"],
  cta: ["identite", "cta"],
  piliers: ["ligne_editoriale", "piliers"],
  sujetsInterdits: ["ligne_editoriale", "sujets_interdits"],
} as const;

function parse(yamlText: string): { ok: true; doc: Document } | { ok: false; error: string } {
  const doc = parseDocument(yamlText);
  const firstError = doc.errors[0];
  if (firstError) return { ok: false, error: `YAML invalide : ${firstError.message}` };
  return { ok: true, doc };
}

/** Vérifie le YAML et les clés dont les agents ont besoin, et renvoie les champs du formulaire. */
export function checkBible(yamlText: string): BibleCheck {
  const parsed = parse(yamlText);
  if (!parsed.ok) return parsed;
  const result = bibleSchema.safeParse(parsed.doc.toJS());
  if (!result.success) {
    const issue = result.error.issues[0];
    return { ok: false, error: `Bible incomplète : ${issue ? `${issue.path.join(".")} (${issue.message})` : "structure inattendue"}` };
  }
  const bible = result.data;
  const [dureeMin, dureeMax] = bible.format_video.duree_cible_s;
  if (dureeMin > dureeMax) return { ok: false, error: "La durée minimale dépasse la durée maximale." };
  return {
    ok: true,
    placeholders: listTemplateVariables(yamlText),
    fields: {
      niche: bible.chaine.niche,
      promesse: bible.chaine.promesse,
      ton: bible.ligne_editoriale.ton,
      dureeMin,
      dureeMax,
      debitVoix: bible.format_video.debit_voix_mots_par_s,
      voix: bible.identite.voix,
      cta: bible.identite.cta,
      piliers: bible.ligne_editoriale.piliers,
      sujetsInterdits: bible.ligne_editoriale.sujets_interdits,
    },
  };
}

/** Réécrit les champs du formulaire dans le YAML, sans toucher au reste du document. */
export function applyBibleFields(yamlText: string, fields: BibleFields): string {
  const parsed = parse(yamlText);
  if (!parsed.ok) throw new Error(parsed.error);
  const { doc } = parsed;
  doc.setIn([...PATHS.niche], fields.niche);
  doc.setIn([...PATHS.promesse], fields.promesse);
  doc.setIn([...PATHS.ton], fields.ton);
  doc.setIn([...PATHS.voix], fields.voix);
  doc.setIn([...PATHS.cta], fields.cta);
  doc.setIn([...PATHS.debitVoix], fields.debitVoix);
  setFlowList(doc, PATHS.duree, [fields.dureeMin, fields.dureeMax]);
  setFlowList(doc, PATHS.piliers, fields.piliers);
  setFlowList(doc, PATHS.sujetsInterdits, fields.sujetsInterdits);
  return doc.toString({ lineWidth: 0 });
}

/** Remplace une liste en gardant son style en ligne et ses commentaires (sinon `yaml` les perd). */
function setFlowList(doc: Document, path: readonly string[], values: readonly (string | number)[]): void {
  const node = doc.createNode(values);
  const previous: unknown = doc.getIn([...path], true);
  if (isSeq(node)) node.flow = true;
  if (isNode(previous)) {
    node.comment = previous.comment;
    node.commentBefore = previous.commentBefore;
    node.spaceBefore = previous.spaceBefore;
  }
  doc.setIn([...path], node);
}

/** Une ligne par élément, lignes vides ignorées. */
export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}
