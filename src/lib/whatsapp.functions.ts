import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_BASE = "http://15.207.87.63:3000";
const MAX_TOTAL_MESSAGES = 7;
const MAX_TOKEN_UPDATES = 3;
const DISCLAIMER =
  "Note: All stated times are tentative appointment times and may shift with live queue movement.";
const WARM_CONNECT_TEXT =
  "Hello! This is your clinic. We will be using this number to send your appointment updates and queue status. Please reply with 'ok' to confirm you have received this message.";

type Variant =
  | "confirmation"
  | "next_in_line"
  | "doctor_arrived"
  | "token_update"
  | "reminder_24h"
  | "shift_update";

function fmtTime12(value: string | null | undefined): string {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return "";
  const [h, m] = value.split(":");
  const h24 = parseInt(h, 10);
  const mer = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${mer}`;
}

function doctorLabel(name: string, specialty: string | null | undefined): string {
  const spec = (specialty ?? "").trim();
  return spec ? `Dr. ${name} (${spec})` : `Dr. ${name}`;
}

export function buildMessage(params: {
  variant: Variant;
  patientName: string;
  doctorName: string;
  doctorSpecialty: string | null;
  clinicName: string;
  clinicAddress: string;
  clinicMobile: string | null;
  date: string;
  time: string | null;
  runningTokenNumber: number | null;
  latestTokenNumber: number | null;
  tentativeTime?: string | null;
  delayMinutes?: number | null;
}): string {
  const timeStr = fmtTime12(params.time);
  const contact = params.clinicMobile ? ` Contact: ${params.clinicMobile}.` : "";
  const location = `Full Clinic Address / Google Map Link: ${params.clinicAddress}.${contact}`;
  const base = `Hello ${params.patientName},`;
  const doc = doctorLabel(params.doctorName, params.doctorSpecialty);
  const dt = `Date: ${params.date}${timeStr ? ` | Time: ${timeStr}` : ""}`;
  const tokens =
    params.runningTokenNumber != null || params.latestTokenNumber != null
      ? `Currently in treatment: Token #${params.runningTokenNumber ?? "—"}. Your latest token: #${
          params.latestTokenNumber ?? "—"
        }.`
      : "";

  switch (params.variant) {
    case "confirmation":
      return `${base} your appointment at ${params.clinicName} with ${doc} is confirmed.\n${dt}\n${location}\n\n${DISCLAIMER}`;
    case "reminder_24h":
      return `${base} reminder — your appointment at ${params.clinicName} with ${doc} is tomorrow.\n${dt}\n${tokens}\n${location}\n\n${DISCLAIMER}`;
    case "doctor_arrived":
      return `${base} ${doc} has arrived at ${params.clinicName} and consultations are starting.\n${dt}\n${tokens}\n${location}\n\n${DISCLAIMER}`;
    case "next_in_line":
      return `${base} you are next in line for ${doc} at ${params.clinicName}. Please be ready.\n${dt}\n${tokens}\n${location}\n\n${DISCLAIMER}`;
    case "token_update": {
      const timing = params.tentativeTime
        ? `Your tentative time with ${doc} is now ${params.tentativeTime}.`
        : `Queue update from ${doc} at ${params.clinicName}.`;
      return `${base} ${timing}\n${dt}\n${tokens}\n${location}\n\n${DISCLAIMER}`;
    }
    case "shift_update": {
      const delay = params.delayMinutes && params.delayMinutes > 0
        ? `Doctor shift is delayed by ${params.delayMinutes} minutes.`
        : `Doctor shift is on time.`;
      const newTime = params.tentativeTime ? ` Your updated tentative time: ${params.tentativeTime}.` : "";
      return `${base} ${delay}${newTime}\n${dt}\n${tokens}\n${location}\n\n${DISCLAIMER}`;
    }
  }
}

async function postToGateway(clinicId: string, phone10: string, message: string) {
  try {
    const res = await fetch(`${GATEWAY_BASE}/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinicId, phone: `91${phone10}`, message }),
    });
    return { ok: res.ok, status: res.status };
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message ?? "network error" };
  }
}

async function clinicIsConnected(supabase: any, clinicId: string): Promise<boolean> {
  const { data } = await supabase.from("clinics").select("whatsapp_connected").eq("id", clinicId).maybeSingle();
  return Boolean((data as any)?.whatsapp_connected);
}

