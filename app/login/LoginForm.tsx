"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { error: null, email: "" };

const fieldClass =
  "w-full rounded-[10px] bg-white px-3 py-2.5 text-[15px] text-text shadow-[inset_0_0_0_1px_var(--color-field)] focus:shadow-[inset_0_0_0_2px_var(--color-ink)] focus:outline-none";

export function LoginForm({ next }: { next: string | undefined }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-[13px] font-bold text-ink">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state.email} className={fieldClass} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-[13px] font-bold text-ink">Mot de passe</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={fieldClass} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="code" className="text-[13px] font-bold text-ink">Code de l&apos;application d&apos;authentification</label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          aria-describedby="code-hint"
          className={`${fieldClass} tracking-[0.3em] tabular-nums`}
        />
        <p id="code-hint" className="text-[13px] text-muted">6 chiffres, renouvelés toutes les 30 secondes.</p>
      </div>
      {state.error ? (
        <p role="alert" className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-5 text-[15px] font-bold text-white transition-colors duration-150 hover:bg-[#2a2b2d] active:scale-[0.97] disabled:cursor-wait disabled:opacity-70"
      >
        {pending ? "Connexion…" : "Se connecter"}
      </button>
    </form>
  );
}
