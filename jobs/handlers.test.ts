import { describe, expect, it } from "vitest";
import { AgentInputError, AgentPreconditionError } from "@/lib/agents/errors";
import { MAX_JOB_ATTEMPTS } from "@/lib/queue/queue";
import { classifyError } from "./handlers";

describe("classement des erreurs d'une tâche", () => {
  it("entrée invalide : la tâche échoue tout de suite (alerte), sans nouvel essai", () => {
    expect(classifyError(new AgentInputError("Formulaire invalide"), { attempts: 1 })).toEqual({ kind: "failed", reason: "Formulaire invalide" });
  });

  it("configuration à corriger : nouvel essai dans une heure, alerte à la première prise seulement", () => {
    expect(classifyError(new AgentPreconditionError("Aucun modèle"), { attempts: 1 })).toMatchObject({ kind: "retry", alert: true });
    expect(classifyError(new AgentPreconditionError("Aucun modèle"), { attempts: 2 })).toMatchObject({ kind: "retry", alert: false });
  });

  it("erreur passagère : nouveaux essais, puis échec au-delà du maximum", () => {
    expect(classifyError(new Error("réseau"), { attempts: 1 })).toMatchObject({ kind: "retry" });
    expect(classifyError(new Error("réseau"), { attempts: MAX_JOB_ATTEMPTS })).toMatchObject({ kind: "failed" });
  });
});
