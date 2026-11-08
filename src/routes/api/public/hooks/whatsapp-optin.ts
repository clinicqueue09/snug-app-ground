import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/hooks/whatsapp-optin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.WHATSAPP_OPTIN_SECRET;
        if (!secret) {
          return new Response(JSON.stringify({ ok: false, error: "Webhook secret not configured" }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
        const provided = request.headers.get("x-webhook-secret") ?? "";
        if (!safeEqual(provided, secret)) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401, headers: { "Content-Type": "application/json" },
          });
        }

        let payload: any = {};
        try { payload = await request.json(); } catch {
          return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }

        const clinicId = String(payload?.clinicId ?? "").trim();
        const rawPhone = String(payload?.phone ?? "").replace(/\D/g, "");
        const phone10 = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;
        if (!/^[0-9a-f-]{36}$/i.test(clinicId) || !/^[0-9]{10}$/.test(phone10)) {
          return new Response(JSON.stringify({ ok: false, error: "clinicId (uuid) and 10-digit phone required" }), {
            status: 400, headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: existing, error: exErr } = await supabaseAdmin
          .from("whatsapp_optins" as any).select("id")
          .eq("clinic_id", clinicId).eq("phone_number", phone10).maybeSingle();
        if (exErr) {
          return new Response(JSON.stringify({ ok: false, error: exErr.message }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
        const { error } = await supabaseAdmin
          .from("whatsapp_optins" as any)
          .upsert({ clinic_id: clinicId, phone_number: phone10 } as any, { onConflict: "clinic_id,phone_number" });
        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
        if (!existing) {
          try {
            const { todayISTString } = await import("@/lib/token-note");
            const { dispatchNotification } = await import("@/lib/whatsapp.functions");
            const { data: toks, error: tErr } = await supabaseAdmin
              .from("tokens").select("id, phone_number, appointment_date, appointment_time")
              .eq("clinic_id", clinicId).eq("status", "waiting")
              .gte("appointment_date", todayISTString())
              .order("appointment_date", { ascending: true })
              .order("appointment_time", { ascending: true, nullsFirst: false });
            if (tErr) throw tErr;
            const next = (toks ?? []).find((r: any) => String(r.phone_number ?? "").replace(/\D/g, "").slice(-10) === phone10);
            if (next) {
              const r = await dispatchNotification(supabaseAdmin, { tokenId: (next as any).id, messageType: "confirmation" });
              if (!r.ok) console.error("[whatsapp-optin] welcome send failed:", r.error);
            }
          } catch (e: any) {
            console.error("[whatsapp-optin] welcome send error:", e?.message ?? e);
          }
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
