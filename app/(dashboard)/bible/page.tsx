import type { Metadata } from "next";
import { buttonClass, Chip, PageHeader, Panel } from "@/components/ui";
import { checkBible } from "@/lib/bible/bible";
import { requireCurrentChannel } from "@/lib/dashboard/context";
import { formatDateTime, formatRelative } from "@/lib/dashboard/format";
import { getBibleData } from "@/lib/dashboard/queries";
import { getDb } from "@/lib/db";
import type { BibleAuthor } from "@/lib/generated/prisma/client";
import { activateBibleVersion, createBibleFromTemplate } from "./actions";
import { BibleFieldsForm, BibleYamlForm } from "./BibleForms";

export const metadata: Metadata = { title: "Bible · Studio" };

const authorLabels: Record<BibleAuthor, string> = { HUMAN: "toi", AGENT_1: "le stratège de niche", AGENT_10: "l'analyste" };

type BiblePageProps = { searchParams: Promise<{ enregistree?: string | string[] }> };

export default async function BiblePage({ searchParams }: BiblePageProps) {
  const { enregistree } = await searchParams;
  const channel = await requireCurrentChannel();
  const { active, versions } = await getBibleData(getDb(), channel.id);
  const check = active ? checkBible(active.content) : null;
  const justSaved = typeof enregistree === "string" && /^\d+$/.test(enregistree) && active?.version === Number(enregistree);

  return (
    <>
      <PageHeader title="Bible de la chaîne" description="Le seul texte que lisent tous les agents. Chaque enregistrement crée une nouvelle version." />
      {justSaved ? (
        <p role="status" className="rounded-[14px] bg-ink px-4 py-3 font-semibold text-white">
          Bible enregistrée en version v{active.version}. Les agents l&apos;utiliseront dès la prochaine tâche.
        </p>
      ) : null}

      {!active ? (
        <Panel className="flex flex-col items-start gap-3 sm:p-10">
          <p className="font-display text-[30px]">Aucune bible adoptée.</p>
          <p className="max-w-[60ch] text-muted">
            Le stratège de niche (agent 1) en proposera une. En attendant, tu peux partir du modèle <code className="font-mono">docs/bible.template.yaml</code> et le
            remplir ici.
          </p>
          <form action={createBibleFromTemplate}>
            <button type="submit" className={`${buttonClass("ink")} mt-2`}>
              Partir du modèle
            </button>
          </form>
        </Panel>
      ) : (
        <>
          {check && check.ok && check.placeholders.length > 0 ? (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-[14px] bg-wait px-4 py-3 text-sm font-semibold text-ink">
              Champs du modèle encore à remplir : {check.placeholders.map((name) => `{{${name}}}`).join(", ")}
            </div>
          ) : null}

          <Panel className="flex flex-col gap-5">
            {check && check.ok ? (
              <BibleFieldsForm key={active.id} baseVersionId={active.id} fields={check.fields} />
            ) : (
              <p role="alert" className="rounded-xl bg-wait px-4 py-3 text-sm font-semibold text-ink">
                {check && !check.ok ? check.error : "Bible illisible"} : corrige-la dans le texte complet ci-dessous.
              </p>
            )}
            <p className="text-[13px] text-muted">
              Version actuelle : v{active.version}, écrite par {authorLabels[active.author]} {formatRelative(active.createdAt, new Date())}.
            </p>
            <details className="group rounded-[14px] bg-paper p-4" open={!(check && check.ok)}>
              <summary className="cursor-pointer text-[15px] font-bold text-ink">Modifier le texte complet (YAML)</summary>
              <div className="mt-4">
                <BibleYamlForm key={active.id} baseVersionId={active.id} content={active.content} />
              </div>
            </details>
          </Panel>
        </>
      )}

      {versions.length > 0 ? (
        <Panel className="flex flex-col gap-4">
          <h2 className="text-lg font-[750] text-ink">Historique des versions</h2>
          <ol className="flex flex-col">
            {versions.map((version) => (
              <li key={version.id} className="flex flex-col gap-2 border-t border-[#ECEDEA] py-3 first:border-t-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-bold text-ink">v{version.version}</span>
                  <span className="text-sm text-text">
                    {authorLabels[version.author]} · {formatDateTime(version.createdAt)}
                    {version.note ? ` · ${version.note}` : ""}
                  </span>
                  <span className="ml-auto">
                    {version.id === active?.id ? (
                      <Chip tone="ok">Active</Chip>
                    ) : (
                      <form action={activateBibleVersion.bind(null, version.id)}>
                        <button type="submit" className={`${buttonClass("ghost")} min-h-9 px-3.5 text-sm`}>
                          {version.author === "AGENT_1" ? "Adopter cette bible" : "Remettre en service"}
                        </button>
                      </form>
                    )}
                  </span>
                </div>
                <details>
                  <summary className="cursor-pointer text-[13px] font-semibold text-muted">Voir le texte</summary>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-paper p-3 font-mono text-xs whitespace-pre-wrap text-text">{version.content}</pre>
                </details>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}
    </>
  );
}
