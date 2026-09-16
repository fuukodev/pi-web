import { DEV_SERVICE_WORKER_SOURCE } from "@/lib/dev-service-worker";

/**
 * Dev-only shim for `/sw.js` (see `lib/dev-service-worker.ts`): a worker left
 * over from a production run installs this instead, wipes Cache Storage, and
 * unregisters itself.
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response(null, { status: 404 });
  }

  return new Response(DEV_SERVICE_WORKER_SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Service-Worker-Allowed": "/",
    },
  });
}
