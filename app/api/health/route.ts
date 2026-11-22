import { NextResponse } from "next/server";
import { isOwnerSession } from "@/lib/auth/owner";

export async function GET() {
  if (!(await isOwnerSession())) return NextResponse.json({ error: "non_authentifie" }, { status: 401 });
  return NextResponse.json({ ok: true });
}
