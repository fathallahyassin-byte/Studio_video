import type { z } from "zod";
import type { AgentContext, AgentDefinition, ControlResult } from "@/agents/_shared/types";
import { LlmConfigurationError, type LlmMessage, type LlmProvider, type LlmResponse } from "@/lib/providers/llm";
import type { Notifier } from "@/lib/providers/notify";
import { AgentPreconditionError } from "./errors";
import { extractJson, formatZodIssues } from "./json";
import type { AgentConfig, AgentRunStore, AttemptRecord, StoredAttempt } from "./store";
import { MissingVariablesError, renderTemplate } from "./template";

/** 1 appel + 2 relances (CLAUDE.md §5.3) */
export const MAX_ATTEMPTS = 3;

export const FIRST_USER_MESSAGE =
  "Réponds maintenant avec l'objet JSON décrit dans le format de sortie, sans aucun texte autour.";

export function retryMessage(error: string): string {
  return `Ta réponse précédente a été refusée :\n${error}\n\nRenvoie uniquement l'objet JSON corrigé, conforme au format de sortie, sans texte autour.`;
}

export type RunAgentRequest<TInput, TSchema extends z.ZodType> = {
  definition: AgentDefinition<TInput, TSchema>;
  input: TInput;
  channelId: string;
  videoId: string | null;
  /** clé d'idempotence : même clé = même exécution, jamais deux appels réussis */
  jobKey: string;
};

export type RunAgentDeps = {
  store: AgentRunStore;
  llm: LlmProvider;
  notifier: Notifier;
  now?: () => number;
};

export type RunAgentResult<TOutput> =
  | { status: "ok"; output: TOutput; runId: string; attempt: number; reused: boolean }
  | { status: "needs_fix"; reason: string; attempts: number };

type Prepared = {
  agent: AgentConfig & { promptVersion: { id: string; content: string } };
  ctx: AgentContext;
  variables: Record<string, string>;
  system: string;
};

type Verdict<TOutput> =
  | { status: "OK"; output: TOutput }
  | { status: "INVALID_JSON" | "CONTROL_FAILED"; error: string };

/**
 * Exécution commune à tous les agents : variables, appel LLM, validation Zod, contrôles en code,
 * relances avec le message d'erreur, enregistrement d'un AgentRun par tentative, puis onSuccess.
 * Une erreur du fournisseur consomme une tentative puis remonte, pour que la file réessaie plus tard.
 */
export async function runAgent<TInput, TSchema extends z.ZodType>(
  request: RunAgentRequest<TInput, TSchema>,
  deps: RunAgentDeps,
): Promise<RunAgentResult<z.infer<TSchema>>> {
  const previous = await deps.store.listAttempts(request.jobKey);
  const succeeded = previous.find((attempt) => attempt.status === "OK");
  if (succeeded) return resumeSuccess(request, deps, succeeded);
  if (previous.length >= MAX_ATTEMPTS) return reportExhausted(request, deps, previous, { notify: false });

  const prepared = await prepare(request, deps.store);
  const messages = rebuildConversation(previous);
  for (let attempt = previous.length + 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await runAttempt(request, deps, prepared, messages, attempt);
    if (result.status === "ok") return result;
    if (result.status === "provider_error" && attempt < MAX_ATTEMPTS) throw result.error;
    if (result.status === "rejected") messages.push(...result.followUp);
  }
  return reportExhausted(request, deps, await deps.store.listAttempts(request.jobKey), { notify: true });
}

async function prepare<TInput, TSchema extends z.ZodType>(
  request: RunAgentRequest<TInput, TSchema>,
  store: AgentRunStore,
): Promise<Prepared> {
  const agent = await loadCallableAgent(request.definition, store);
  const bible = await store.loadActiveBible(request.channelId);
  const ctx: AgentContext = {
    channelId: request.channelId,
    videoId: request.videoId,
    bible: bible?.content ?? null,
    bibleVersionId: bible?.id ?? null,
  };
  const variables = withoutBible(await request.definition.buildVariables(request.input, ctx));
  const system = renderPrompt(agent.promptVersion.content, variables, ctx.bible);
  return { agent, ctx, variables, system };
}

