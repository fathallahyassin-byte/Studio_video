import type { ReactNode } from "react";

// Briques visuelles de la maquette. Le jaune (tone « wait », bouton « hi ») est réservé à ce qui attend une action.

export type ChipTone = "wait" | "run" | "ok";

const chipTones: Record<ChipTone, string> = {
  wait: "bg-wait text-ink",
  run: "bg-[#ECEDEA] text-[#33363A]",
  ok: "bg-ink text-white",
};

export function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs leading-[1.4] font-bold ${chipTones[tone]}`}>
      {children}
    </span>
  );
}

export type ButtonVariant = "ink" | "ghost" | "hi";

const buttonVariants: Record<ButtonVariant, string> = {
  ink: "bg-ink text-white hover:bg-wait hover:text-ink",
  ghost: "bg-transparent text-ink shadow-[inset_0_0_0_2px_var(--color-ink)] hover:bg-ink hover:text-white",
  hi: "bg-wait text-ink hover:bg-ink hover:text-white",
};

export function buttonClass(variant: ButtonVariant): string {
  return [
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-[18px] text-[15px] font-bold no-underline",
    "transition-[background-color,color,transform] duration-150 active:scale-[0.97]",
    "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-inherit disabled:active:scale-100",
    buttonVariants[variant],
  ].join(" ");
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[20px] bg-white p-5 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-7 ${className}`}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[36px] sm:text-[44px]">{title}</h1>
        <p className="mt-1.5 max-w-[70ch] text-muted">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2.5">{actions}</div> : null}
    </div>
  );
}

/** Indique qu'une commande existe mais n'est branchée qu'à une étape suivante de la feuille de route. */
export function PendingNote({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted">{children}</p>;
}

export function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-bold text-ink">
      {children}
    </label>
  );
}

export const fieldClass =
  "w-full rounded-[10px] bg-white px-3 py-2.5 text-[15px] text-text shadow-[inset_0_0_0_1px_var(--color-field)] focus:shadow-[inset_0_0_0_2px_var(--color-ink)] focus:outline-none";

export function FormMessage({ state }: { state: { ok: boolean; message: string } | null }) {
  if (!state) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`rounded-xl px-4 py-3 text-sm font-semibold ${state.ok ? "bg-ink text-white" : "bg-wait text-ink"}`}>
      {state.message}
    </p>
  );
}
