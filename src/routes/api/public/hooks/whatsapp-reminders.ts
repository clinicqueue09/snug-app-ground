import { createFileRoute } from "@tanstack/react-router";
import { dispatchNotification } from "@/lib/whatsapp.functions";

function combineDT(dateISO: string, time: string | null): Date | null {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  const d = new Date(`${dateISO}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}

export const Route = createFileRoute("/api/public/hooks/whatsapp-reminders")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const now = Date.now();
        const windowStart = new Date(now + (24 * 60 - 15) * 60_000);
        const windowEnd = new Date(now + (24 * 60 + 15) * 60_000);
        const startDate = windowStart.toISOString().slice(0, 10);
        const endDate = windowEnd.toISOString().slice(0, 10);

        const { data: tokens, error } = await supabaseAdmin
          .from("tokens")
          .select("id, appointment_date, appointment_time, status, reminder_24h_sent_at")
          .in("appointment_date", Array.from(new Set([startDate, endDate])))
          .eq("status", "waiting")
          .is("reminder_24h_sent_at", null);

        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
        if (!tokens || tokens.length === 0) {
          return new Response(JSON.stringify({ ok: true, sent: 0 }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        let sent = 0;
        for (const raw of tokens) {
          const t = raw as any;
          const eta = combineDT(t.appointment_date, t.appointment_time);
          if (!eta) continue;
          if (eta.getTime() < windowStart.getTime() || eta.getTime() > windowEnd.getTime()) continue;

          const result = await dispatchNotification(supabaseAdmin, {
            tokenId: t.id,
            messageType: "reminder_24h",
          });
          if (result.ok) sent += 1;
        }

        return new Response(JSON.stringify({ ok: true, sent }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
