import { timingSafeEqual } from "crypto";

/**
 * Verifies the X-Cron-Secret header on scheduled (pg_cron) hook routes.
 * The shared secret lives in public.platform_secrets (RLS-locked, service_role
 * only) so the database cron job and the server route read the same value.
 */
export async function verifyCronSecret(request: Request): Promise<boolean> {
  const provided = request.headers.get("x-cron-secret");
  if (!provided) return false;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("platform_secrets")
    .select("value")
    .eq("name", "cron_secret")
    .maybeSingle();
  if (error || !data?.value) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(data.value);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function cronUnauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
