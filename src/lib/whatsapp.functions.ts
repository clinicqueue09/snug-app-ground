import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MAX_TOTAL_MESSAGES = 7;
const MAX_TOKEN_UPDATES = 3;
const DISCLAIMER = "Note: The appointment time provided is tentative and subject to change based on the live movement of the clinic queue.";

type Variant = "confirmation" | "next_in_line" | "doctor_arrived" | "token_update" | "reminder_24h";

function fmtTime12(value: string | null | undefined): string {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return "";
  const [h, m] = value.split(":");
  const h24 = parseInt(h, 10);
  const mer = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${mer}`;
}

function buildMessage(params: {
  variant: Variant;
  patientName: string; doctorName: string;
  clinicName: string; clinicAddress: string; clinicMobile: string | null;
  date: string; time: string | null; tokenNumber: number;
  tentativeTime?: string | null;
}): string {
  const timeStr = fmtTime12(params.time);
  const contact = params.clinicMobile ? ` Contact: ${params.clinicMobile}.` : "";
  const location = ` Location: ${params.clinicAddress}.${contact}`;
  const base = `Hello ${params.patientName},`;

  switch (params.variant) {
    case "confirmation":
      return `${base} your appointment at ${params.clinicName} with Dr. ${params.doctorName} is confirmed for ${params.date}${timeStr ? ` at ${timeStr}` : ""}. Your Token is #${params.tokenNumber}.${location}\n\n${DISCLAIMER}`;
    case "reminder_24h":
      return `${base} reminder: your appointment at ${params.clinicName} with Dr. ${params.doctorName} is tomorrow, ${params.date}${timeStr ? ` at ${timeStr}` : ""}. Your Token is #${params.tokenNumber}.${location}\n\n${DISCLAIMER}`;
    case "doctor_arrived":
      return `${base} Dr. ${params.doctorName} has arrived at ${params.clinicName} and consultations are starting. Your Token is #${params.tokenNumber}.${location}`;
    case "next_in_line":
      return `${base} you are next in line for Dr. ${params.doctorName} at ${params.clinicName}. Your Token is #${params.tokenNumber}. Please be ready.${location}\n\n${DISCLAIMER}`;
    case "token_update":
      return `${base} queue update — your tentative appointment time with Dr. ${params.doctorName} at ${params.clinicName} is now ${params.tentativeTime ?? "shortly"}. Your Token is #${params.tokenNumber}.${location}\n\n${DISCLAIMER}`;
  }
}

async function postToTunnel(tunnelUrl: string, phone10: string, message: string) {
  const endpoint = tunnelUrl.replace(/\/+$/, "") + "/send-message";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Bypass-Tunnel-Reminder": "true" },
    body: JSON.stringify({ phone: `91${phone10}`, message }),
  });
  return { ok: res.ok, status: res.status };
}

