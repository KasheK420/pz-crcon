import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import { ThemePrefsSchema } from "@/lib/pz/schemas";

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const body = await req.json();
  const prefs = ThemePrefsSchema.parse(body);
  await prisma.user.update({
    where: { id: session.userId },
    data: { themePrefs: prefs },
  });
  return NextResponse.json({ ok: true, prefs });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const u = await prisma.user.findUnique({ where: { id: session.userId } });
  return NextResponse.json({
    prefs: ThemePrefsSchema.parse(u?.themePrefs ?? {}),
  });
}
