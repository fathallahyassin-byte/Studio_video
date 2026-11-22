import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { listTemplateVariables } from "@/lib/agents/template";
import { agentCatalog, getAgentMeta } from "./_shared/catalog";
import { AgentNotImplementedError, createPlaceholderDefinition } from "./_shared/placeholder";
import { agentPanels } from "./panels";
import { agentRegistry, listAgentDefinitions } from "./registry";

const agentsDir = path.resolve(import.meta.dirname);

describe("registre des agents", () => {
  it("contient les 11 agents, de 0 à 10", () => {
    expect(Object.keys(agentRegistry).map(Number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(Object.keys(agentPanels).map(Number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it.each(agentCatalog)("l'agent $id ($slug) correspond au catalogue et à son dossier", (meta) => {
    const definition = agentRegistry[meta.id];
    expect(definition).toMatchObject({ id: meta.id, slug: meta.slug, name: meta.name, promptFile: "prompt.md" });
    for (const file of ["AGENT.md", "prompt.md", "schema.ts", "definition.ts", "ui/Panel.tsx", "NEEDS.md"]) {
      expect(existsSync(path.join(agentsDir, meta.slug, file)), `${meta.slug}/${file}`).toBe(true);
    }
  });

  it.each(agentCatalog)("les variables du prompt de $slug sont celles de son AGENT.md", (meta) => {
    const prompt = readFileSync(path.join(agentsDir, meta.slug, "prompt.md"), "utf8");
    const sheet = readFileSync(path.join(agentsDir, meta.slug, "AGENT.md"), "utf8");
    expect(listTemplateVariables(prompt).sort()).toEqual(listTemplateVariables(sheet).sort());
  });

  it("liste les 11 définitions", () => {
    expect(listAgentDefinitions()).toHaveLength(11);
  });
});

describe("définition provisoire", () => {
  it("refuse de s'exécuter tant que le fork ne l'a pas remplacée", async () => {
    const definition = createPlaceholderDefinition(getAgentMeta(4), z.object({}));
    const ctx = { channelId: "c", videoId: null, bible: null, bibleVersionId: null };
    await expect(definition.buildVariables({}, ctx)).rejects.toThrow(AgentNotImplementedError);
    await expect(definition.onSuccess({}, {}, ctx)).rejects.toThrow("Agent à implémenter : Scénariste");
  });
});
