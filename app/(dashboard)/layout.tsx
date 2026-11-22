import type { ReactNode } from "react";
import { requireOwner } from "@/lib/auth/owner";
import { logout } from "./actions";

// Cadre provisoire : le menu latéral noir de la maquette arrive à l'étape 2.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  await requireOwner();

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between gap-4 bg-ink px-4 py-3 text-white sm:px-6">
        <span className="text-[21px] font-[850] tracking-[-0.02em]">studio</span>
        <form action={logout}>
          <button
            type="submit"
            className="inline-flex min-h-11 items-center rounded-full px-4 text-[15px] font-semibold text-sidebar-text transition-colors duration-150 hover:bg-sidebar-hover hover:text-white"
          >
            Se déconnecter
          </button>
        </form>
      </header>
      <main className="px-4 py-8 sm:px-10">{children}</main>
    </div>
  );
}