async function computeQueueContext(
  supabase: any,
  clinicId: string,
  doctorId: string | null,
  appointmentDate: string,
) {
  let q = supabase
    .from("tokens")
    .select("id, token_number, appointment_time, created_at, status")
    .eq("clinic_id", clinicId)
    .eq("appointment_date", appointmentDate)
    .neq("status", "cancelled");
  q = doctorId ? q.eq("doctor_id", doctorId) : q.is("doctor_id", null);
  const { data } = await q;
  const rows = ((data as any[]) ?? []).slice().sort((a, b) => {
    const at = a.appointment_time ?? "99:99";
    const bt = b.appointment_time ?? "99:99";
    if (at !== bt) return at.localeCompare(bt);
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
  const displayToken = new Map<string, number>();
  rows.forEach((r, i) => displayToken.set(r.id, i + 1));
  const active = rows.find((r) => r.status === "in_consultation");
  const runningTokenNumber = active ? displayToken.get(active.id) ?? null : null;
  return { displayToken, runningTokenNumber };
}

export const sendWhatsAppMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tokenId: string; variant: Variant; tentativeTime?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: tokenRow, error: tokErr } = await supabase
      .from("tokens").select("*").eq("id", data.tokenId).maybeSingle();
    if (tokErr || !tokenRow) return { ok: false as const, error: tokErr?.message ?? "Token not found" };
    const t = tokenRow as any;

    if (!(await clinicIsConnected(supabase, t.clinic_id))) {
      return { ok: false as const, error: "WhatsApp not connected for this clinic" };
    }

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

    const [clinicRes, doctorRes] = await Promise.all([
      supabase.from("clinics").select("name, address, clinic_mobile").eq("id", t.clinic_id).maybeSingle(),
      t.doctor_id
        ? supabase.from("doctors").select("name, specialty").eq("id", t.doctor_id).maybeSingle()
        : Promise.resolve({ data: null as any, error: null }),
    ]);
    const clinic = (clinicRes.data ?? { name: "our clinic", address: "—", clinic_mobile: null }) as any;
    const doctor = (doctorRes.data ?? { name: "your doctor", specialty: null }) as any;

    const ctx = await computeQueueContext(supabase, t.clinic_id, t.doctor_id, t.appointment_date);
    const latest = ctx.displayToken.get(t.id) ?? t.token_number ?? null;

    const message = buildMessage({
      variant: data.variant,
      patientName: t.patient_name,
      doctorName: doctor?.name ?? "your doctor",
      doctorSpecialty: doctor?.specialty ?? null,
      clinicName: clinic.name,
      clinicAddress: clinic.address,
      clinicMobile: clinic.clinic_mobile,
      date: t.appointment_date,
      time: t.appointment_time,
      runningTokenNumber: ctx.runningTokenNumber,
      latestTokenNumber: latest,
      tentativeTime: data.tentativeTime ?? null,
    });

    const result = await postToGateway(t.clinic_id, t.phone_number, message);
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

export const sendDoctorArrivedForDoctor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { doctorId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const now = new Date();
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const { data: rows, error } = await supabase
      .from("tokens")
      .select("id, patient_name, phone_number, token_number, clinic_id, doctor_id, appointment_date, appointment_time, whatsapp_messages_sent, doctor_arrived_sent_at, status")
      .eq("doctor_id", data.doctorId)
      .eq("appointment_date", todayISO)
      .eq("status", "waiting")
      .is("doctor_arrived_sent_at", null);
    if (error) return { ok: false as const, error: error.message };
    if (!rows || rows.length === 0) return { ok: true as const, sent: 0 };

    const clinicId = (rows[0] as any).clinic_id as string;

    if (!(await clinicIsConnected(supabase, clinicId))) {
      return { ok: false as const, error: "WhatsApp not connected for this clinic" };
    }

    const [clinicRes, doctorRes] = await Promise.all([
      supabase.from("clinics").select("name, address, clinic_mobile").eq("id", clinicId).maybeSingle(),
      supabase.from("doctors").select("name, specialty").eq("id", data.doctorId).maybeSingle(),
    ]);
    const clinic = (clinicRes.data ?? { name: "our clinic", address: "—", clinic_mobile: null }) as any;
    const doctor = (doctorRes.data ?? { name: "your doctor", specialty: null }) as any;

    const ctx = await computeQueueContext(supabase, clinicId, data.doctorId, todayISO);

    let sent = 0;
    for (const raw of rows) {
      const t = raw as any;
      if ((t.whatsapp_messages_sent ?? 0) >= MAX_TOTAL_MESSAGES) continue;
      const latest = ctx.displayToken.get(t.id) ?? t.token_number ?? null;
      const msg = buildMessage({
        variant: "doctor_arrived",
        patientName: t.patient_name,
        doctorName: doctor.name,
        doctorSpecialty: doctor.specialty ?? null,
        clinicName: clinic.name,
        clinicAddress: clinic.address,
        clinicMobile: clinic.clinic_mobile,
        date: t.appointment_date,
        time: t.appointment_time,
        runningTokenNumber: ctx.runningTokenNumber,
        latestTokenNumber: latest,
      });
      const res = await postToGateway(clinicId, t.phone_number, msg);
      if (!res.ok) continue;
      await (supabase.from("tokens") as any).update({
        whatsapp_messages_sent: (t.whatsapp_messages_sent ?? 0) + 1,
        doctor_arrived_sent_at: new Date().toISOString(),
      }).eq("id", t.id);
      sent += 1;
    }
    return { ok: true as const, sent };
  });

