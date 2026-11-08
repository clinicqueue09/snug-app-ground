import { createFileRoute } from "@tanstack/react-router";
import { dispatchNotification } from "@/lib/whatsapp.functions";
import { inReminderWindow, tomorrowISTString } from "@/lib/doctor-delay";
import { verifyCronSecret, cronUnauthorized } from "@/lib/cron-auth";

export const Route = createFileRoute("/api/public/hooks/whatsapp-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await verifyCronSecret(request))) return cronUnauthorized();

        if (!inReminderWindow()) {
          return new Response(JSON.stringify({ ok: true, sent: 0, reason: "outside reminder window" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const tomorrow = tomorrowISTString();

        const { data: tokens, error } = await supabaseAdmin
          .from("tokens")
          .select("id")
          .eq("appointment_date", tomorrow)
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
