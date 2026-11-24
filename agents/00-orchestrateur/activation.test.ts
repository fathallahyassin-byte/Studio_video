import { describe, expect, it } from "vitest";
import { switchOrchestrator, type ActivationPorts } from "./activation";

function makeActivationPorts(options: { exists?: boolean; queued?: number } = {}) {
  const calls: string[] = [];
  const ports: ActivationPorts = {
    async setActive(active) {
      calls.push(`active=${active}`);
      return options.exists ?? true;
    },
    async cancelQueuedJobs() {
      calls.push("cancel");
      return options.queued ?? 0;
    },
  };
  return { ports, calls };
}

describe("interrupteur Activé / Désactivé", () => {
  it("activer : Agent.active = true, aucune tâche touchée", async () => {
    const { ports, calls } = makeActivationPorts();
    expect(await switchOrchestrator(ports, true)).toMatchObject({ ok: true, message: expect.stringContaining("activé") });
    expect(calls).toEqual(["active=true"]);
  });

  it("désactiver : Agent.active = false et les tâches en file sont annulées", async () => {
    const { ports, calls } = makeActivationPorts({ queued: 2 });
    expect(await switchOrchestrator(ports, false)).toMatchObject({ ok: true, message: expect.stringContaining("2 tâche(s) en file annulée(s)") });
    expect(calls).toEqual(["active=false", "cancel"]);
  });

  it("agent absent de la base : message, rien d'autre", async () => {
    const { ports, calls } = makeActivationPorts({ exists: false });
    expect(await switchOrchestrator(ports, false)).toMatchObject({ ok: false, message: expect.stringContaining("db:seed") });
    expect(calls).toEqual(["active=false"]);
  });
});
