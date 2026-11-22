import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isOwnerSession } from "@/lib/auth/owner";
import { safeNextPath } from "@/lib/auth/redirect";
import { readAuthEnv } from "@/lib/env";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Connexion · Studio" };

type LoginPageProps = { searchParams: Promise<{ next?: string | string[] }> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  if (await isOwnerSession()) redirect(safeNextPath(nextPath));
  const configured = readAuthEnv().ok;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px] rounded-[20px] bg-white p-7 shadow-[inset_0_0_0_1px_var(--color-line)] sm:p-9">
        <div className="flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="11" fill="none" stroke="#000" strokeWidth="4" strokeDasharray="56 13.1" transform="rotate(-60 16 16)" />
            <circle cx="16" cy="5" r="4" fill="#FFD60A" />
          </svg>
          <span className="text-[21px] font-[850] tracking-[-0.02em] text-ink">studio</span>
        </div>
        <h1 className="font-display mt-8 text-[40px]">Connexion</h1>
        <p className="mt-2 mb-7 text-muted">Un seul compte : le tien. L&apos;outil détient les clés API et peut publier.</p>
        {configured ? (
          <LoginForm next={nextPath} />
        ) : (
          <div role="status" className="rounded-xl bg-paper p-4 text-sm text-text shadow-[inset_0_0_0_1px_var(--color-line)]">
            <p className="font-bold text-ink">Connexion pas encore configurée</p>
            <p className="mt-1">
              Lance <code className="font-mono">npm run auth:setup</code> dans un terminal, puis redémarre <code className="font-mono">npm run dev</code>.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
