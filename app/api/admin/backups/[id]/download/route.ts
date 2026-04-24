/**
 * `GET /api/admin/backups/[id]/download` — stream the tarball back to the
 * admin's browser (ADMIN+).
 *
 * Uses Node's `fs.createReadStream` wrapped into a `ReadableStream` so
 * Next.js / Edge-compatible response machinery can pass chunks through
 * without buffering the whole tarball (can be many GB).
 */

import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { atLeast } from "@/lib/auth/role";
import { streamBackup } from "@/lib/pz/backups";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || !atLeast(session.role, "ADMIN")) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const result = await streamBackup(id);
  if (!result.ok) {
    const status = result.code === "not-found" ? 404 : 400;
    return NextResponse.json(result, { status });
  }
  // Readable.toWeb gives us a WHATWG ReadableStream that NextResponse can serve.
  const webStream = Readable.toWeb(result.stream as Readable) as ReadableStream;
  return new NextResponse(webStream, {
    status: 200,
    headers: {
      "content-type": "application/gzip",
      "content-length": String(result.sizeBytes),
      "content-disposition": `attachment; filename="${result.filename}"`,
      "cache-control": "no-store",
    },
  });
}
