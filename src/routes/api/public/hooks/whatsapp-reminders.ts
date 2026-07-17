import { createFileRoute } from "@tanstack/react-router";

const GATEWAY_BASE = "http://15.207.87.63:3000";
const DISCLAIMER = "Note: All stated times are tentative appointment times and may shift with live queue movement.";
const MAX_TOTAL_MESSAGES = 7;

function fmtTime12(value: string | null | undefined): string {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return "";
  const [h, m] = value.split(":");
  const h24 = parseInt(h, 10);
  const mer = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${mer}`;
}
function doctorLabel(name: string, specialty: string | null | undefined) {
  const spec = (specialty ?? "").trim();
  return spec ? `Dr. ${name} (${spec})` : `Dr. ${name}`;
}
function combineDT(dateISO: string, time: string | null): Date | null {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  const d = new Date(`${dateISO}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d;
}
async function postToGateway(clinicId: string, phone10: string, message: string) {
  try {
    const res = await fetch(`${GATEWAY_BASE}/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicId, phone: `91${phone10}`, message }),
    });
    return res.ok;
  } catch { return false; }
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
          .select("id, clinic_id, doctor_id, patient_name, phone_number, token_number, appointment_date, appointment_time, whatsapp_messages_sent, status, reminder_24h_sent_at")
          .in("appointment_date", Array.from(new Set([startDate, endDate])))
          .eq("status", "waiting")
          .is("reminder_24h_sent_at", null);

        if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
        if (!tokens || tokens.length === 0) return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { "Content-Type": "application/json" } });

        const clinicIds = Array.from(new Set(tokens.map((t: any) => t.clinic_id)));
        const doctorIds = Array.from(new Set(tokens.map((t: any) => t.doctor_id).filter(Boolean)));

        const [clinicsRes, doctorsRes] = await Promise.all([
          supabaseAdmin.from("clinics").select("id, name, address, clinic_mobile, whatsapp_connected").in("id", clinicIds),
          doctorIds.length
            ? supabaseAdmin.from("doctors").select("id, name, specialty").in("id", doctorIds)
            : Promise.resolve({ data: [] as any[], error: null }),
        ]);
        const clinicMap = new Map((clinicsRes.data ?? []).map((c: any) => [c.id, c]));
        const doctorMap = new Map((doctorsRes.data ?? []).map((d: any) => [d.id, d]));

        let sent = 0;
        for (const raw of tokens) {
          const t = raw as any;
          const eta = combineDT(t.appointment_date, t.appointment_time);
          if (!eta) continue;
          if (eta.getTime() < windowStart.getTime() || eta.getTime() > windowEnd.getTime()) continue;
          if ((t.whatsapp_messages_sent ?? 0) >= MAX_TOTAL_MESSAGES) continue;

          const clinic = clinicMap.get(t.clinic_id) as any;
          if (!clinic || !clinic.whatsapp_connected) continue;
          const doctor = t.doctor_id ? (doctorMap.get(t.doctor_id) as any) : null;

          const contact = clinic.clinic_mobile ? ` Contact: ${clinic.clinic_mobile}.` : "";
          const doc = doctorLabel(doctor?.name ?? "your doctor", doctor?.specialty ?? null);
          const timeStr = fmtTime12(t.appointment_time);
          const message = `Hello ${t.patient_name}, reminder — your appointment at ${clinic.name} with ${doc} is tomorrow.\nDate: ${t.appointment_date}${timeStr ? ` | Time: ${timeStr}` : ""}\nYour latest token: #${t.token_number}.\nFull Clinic Address / Google Map Link: ${clinic.address}.${contact}\n\n${DISCLAIMER}`;

          const ok = await postToGateway(t.clinic_id, t.phone_number, message);
          if (!ok) continue;
          await (supabaseAdmin.from("tokens") as any).update({
            whatsapp_messages_sent: (t.whatsapp_messages_sent ?? 0) + 1,
            reminder_24h_sent_at: new Date().toISOString(),
          }).eq("id", t.id);
          sent += 1;
        }

        return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
      },
    },
  },
});