export const advanceQueueNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { doctorId: string | null; appointmentDate: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    let q = supabase
      .from("tokens")
      .select("id, token_number, appointment_time, created_at, clinic_id, whatsapp_messages_sent, token_update_count, last_position_notified")
      .eq("appointment_date", data.appointmentDate)
      .eq("status", "waiting");
    q = data.doctorId ? q.eq("doctor_id", data.doctorId) : q.is("doctor_id", null);
    const { data: waiting, error } = await q;
    if (error || !waiting) return { ok: false as const, error: error?.message ?? "Load failed" };

    const sorted = (waiting as any[]).slice().sort((a, b) => {
      const at = a.appointment_time ?? "99:99";
      const bt = b.appointment_time ?? "99:99";
      if (at !== bt) return at.localeCompare(bt);
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });

    const [clinicRow, doctorRow] = await Promise.all([
      supabase.from("clinics").select("avg_time_per_patient").maybeSingle(),
      data.doctorId
        ? supabase.from("doctors").select("avg_time_per_patient").eq("id", data.doctorId).maybeSingle()
        : Promise.resolve({ data: null as any, error: null }),
    ]);
    const clinicAvg = ((clinicRow.data as any)?.avg_time_per_patient ?? null) as number | null;
    const doctorAvg = ((doctorRow.data as any)?.avg_time_per_patient ?? null) as number | null;
    const avg = doctorAvg ?? clinicAvg;

    const results: Array<{ tokenId: string; position: number; queued: boolean; reason?: string }> = [];
    const queued: Array<{ tokenId: string; variant: Variant; tentativeTime: string | null }> = [];

    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i] as any;
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

      let tentative: string | null = null;
      if (avg && avg > 0) {
        const eta = new Date(Date.now() + position * avg * 60_000);
        const h = eta.getHours(), m = eta.getMinutes();
        const mer = h >= 12 ? "PM" : "AM";
        const h12 = h % 12 === 0 ? 12 : h % 12;
        tentative = `${h12}:${String(m).padStart(2, "0")} ${mer}`;
      }

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