async function loadCallableAgent<TInput, TSchema extends z.ZodType>(
  definition: AgentDefinition<TInput, TSchema>,
  store: AgentRunStore,
): Promise<Prepared["agent"]> {
  const agent = await store.loadAgent(definition.id);
  if (!agent) throw new AgentPreconditionError(`Agent ${definition.id} absent de la base : lance le seed.`);
  if (!agent.active) throw new AgentPreconditionError(`L'agent « ${agent.name} » est désactivé.`);
  if (agent.model.trim() === "") throw new AgentPreconditionError(`Aucun modèle configuré pour « ${agent.name} ».`);
  const { promptVersion } = agent;
  if (!promptVersion) throw new AgentPreconditionError(`Aucune version de prompt active pour « ${agent.name} ».`);
  return { ...agent, promptVersion };
}

function withoutBible(variables: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(variables).filter(([name]) => name !== "BIBLE"));
}

function renderPrompt(template: string, variables: Record<string, string>, bible: string | null): string {
  const values = bible === null ? variables : { ...variables, BIBLE: bible };
  try {
    return renderTemplate(template, values);
  } catch (error) {
    if (!(error instanceof MissingVariablesError)) throw error;
    const hint = error.names.includes("BIBLE") && bible === null ? " Aucune bible n'est encore adoptée." : "";
    throw new AgentPreconditionError(`${error.message}. Appel annulé.${hint}`, { cause: error });
  }
}

/** Reconstruit l'échange après un redémarrage : chaque réponse refusée suivie de son message d'erreur. */
function rebuildConversation(previous: StoredAttempt[]): LlmMessage[] {
  const messages: LlmMessage[] = [{ role: "user", content: FIRST_USER_MESSAGE }];
  for (const attempt of previous) {
    if (attempt.status === "ERROR" || attempt.rawOutput === null) continue;
    messages.push(...followUpMessages(attempt.rawOutput, attempt.error ?? "réponse refusée"));
  }
  return messages;
}

function followUpMessages(rawOutput: string, error: string): LlmMessage[] {
  return [
    { role: "assistant", content: rawOutput },
    { role: "user", content: retryMessage(error) },
  ];
}

type AttemptOutcome<TOutput> =
  | Extract<RunAgentResult<TOutput>, { status: "ok" }>
  | { status: "rejected"; followUp: LlmMessage[] }
  | { status: "provider_error"; error: unknown };

async function runAttempt<TInput, TSchema extends z.ZodType>(
  request: RunAgentRequest<TInput, TSchema>,
  deps: RunAgentDeps,
  prepared: Prepared,
  messages: LlmMessage[],
  attempt: number,
): Promise<AttemptOutcome<z.infer<TSchema>>> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  let response: LlmResponse;
  try {
    response = await deps.llm.complete({ model: prepared.agent.model, system: prepared.system, messages: [...messages] });
  } catch (error) {
    // Clé, modèle ou requête à corriger : rien n'a été facturé, aucune tentative n'est comptée.
    if (error instanceof LlmConfigurationError) throw new AgentPreconditionError(error.message, { cause: error });
    await recordFailure(request, deps, prepared, attempt, { durationMs: now() - startedAt, rawOutput: null, error });
    return { status: "provider_error", error };
  }
  const durationMs = now() - startedAt;
  const verdict = await judge(request, deps, prepared, attempt, response, durationMs);
  const base = baseRecord(request, prepared, attempt);
  const usage = { inputTokens: response.inputTokens, outputTokens: response.outputTokens, cost: response.cost, durationMs };

  if (verdict.status !== "OK") {
    await deps.store.recordAttempt({ ...base, ...usage, output: null, rawOutput: response.text, status: verdict.status, error: verdict.error });
    return { status: "rejected", followUp: followUpMessages(response.text, verdict.error) };
  }
  const run = await deps.store.recordAttempt({ ...base, ...usage, output: verdict.output, rawOutput: response.text, status: "OK", error: null });
  await request.definition.onSuccess(verdict.output, request.input, prepared.ctx);
  await deps.store.markSuccessHandled(run.id);
  return { status: "ok", output: verdict.output, runId: run.id, attempt, reused: false };
}

/** Zod, normalize puis controls. Un bug dans ces fonctions est enregistré (l'appel a coûté) puis remonte. */
async function judge<TInput, TSchema extends z.ZodType>(
  request: RunAgentRequest<TInput, TSchema>,
  deps: RunAgentDeps,
  prepared: Prepared,
  attempt: number,
  response: LlmResponse,
  durationMs: number,
): Promise<Verdict<z.infer<TSchema>>> {
  try {
    return await evaluate(request.definition, request.input, response.text);
  } catch (error) {
    await recordFailure(request, deps, prepared, attempt, { durationMs, rawOutput: response.text, error, response });
    throw error;
  }
}