export const sendWhatsAppMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tokenId: string; variant: Variant; tentativeTime?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: tokenRow, error: tokErr } = await supabase
      .from("tokens")
      .select("*")
      .eq("id", data.tokenId)
      .maybeSingle();
    if (tokErr || !tokenRow) return { ok: false as const, error: tokErr?.message ?? "Token not found" };
    const t = tokenRow as any;

    if ((t.whatsapp_messages_sent ?? 0) >= MAX_TOTAL_MESSAGES) {
      return { ok: false as const, error: `Message cap reached (${MAX_TOTAL_MESSAGES}/patient).` };
    }
    if (data.variant === "reminder_24h" && t.reminder_24h_sent_at) {
      return { ok: false as const, error: "24h reminder already sent." };
    }
    if (data.variant === "doctor_arrived") {
      if (t.doctor_arrived_sent_at) return { ok: false as const, error: "Doctor-arrived alert already sent." };
      const now = new Date();
      const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      if (t.appointment_date !== todayISO) {
        return { ok: false as const, error: "Doctor-arrived can only be sent on the appointment date." };
      }
    }
    if (data.variant === "token_update" && (t.token_update_count ?? 0) >= MAX_TOKEN_UPDATES) {
      return { ok: false as const, error: `Token-update cap reached (${MAX_TOKEN_UPDATES}/patient).` };
    }

    const [clinicRes, doctorRes, settingsRes] = await Promise.all([
      supabase.from("clinics").select("name, address, clinic_mobile").eq("id", t.clinic_id).maybeSingle(),
      t.doctor_id
        ? supabase.from("doctors").select("name").eq("id", t.doctor_id).maybeSingle()
        : Promise.resolve({ data: null as any, error: null }),
      supabase.from("clinic_settings").select("tunnel_url").eq("clinic_id", t.clinic_id).maybeSingle(),
    ]);
    const clinic = (clinicRes.data ?? { name: "our clinic", address: "—", clinic_mobile: null }) as any;
    const doctor = (doctorRes.data ?? { name: "your doctor" }) as any;
    const tunnelUrl = (settingsRes.data as { tunnel_url: string | null } | null)?.tunnel_url?.trim();
    if (!tunnelUrl) return { ok: false as const, error: "WhatsApp tunnel URL not configured" };

    const message = buildMessage({
      variant: data.variant,
      patientName: t.patient_name,
      doctorName: doctor?.name ?? "your doctor",
      clinicName: clinic.name,
      clinicAddress: clinic.address,
      clinicMobile: clinic.clinic_mobile,
      date: t.appointment_date,
      time: t.appointment_time,
      tokenNumber: t.token_number,
      tentativeTime: data.tentativeTime ?? null,
    });

    const result = await postToTunnel(tunnelUrl, t.phone_number, message);
    if (!result.ok) return { ok: false as const, status: result.status, error: `Send failed (${result.status})` };

    const patch: Record<string, unknown> = {
      whatsapp_messages_sent: (t.whatsapp_messages_sent ?? 0) + 1,
    };
    if (data.variant === "reminder_24h") patch.reminder_24h_sent_at = new Date().toISOString();
    if (data.variant === "doctor_arrived") patch.doctor_arrived_sent_at = new Date().toISOString();
    if (data.variant === "token_update") patch.token_update_count = (t.token_update_count ?? 0) + 1;

    await (supabase.from("tokens") as any).update(patch).eq("id", t.id);
    return { ok: true as const, status: result.status };
  });

/**
 * After the queue advances, recompute waiting positions for a doctor+date and
 * send token_update or next_in_line messages. Adaptive gap ensures at most 3
 * token-updates per patient (immediate-next always attempts to send subject
 * only to the 7-message cap).
 */
export const advanceQueueNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { doctorId: string | null; appointmentDate: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    let q = supabase
      .from("tokens")
      .select("id, token_number, whatsapp_messages_sent, token_update_count, last_position_notified")
      .eq("appointment_date", data.appointmentDate)
      .eq("status", "waiting")
      .order("token_number", { ascending: true });
    q = data.doctorId ? q.eq("doctor_id", data.doctorId) : q.is("doctor_id", null);
    const { data: waiting, error } = await q;
    if (error || !waiting) return { ok: false as const, error: error?.message ?? "Load failed" };

    const { data: clinicRow } = await supabase.from("clinics").select("avg_time_per_patient").maybeSingle();
    const avg = ((clinicRow as any)?.avg_time_per_patient ?? 10) as number;

    const results: Array<{ tokenId: string; position: number; queued: boolean; reason?: string }> = [];
    const queued: Array<{ tokenId: string; variant: Variant; tentativeTime: string }> = [];

    for (let i = 0; i < waiting.length; i++) {
      const t = waiting[i] as any;
      const position = i + 1;
      const used = t.token_update_count ?? 0;
      const total = t.whatsapp_messages_sent ?? 0;
      if (total >= MAX_TOTAL_MESSAGES) { results.push({ tokenId: t.id, position, queued: false, reason: "cap" }); continue; }

      const isImmediateNext = position === 1;
      let should = false;
      if (isImmediateNext) {
        should = t.last_position_notified !== 1;
      } else if (used < MAX_TOKEN_UPDATES) {
        const prev = t.last_position_notified ?? Number.POSITIVE_INFINITY;
        const remainingBudget = MAX_TOKEN_UPDATES - used;
        const requiredGap = Math.max(1, Math.ceil(remainingBudget));
        if (prev - position >= requiredGap) should = true;
      }
      if (!should) { results.push({ tokenId: t.id, position, queued: false, reason: "gap" }); continue; }

      const eta = new Date(Date.now() + position * avg * 60_000);
      const h = eta.getHours(), m = eta.getMinutes();
      const mer = h >= 12 ? "PM" : "AM";
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const tentative = `${h12}:${String(m).padStart(2, "0")} ${mer}`;

      queued.push({
        tokenId: t.id,
        variant: isImmediateNext ? "next_in_line" : "token_update",
        tentativeTime: tentative,
      });
      await (supabase.from("tokens") as any).update({ last_position_notified: position }).eq("id", t.id);
      results.push({ tokenId: t.id, position, queued: true });
    }

    return { ok: true as const, queued, results };
  });
