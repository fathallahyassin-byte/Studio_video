"use server";

import { redirect } from "next/navigation";
import { endOwnerSession } from "@/lib/auth/owner";

export async function logout(): Promise<void> {
  await endOwnerSession();
  redirect("/login");
}