async function evaluate<TInput, TSchema extends z.ZodType>(
  definition: AgentDefinition<TInput, TSchema>,
  input: TInput,
  text: string,
): Promise<Verdict<z.infer<TSchema>>> {
  const extracted = extractJson(text);
  if (!extracted.ok) return { status: "INVALID_JSON", error: extracted.error };
  const parsed = definition.outputSchema.safeParse(extracted.value);
  if (!parsed.success) {
    return { status: "INVALID_JSON", error: `La sortie ne respecte pas le schéma :\n${formatZodIssues(parsed.error)}` };
  }
  const output = definition.normalize ? definition.normalize(parsed.data, input) : parsed.data;
  const failures = (definition.controls ? await definition.controls(output, input) : []).filter(isFailure);
  if (failures.length > 0) {
    return { status: "CONTROL_FAILED", error: `Contrôles refusés :\n${failures.map((failure) => `- ${failure.reason}`).join("\n")}` };
  }
  return { status: "OK", output };
}

function isFailure(result: ControlResult): result is Extract<ControlResult, { ok: false }> {
  return !result.ok;
}

async function recordFailure<TInput, TSchema extends z.ZodType>(
  request: RunAgentRequest<TInput, TSchema>,
  deps: RunAgentDeps,
  prepared: Prepared,
  attempt: number,
  failure: { durationMs: number; rawOutput: string | null; error: unknown; response?: LlmResponse },
): Promise<void> {
  await deps.store.recordAttempt({
    ...baseRecord(request, prepared, attempt),
    inputTokens: failure.response?.inputTokens ?? 0,
    outputTokens: failure.response?.outputTokens ?? 0,
    cost: failure.response?.cost ?? 0,
    durationMs: failure.durationMs,
    output: null,
    rawOutput: failure.rawOutput,
    status: "ERROR",
    error: failure.error instanceof Error ? failure.error.message : String(failure.error),
  });
}

function baseRecord<TInput, TSchema extends z.ZodType>(
  request: RunAgentRequest<TInput, TSchema>,
  prepared: Prepared,
  attempt: number,
): Pick<AttemptRecord, "jobKey" | "attempt" | "channelId" | "videoId" | "agentId" | "promptVersionId" | "bibleVersionId" | "model" | "input"> {
  return {
    jobKey: request.jobKey,
    attempt,
    channelId: request.channelId,
    videoId: request.videoId,
    agentId: request.definition.id,
    promptVersionId: prepared.agent.promptVersion.id,
    bibleVersionId: prepared.ctx.bibleVersionId,
    model: prepared.agent.model,
    input: prepared.variables,
  };
}

/** Une sortie déjà acceptée n'est jamais redemandée ; onSuccess est rejoué seulement s'il n'avait pas fini. */
async function resumeSuccess<TInput, TSchema extends z.ZodType>(
  request: RunAgentRequest<TInput, TSchema>,
  deps: RunAgentDeps,
  run: StoredAttempt,
): Promise<RunAgentResult<z.infer<TSchema>>> {
  const output = request.definition.outputSchema.parse(run.output);
  if (run.successHandledAt === null) {
    const bible = run.bibleVersionId === null ? null : await deps.store.loadBible(run.bibleVersionId);
    const ctx: AgentContext = {
      channelId: request.channelId,
      videoId: request.videoId,
      bible: bible?.content ?? null,
      bibleVersionId: bible?.id ?? null,
    };
    await request.definition.onSuccess(output, request.input, ctx);
    await deps.store.markSuccessHandled(run.id);
  }
  return { status: "ok", output, runId: run.id, attempt: run.attempt, reused: true };
}

async function reportExhausted<TInput, TSchema extends z.ZodType>(
  request: RunAgentRequest<TInput, TSchema>,
  deps: RunAgentDeps,
  attempts: StoredAttempt[],
  options: { notify: boolean },
): Promise<RunAgentResult<z.infer<TSchema>>> {
  const reason = attempts.at(-1)?.error ?? "échec sans message";
  if (request.videoId) await deps.store.markNeedsFix(request.videoId, `${request.definition.name} : ${reason}`);
  if (options.notify) {
    await deps.notifier.notify({
      kind: "agent_failed",
      title: `${request.definition.name} a échoué ${attempts.length} fois`,
      message: reason,
      path: request.videoId ? `/production?video=${request.videoId}` : `/agents/${request.definition.slug}`,
    });
  }
  return { status: "needs_fix", reason, attempts: attempts.length };
}
