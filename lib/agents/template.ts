const VARIABLE_PATTERN = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export class MissingVariablesError extends Error {
  readonly names: string[];

  constructor(names: string[]) {
    super(`Variables non remplacées : ${names.map((name) => `{{${name}}}`).join(", ")}`);
    this.name = "MissingVariablesError";
    this.names = names;
  }
}

export function listTemplateVariables(template: string): string[] {
  const names = Array.from(template.matchAll(VARIABLE_PATTERN), (match) => match[1] ?? "");
  return [...new Set(names)].filter((name) => name !== "");
}

/**
 * Remplace chaque {{VARIABLE}} en une seule passe : une valeur injectée (la bible, un JSON)
 * n'est jamais relue, même si elle contient elle-même des accolades.
 */
export function renderTemplate(template: string, values: Readonly<Record<string, string>>): string {
  const missing = listTemplateVariables(template).filter((name) => !Object.hasOwn(values, name));
  if (missing.length > 0) throw new MissingVariablesError(missing);
  return template.replace(VARIABLE_PATTERN, (_match, name: string) => values[name] ?? "");
}
