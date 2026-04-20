import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { checkConfigAccess } from "@/lib/pz/access-check";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session || !atLeast(session.role, "VIEWER")) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const res = await checkConfigAccess();
  return NextResponse.json(res);
}
