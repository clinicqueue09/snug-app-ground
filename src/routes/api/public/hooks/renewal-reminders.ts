import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Sends in-app platform notifications to clinics whose trial or subscription
// ends exactly 7 days from today. Idempotent per (clinic, kind, target_date).
export const Route = createFileRoute("/api/public/hooks/renewal-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization")?.replace("Bearer ", "");
        const apiKey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY!;
        if (auth !== expected && apiKey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        const url = process.env.SUPABASE_URL!;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

        const target = new Date();
        target.setUTCHours(0, 0, 0, 0);
        target.setUTCDate(target.getUTCDate() + 7);
        const start = new Date(target); // day start
        const end = new Date(target); end.setUTCDate(end.getUTCDate() + 1);
        const targetDate = start.toISOString().slice(0, 10);

        const { data: clinics, error } = await admin
          .from("clinics")
          .select("id, name, status, trial_ends_at")
          .gte("trial_ends_at", start.toISOString())
          .lt("trial_ends_at", end.toISOString());

        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

        let inserted = 0;
        for (const c of clinics ?? []) {
          const kind = c.status === "trial" ? "trial_expiring" : "subscription_expiring";
          // idempotent check
          const { data: existing } = await admin
            .from("platform_notifications")
            .select("id")
            .eq("clinic_id", c.id)
            .eq("kind", kind)
            .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .maybeSingle();
          if (existing) continue;
          const title = c.status === "trial" ? "Trial ending in 7 days" : "Subscription renewing in 7 days";
          const body = `Your ${c.status === "trial" ? "free trial" : "current subscription"} ends on ${targetDate}. Please upgrade to avoid service disruption.`;
          const { error: insErr } = await admin.from("platform_notifications").insert({
            clinic_id: c.id, kind, title, body,
          });
          if (!insErr) inserted++;
        }

        return new Response(JSON.stringify({ ok: true, processed: clinics?.length ?? 0, inserted }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