export const applyDoctorShiftStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { doctorId: string; status: "on_time" | "delayed"; delayMinutes?: number }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const delayMinutes = data.status === "delayed" ? Math.max(1, Math.min(480, Math.floor(data.delayMinutes ?? 0))) : 0;
    if (data.status === "delayed" && delayMinutes === 0) return { ok: false as const, error: "Delay minutes required" };

    const { data: rows } = await supabase
      .from("tokens")
      .select("id, clinic_id, doctor_id, patient_name, phone_number, token_number, appointment_date, appointment_time, whatsapp_messages_sent, created_at")
      .eq("doctor_id", data.doctorId)
      .eq("appointment_date", todayISO)
      .eq("status", "waiting");
    const tokens = (rows as any[]) ?? [];
    if (tokens.length === 0) return { ok: false as const, error: "No waiting patients today for this doctor" };

    const sorted = tokens.slice().sort((a, b) => (a.appointment_time ?? "").localeCompare(b.appointment_time ?? ""));
    const first = sorted[0].appointment_time as string | null;
    if (!first || !/^\d{1,2}:\d{2}$/.test(first)) return { ok: false as const, error: "First appointment has no valid time" };
    const [fh, fm] = first.split(":").map((n) => parseInt(n, 10));
    const firstDT = new Date(); firstDT.setHours(fh, fm, 0, 0);
    const cutoff = new Date(firstDT.getTime() - 45 * 60_000);
    if (now > cutoff) return { ok: false as const, error: "Must submit at least 45 minutes before the first appointment" };

    const clinicId = tokens[0].clinic_id as string;
    await (supabase.from("doctor_shift_status") as any)
      .upsert({
        clinic_id: clinicId, doctor_id: data.doctorId, shift_date: todayISO,
        status: data.status, delay_minutes: delayMinutes, created_by: userId,
      }, { onConflict: "doctor_id,shift_date" });

    if (delayMinutes > 0) {
      for (const t of tokens) {
        if (!t.appointment_time) continue;
        const [h, m] = String(t.appointment_time).split(":").map((n) => parseInt(n, 10));
        const dt = new Date(); dt.setHours(h, m + delayMinutes, 0, 0);
        const newTime = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
        await supabase.from("tokens").update({ appointment_time: newTime }).eq("id", t.id);
        t.appointment_time = newTime;
      }
    }

    const connected = await clinicIsConnected(supabase, clinicId);
    const [clinicRes, doctorRes] = await Promise.all([
      supabase.from("clinics").select("name, address, clinic_mobile").eq("id", clinicId).maybeSingle(),
      supabase.from("doctors").select("name, specialty").eq("id", data.doctorId).maybeSingle(),
    ]);
    const clinic = (clinicRes.data ?? { name: "our clinic", address: "—", clinic_mobile: null }) as any;
    const doctor = (doctorRes.data ?? { name: "your doctor", specialty: null }) as any;

    let sent = 0;
    if (connected) {
      const ctx = await computeQueueContext(supabase, clinicId, data.doctorId, todayISO);
      for (const t of tokens) {
        if ((t.whatsapp_messages_sent ?? 0) >= MAX_TOTAL_MESSAGES) continue;
        const latest = ctx.displayToken.get(t.id) ?? t.token_number ?? null;
        const msg = buildMessage({
          variant: "shift_update",
          patientName: t.patient_name,
          doctorName: doctor.name,
          doctorSpecialty: doctor.specialty ?? null,
          clinicName: clinic.name,
          clinicAddress: clinic.address,
          clinicMobile: clinic.clinic_mobile,
          date: t.appointment_date,
          time: t.appointment_time,
          runningTokenNumber: ctx.runningTokenNumber,
          latestTokenNumber: latest,
          tentativeTime: t.appointment_time ? fmtTime12(t.appointment_time) : null,
          delayMinutes,
        });
        const res = await postToGateway(clinicId, t.phone_number, msg);
        if (!res.ok) continue;
        await (supabase.from("tokens") as any).update({
          whatsapp_messages_sent: (t.whatsapp_messages_sent ?? 0) + 1,
        }).eq("id", t.id);
        sent += 1;
      }
    }

    return { ok: true as const, sent, shifted: delayMinutes > 0 ? tokens.length : 0, gatewayConfigured: connected };
  });

/**
 * Server-side proxy to the AWS gateway /connect endpoint. Also mirrors
 * `already_connected` status into the clinics table.
 */
export const connectWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clinicId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    try {
      const res = await fetch(`${GATEWAY_BASE}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId: data.clinicId }),
      });
      const text = await res.text();
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }

      if (body?.status === "already_connected") {
        await (supabase.from("clinics") as any).update({ whatsapp_connected: true }).eq("id", data.clinicId);
      }
      return { ok: res.ok as const, status: res.status, body };
    } catch (e: any) {
      return { ok: false as const, status: 0, error: e?.message ?? "network error" };
    }
  });

/**
 * Warm-connect / test initial message. Uses the exact required text.
 */
export const sendWarmConnectMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const phone10 = (data.phone ?? "").replace(/\D/g, "").slice(-10);
    if (!/^[0-9]{10}$/.test(phone10)) return { ok: false as const, error: "Enter a valid 10-digit phone number" };

    const { data: recep } = await supabase
      .from("receptionists").select("clinic_id").eq("user_id", userId).maybeSingle();
    const clinicId = (recep as any)?.clinic_id as string | undefined;
    if (!clinicId) return { ok: false as const, error: "No clinic linked to your account" };

    if (!(await clinicIsConnected(supabase, clinicId))) {
      return { ok: false as const, error: "Link WhatsApp first from the WhatsApp Setup section." };
    }

    const res = await postToGateway(clinicId, phone10, WARM_CONNECT_TEXT);
    if (!res.ok) return { ok: false as const, status: res.status, error: `Send failed (${res.status})` };
    return { ok: true as const, status: res.status };
  });
