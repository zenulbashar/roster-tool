import { ownerRepo } from "@/lib/auth/context";
import { blobStore } from "@/lib/blob/s3";
import { readClockPhoto } from "@/lib/clock-photo-storage";

/**
 * Streams a clock photo to the signed-in owner. Scoped through the tenant repo,
 * so an owner can only ever fetch their own business's photos. Returns 404 for
 * anything else (including another tenant's id). The bytes come from the
 * object store when the photo lives there (PERF-06), else the database copy.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const repo = await ownerRepo();
  const photo = await readClockPhoto(repo, blobStore(), id);
  if (!photo) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(photo.body), {
    headers: {
      "Content-Type": photo.mimeType,
      "Cache-Control": "private, no-store",
    },
  });
}
