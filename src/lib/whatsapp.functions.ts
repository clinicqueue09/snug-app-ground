import { tokenNoteFor, todayISTString, formatDateIN } from "./token-note";
import { validateDelta, nextCumulative, delayNotifyDecision, shiftTime } from "./doctor-delay";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendSmsRaw } from "@/lib/sms.functions";
import { hasPreviousAppointment, notificationChannel } from "@/lib/notification-routing";

// The WhatsApp gateway lives on a bare IP. Edge runtimes (the preview/worker
// environment) refuse direct-IP fetches with Cloudflare's "error code: 1003"
// (Direct IP access not allowed), so address it via an nip.io hostname alias
// that resolves to the same server, and fall back to the raw IP on failure.
const GATEWAY_BASE = "http://13.204.59.137.nip.io:3000";
const GATEWAY_FALLBACK_BASE = "http://13.204.59.137:3000";

const readGatewayApiKey = createServerOnlyFn(() => process.env["GATEWAY_API_KEY"]);

function requireGatewayApiKey(): string {
  const apiKey = readGatewayApiKey();
  if (!apiKey) {
    const error = "GATEWAY_API_KEY is not configured; WhatsApp gateway requests are disabled.";
    console.error(`[whatsapp gateway] ${error}`);
    throw new Error(error);
  }
  return apiKey;
}

/** Fetch the WhatsApp gateway, retrying via the raw IP if the hostname path is blocked. */
async function gatewayFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-gateway-key", requireGatewayApiKey());
  const requestInit = { ...init, headers };
  try {
    const res = await fetch(`${GATEWAY_BASE}${path}`, requestInit);
    if (res.status === 403 || res.status === 502) throw new Error(`gateway blocked (${res.status})`);
    return res;
  } catch {
    return fetch(`${GATEWAY_FALLBACK_BASE}${path}`, requestInit);
  }
}
const MAX_TOTAL_MESSAGES = 7;
const MAX_TOKEN_UPDATES = 3;
const SIGNATURE = "— Powered by ClinicQ";
const DISCLAIMER =
  "Note: All stated times are tentative appointment times and may shift with live queue movement.";

function withSig(msg: string) {
  return msg.trimEnd() + `\n\n${SIGNATURE}`;
}

type Variant =
  | "confirmation"
  | "next_in_line"
  | "doctor_arrived"
  | "token_update"
  | "reminder_24h"
  | "shift_update"
  | "rescheduled";

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
  clinicMapLink: string | null;
  clinicMobile: string | null;
  date: string;
  time: string | null;
  runningTokenNumber: number | null;
  latestTokenNumber: number | null;
  tentativeTime?: string | null;
  delayMinutes?: number | null;
  tokenNote?: string | null;
}): string {
  const timeStr = fmtTime12(params.time);
  const contact = params.clinicMobile ? ` Contact: ${params.clinicMobile}.` : "";
  const location =
    `Clinic Address: ${params.clinicAddress}.${contact}` +
    (params.clinicMapLink ? `\nLocation: ${params.clinicMapLink}` : "");
  const base = `Hello ${params.patientName},`;
  const doc = doctorLabel(params.doctorName, params.doctorSpecialty);
  const dt = `Date: ${params.date}${timeStr ? ` | Time: ${timeStr}` : ""}`;
  const tokens =
    params.runningTokenNumber != null || params.latestTokenNumber != null
      ? `Currently in treatment: Token #${params.runningTokenNumber ?? "—"}. Your latest token: #${
          params.latestTokenNumber ?? "—"
        }.`
      : "";
  const note = params.tokenNote ? `\n${params.tokenNote}` : "";

  switch (params.variant) {
    case "confirmation":
      return withSig(`${base} your appointment at ${params.clinicName} with ${doc} is confirmed.\n${dt}${note}\n${location}\n\n${DISCLAIMER}`);
    case "reminder_24h":
      return withSig(`${base} reminder: your appointment at ${params.clinicName} with ${doc} is tomorrow. ${dt}.\n${location}\n\n${DISCLAIMER}`);
    case "doctor_arrived":
      return withSig(`${base} ${doc} has arrived at ${params.clinicName} and consultations are starting.\n${dt}\n${tokens}\n${location}\n\n${DISCLAIMER}`);
    case "next_in_line":
      return withSig(`${base} you are next in line for ${doc} at ${params.clinicName}. Please be ready.\n${dt}\n${tokens}\n${location}\n\n${DISCLAIMER}`);
    case "token_update": {
      const timing = params.tentativeTime
        ? `Your tentative time with ${doc} is now ${params.tentativeTime}.`
        : `Queue update from ${doc} at ${params.clinicName}.`;
      return withSig(`${base} ${timing}\n${dt}\n${tokens}\n${location}\n\n${DISCLAIMER}`);
    }
    case "shift_update": {
      const late = Boolean(params.delayMinutes && params.delayMinutes > 0);
      const delay = late
        ? `Doctor is running about ${params.delayMinutes} minutes late.`
        : `Doctor is back on schedule.`;
      const newTime = params.tentativeTime ? ` Your ${late ? "updated " : ""}tentative time: ${params.tentativeTime}.` : "";
      return withSig(`${base} ${delay}${newTime}\n${dt}\n${tokens}\n${location}\n\n${DISCLAIMER}`);
    }
    case "rescheduled":
      return withSig(`${base} your appointment at ${params.clinicName} with ${doc} has been rescheduled.\nNew date: ${params.date} | New time: ${timeStr || "—"}${note}\n${location}\n\n${DISCLAIMER}`);
  }
}

async function postToGateway(clinicId: string, phone10: string, message: string) {
  try {
    const gatewayKey = requireGatewayApiKey();
    const res = await gatewayFetch("/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-gateway-key": gatewayKey },
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

    if (data.variant !== "shift_update" && (t.whatsapp_messages_sent ?? 0) >= MAX_TOTAL_MESSAGES) {
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
      supabase.from("clinics").select("name, address, map_link, clinic_mobile").eq("id", t.clinic_id).maybeSingle(),
      t.doctor_id
        ? supabase.from("doctors").select("name, specialty").eq("id", t.doctor_id).maybeSingle()
        : Promise.resolve({ data: null as any, error: null }),
    ]);
    const clinic = (clinicRes.data ?? { name: "our clinic", address: "—", map_link: null, clinic_mobile: null }) as any;
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
      clinicMapLink: clinic.map_link ?? null,
      clinicMobile: clinic.clinic_mobile,
      date: formatDateIN(t.appointment_date),
      time: t.appointment_time,
      runningTokenNumber: ctx.runningTokenNumber,
      latestTokenNumber: latest,
      tentativeTime: data.tentativeTime ?? null,
    });

    const result = await postToGateway(t.clinic_id, t.phone_number, message);
    if (!result.ok) return { ok: false as const, status: result.status, error: result.error ?? `Send failed (${result.status})` };

    const patch: Record<string, unknown> = {};
    if (data.variant !== "shift_update") patch.whatsapp_messages_sent = (t.whatsapp_messages_sent ?? 0) + 1;
    if (data.variant === "reminder_24h") patch.reminder_24h_sent_at = new Date().toISOString();
    if (data.variant === "doctor_arrived") patch.doctor_arrived_sent_at = new Date().toISOString();
    if (data.variant === "token_update") patch.token_update_count = (t.token_update_count ?? 0) + 1;

    if (Object.keys(patch).length) await (supabase.from("tokens") as any).update(patch).eq("id", t.id);
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

    let sent = 0;
    for (const row of rows) {
      const result = await dispatchNotification(supabase, {
        tokenId: row.id,
        messageType: "doctor_arrived",
      });
      if (!result.ok && result.error.includes("GATEWAY_API_KEY")) {
        return { ok: false as const, error: result.error };
      }
      if (result.ok) sent += 1;
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
  .inputValidator((input: { doctorId: string; deltaMinutes: number }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const delta = Number(data.deltaMinutes);
    const bad = validateDelta(delta);
    if (bad) return { ok: false as const, error: bad };
    const todayISO = todayISTString();

    const { data: doc } = await supabase.from("doctors").select("clinic_id").eq("id", data.doctorId).maybeSingle();
    if (!doc) return { ok: false as const, error: "Doctor not found" };
    const clinicId = (doc as any).clinic_id as string;

    const { data: shiftRow } = await (supabase.from("doctor_shift_status") as any)
      .select("delay_minutes, notified_delay_minutes, notify_count")
      .eq("doctor_id", data.doctorId).eq("shift_date", todayISO).maybeSingle();
    const cur = Number(shiftRow?.delay_minutes ?? 0);
    const notifiedPrev = Number(shiftRow?.notified_delay_minutes ?? 0);
    const notifyCount = Number(shiftRow?.notify_count ?? 0);
    const cumulative = nextCumulative(cur, delta);
    if (cumulative == null) return { ok: false as const, error: "Delay can't be less than 0 or more than 480 minutes" };

    const { data: rows } = await supabase
      .from("tokens")
      .select("id, appointment_time")
      .eq("doctor_id", data.doctorId)
      .eq("appointment_date", todayISO)
      .eq("status", "waiting");
    const tokens = ((rows as any[]) ?? []).filter((t) => t.appointment_time && /^\d{1,2}:\d{2}/.test(t.appointment_time));

    const planned: { id: string; old: string; next: string }[] = [];
    for (const t of tokens) {
      const old = String(t.appointment_time).slice(0, 5);
      const next = shiftTime(old, delta);
      if (!next) return { ok: false as const, error: "Some appointments would move past midnight (before 00:00 or after 23:59). No changes made." };
      planned.push({ id: t.id, old, next });
    }
    planned.sort((a, b) => delta > 0 ? b.old.localeCompare(a.old) : a.old.localeCompare(b.old));

    const moved: { id: string; next: string }[] = [];
    let skipped = 0;
    for (const p of planned) {
      const { error } = await supabase.from("tokens").update({ appointment_time: p.next }).eq("id", p.id);
      if (error) {
        if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) { skipped += 1; continue; }
        return { ok: false as const, error: error.message };
      }
      moved.push(p);
    }

    const decision = delayNotifyDecision(cumulative, notifiedPrev, notifyCount);
    let notified = 0;
    if (decision.notify && moved.length > 0) {
      for (const t of moved) {
        const res = await dispatchNotification(supabase, {
          tokenId: t.id, messageType: "shift_update",
          tentativeTime: fmtTime12(t.next), delayMinutes: cumulative,
        });
        if (!res.ok && res.error.includes("GATEWAY_API_KEY")) return { ok: false as const, error: res.error };
        if (res.ok) notified += 1;
      }
    }
    const didNotify = decision.notify && moved.length > 0;

    const { error: upErr } = await (supabase.from("doctor_shift_status") as any).upsert({
      clinic_id: clinicId, doctor_id: data.doctorId, shift_date: todayISO,
      status: cumulative > 0 ? "delayed" : "on_time", delay_minutes: cumulative, created_by: userId,
      notified_delay_minutes: didNotify ? cumulative : notifiedPrev,
      notify_count: didNotify ? notifyCount + 1 : notifyCount,
    }, { onConflict: "doctor_id,shift_date" });
    if (upErr) return { ok: false as const, error: upErr.message };

    return { ok: true as const, cumulative, shifted: moved.length, notified, skipped, capReached: decision.capReached, sent: notified };
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
      const { data: clinic, error: clinicError } = await supabase
        .from("clinics")
        .select("clinic_mobile")
        .eq("id", data.clinicId)
        .maybeSingle();
      if (clinicError) {
        return { ok: false as const, status: 500, body: { error: clinicError.message } };
      }
      const expectedNumber = String(clinic?.clinic_mobile ?? "").replace(/\D/g, "").slice(-10);
      if (expectedNumber.length !== 10) {
        return {
          ok: false as const,
          status: 400,
          body: { error: "Add the clinic mobile number in Clinic Profile first, then link WhatsApp." },
        };
      }
      const res = await gatewayFetch("/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId: data.clinicId, expectedNumber }),
      });
      const text = await res.text();
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }

      if (!res.ok) {
        const snippet = text.slice(0, 300);
        console.error(`[connectWhatsApp] gateway responded ${res.status}: ${snippet}`);
        if (res.status !== 409 && typeof body?.error !== "string" && body?.raw == null) {
          body = { ...body, raw: snippet };
        }
      }

      if (body?.status === "already_connected") {
        await (supabase.from("clinics") as any).update({ whatsapp_connected: true }).eq("id", data.clinicId);
      }
      return { ok: res.ok, status: res.status, body };
    } catch (e: any) {
      return { ok: false as const, status: 0, error: e?.message ?? "network error" };
    }
  });

/**
 * GET-only status check. Polls gateway /status?clinicId=... without
 * repeatedly hitting /connect (which can force new QR generation).
 */
export const checkWhatsAppStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clinicId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    try {
      const res = await gatewayFetch(`/status/${encodeURIComponent(data.clinicId)}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      const text = await res.text();
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
      const mismatch = typeof body?.error === "string" && body.error.trim() ? body.error : null;
      const connected = !mismatch && body?.isConnected === true;
      if (connected) {
        await (supabase.from("clinics") as any).update({ whatsapp_connected: true }).eq("id", data.clinicId);
      }
      return { ok: res.ok, status: res.status, connected, mismatch, body };
    } catch (e: any) {
      return { ok: false as const, status: 0, connected: false, mismatch: null, error: e?.message ?? "network error" };
    }
  });

export const disconnectWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { clinicId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    try {
      await gatewayFetch("/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId: data.clinicId }),
      });
    } catch {
      // The clinic's local connection flag must still be cleared if the gateway is unavailable.
    }
    const { error } = await supabase
      .from("clinics")
      .update({ whatsapp_connected: false })
      .eq("id", data.clinicId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

/**
 * Central patient-notification dispatcher.
 *
 * Routes each touchpoint (confirmation, reported, queue_update,
 * next_in_line, doctor_arrived, reminder_24h) through a single entry:
 *   - New phone numbers receive their first notification via SMS.
 *   - Prior clinic appointments, a successful notification on this appointment,
 *     or explicit opt-in permit WhatsApp when the clinic is connected.
 *   - A disconnected clinic uses SMS. Recognition never fabricates opt-in rows.
 */
export type NotifyType =
  | "confirmation"
  | "reported"
  | "queue_update"
  | "next_in_line"
  | "doctor_arrived"
  | "reminder_24h"
  | "rescheduled"
  | "shift_update";

export async function dispatchNotification(
  supabase: any,
  input: { tokenId: string; messageType: NotifyType; tentativeTime?: string | null; delayMinutes?: number | null },
): Promise<
  | { ok: true; channel: "whatsapp" | "sms"; status: number; optedIn: boolean }
  | { ok: false; channel: "whatsapp" | "sms" | null; status?: number; error: string }
> {
  const { data: tokenRow, error: tokErr } = await supabase
    .from("tokens").select("*").eq("id", input.tokenId).maybeSingle();
  if (tokErr || !tokenRow) return { ok: false, channel: null, error: tokErr?.message ?? "Token not found" };
  const t = tokenRow as any;

  if (input.messageType !== "shift_update" && (t.whatsapp_messages_sent ?? 0) >= MAX_TOTAL_MESSAGES) {
    return { ok: false, channel: null, error: `Message cap reached (${MAX_TOTAL_MESSAGES}/patient).` };
  }

  const [clinicRes, doctorRes] = await Promise.all([
    supabase.from("clinics").select("name, address, map_link, clinic_mobile, whatsapp_connected").eq("id", t.clinic_id).maybeSingle(),
    t.doctor_id
      ? supabase.from("doctors").select("name, specialty").eq("id", t.doctor_id).maybeSingle()
      : Promise.resolve({ data: null as any, error: null }),
  ]);
  const clinic = (clinicRes.data ?? { name: "our clinic", address: "—", map_link: null, clinic_mobile: null, whatsapp_connected: false }) as any;
  const doctor = (doctorRes.data ?? { name: "your doctor", specialty: null }) as any;

  const phone10 = String(t.phone_number ?? "").replace(/\D/g, "").slice(-10);
  if (!/^[0-9]{10}$/.test(phone10)) {
    return { ok: false, channel: null, error: "Invalid patient phone number" };
  }

  const [optRes, historyRes] = await Promise.all([
    supabase.from("whatsapp_optins").select("id")
      .eq("clinic_id", t.clinic_id).eq("phone_number", phone10).maybeSingle(),
    supabase.from("tokens").select("phone_number")
      .eq("clinic_id", t.clinic_id).neq("id", t.id),
  ]);
  if (optRes.error || historyRes.error || clinicRes.error) {
    return { ok: false, channel: null, error: (optRes.error ?? historyRes.error ?? clinicRes.error).message };
  }
  const optRow = optRes.data;
  const optedIn = Boolean(optRow?.id);

  const useWhatsApp = notificationChannel({
    connected: Boolean(clinic.whatsapp_connected),
    optedIn,
    previousAppointment: hasPreviousAppointment(phone10, historyRes.data ?? []),
    messagesSent: t.whatsapp_messages_sent ?? 0,
  }) === "whatsapp";

  const waVariantMap: Record<NotifyType, Variant> = {
    confirmation: "confirmation",
    reported: "token_update",
    queue_update: "token_update",
    next_in_line: "next_in_line",
    doctor_arrived: "doctor_arrived",
    reminder_24h: "reminder_24h",
    rescheduled: "rescheduled",
    shift_update: "shift_update",
  };

  if (input.messageType === "doctor_arrived") {
    if (t.doctor_arrived_sent_at) return { ok: false, channel: null, error: "Doctor-arrived alert already sent." };
    const now = new Date();
    const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    if (t.appointment_date !== todayISO) {
      return { ok: false, channel: null, error: "Doctor-arrived can only be sent on the appointment date." };
    }
  }
  if (input.messageType === "reminder_24h" && t.reminder_24h_sent_at) {
    return { ok: false, channel: null, error: "24h reminder already sent." };
  }
  if ((input.messageType === "queue_update" || input.messageType === "reported")
    && (t.token_update_count ?? 0) >= MAX_TOKEN_UPDATES) {
    return { ok: false, channel: null, error: `Token-update cap reached (${MAX_TOKEN_UPDATES}/patient).` };
  }

  const timeStr = fmtTime12(t.appointment_time);
  const doc = doctorLabel(doctor?.name ?? "your doctor", doctor?.specialty ?? null);

  let sendResult: { ok: boolean; status: number; error?: string };
  let channel: "whatsapp" | "sms";

  const ctx = await computeQueueContext(supabase, t.clinic_id, t.doctor_id, t.appointment_date);
  const latest = ctx.displayToken.get(t.id) ?? t.token_number ?? null;
  const needsNote = input.messageType === "confirmation" || input.messageType === "rescheduled";

  if (useWhatsApp) {
    channel = "whatsapp";
    const message = buildMessage({
      variant: waVariantMap[input.messageType],
      patientName: t.patient_name,
      doctorName: doctor?.name ?? "your doctor",
      doctorSpecialty: doctor?.specialty ?? null,
      clinicName: clinic.name,
      clinicAddress: clinic.address,
      clinicMapLink: clinic.map_link ?? null,
      clinicMobile: clinic.clinic_mobile,
      date: formatDateIN(t.appointment_date),
      time: t.appointment_time,
      runningTokenNumber: ctx.runningTokenNumber,
      latestTokenNumber: latest,
      tentativeTime: input.tentativeTime ?? null,
      delayMinutes: input.delayMinutes ?? null,
      tokenNote: needsNote ? tokenNoteFor(t.appointment_date, latest, "whatsapp") : null,
    });
    sendResult = await postToGateway(t.clinic_id, phone10, message);
  } else {
    channel = "sms";
    let smsText: string;
    if (input.messageType === "confirmation") {
      const waNumber = String(clinic.clinic_mobile ?? "").replace(/\D/g, "").slice(-10);
      const waLink = waNumber ? `https://wa.me/91${waNumber}?text=Hi` : "";
      const mapLink = String(clinic.map_link ?? "").trim();
      smsText =
        `Hello ${t.patient_name}, your appointment at ${clinic.name} with ${doc} is confirmed.\n` +
        `Date: ${formatDateIN(t.appointment_date)}${timeStr ? ` | Time: ${timeStr}` : ""}\n` +
        `${tokenNoteFor(t.appointment_date, latest, "sms")}\n` +
        (mapLink ? `Location: ${mapLink}\n` : "") +
        (waLink
          ? `To receive further updates on appointment progress, click the link below and send "Hi" on WhatsApp:\n${waLink}\n`
          : "") +
        `\n${SIGNATURE}`;
    } else {
      const tokenLine = latest != null ? ` Token #${latest}.` : "";
      const timing = input.tentativeTime ? ` Tentative time: ${input.tentativeTime}.` : "";
      const base = `Hello ${t.patient_name},`;
      switch (input.messageType) {
        case "reported":
          smsText = `${base} we've marked you as reported at ${clinic.name} with ${doc}.${tokenLine}${timing}\n${SIGNATURE}`;
          break;
        case "queue_update":
          smsText = `${base} queue update at ${clinic.name} with ${doc}.${tokenLine}${timing}\n${SIGNATURE}`;
          break;
        case "next_in_line":
          smsText = `${base} you're next in line for ${doc} at ${clinic.name}. Please be ready.${tokenLine}\n${SIGNATURE}`;
          break;
        case "doctor_arrived":
          smsText = `${base} ${doc} has arrived at ${clinic.name}. Consultations are starting.${tokenLine}\n${SIGNATURE}`;
          break;
        case "reminder_24h":
          smsText = `${base} reminder: your appointment at ${clinic.name} with ${doc} is tomorrow. Date: ${formatDateIN(t.appointment_date)}${timeStr ? ` | Time: ${timeStr}` : ""}.\n${String(clinic.map_link ?? "").trim() ? `Location: ${String(clinic.map_link).trim()}\n` : ""}${DISCLAIMER}\n${SIGNATURE}`;
          break;
        case "rescheduled":
          smsText = `${base} your appointment at ${clinic.name} with ${doc} has been rescheduled to ${formatDateIN(t.appointment_date)} | ${timeStr || "—"}. ${tokenNoteFor(t.appointment_date, latest, "sms")}\n${SIGNATURE}`;
          break;
        case "shift_update": {
          const late = Boolean(input.delayMinutes && input.delayMinutes > 0);
          const delayLine = late
            ? ` Doctor is running about ${input.delayMinutes} minutes late at ${clinic.name}.`
            : ` Doctor is back on schedule at ${clinic.name}.`;
          const tt = input.tentativeTime ?? timeStr;
          const timeLine = tt ? ` Your ${late ? "updated " : ""}tentative time: ${tt}.` : "";
          smsText = `${base}${delayLine}${timeLine}${tokenLine}\n${DISCLAIMER}\n${SIGNATURE}`;
          break;
        }
        default:
          smsText = `${base} update from ${clinic.name}.${tokenLine}\n${SIGNATURE}`;
      }
    }
    sendResult = await sendSmsRaw(phone10, smsText);
  }

  if (!sendResult.ok) {
    return { ok: false, channel, status: sendResult.status, error: sendResult.error ?? `Send failed (${sendResult.status})` };
  }

  const patch: Record<string, unknown> = {};
  if (input.messageType !== "shift_update") patch.whatsapp_messages_sent = (t.whatsapp_messages_sent ?? 0) + 1;
  if (input.messageType === "doctor_arrived") patch.doctor_arrived_sent_at = new Date().toISOString();
  if (input.messageType === "reminder_24h") patch.reminder_24h_sent_at = new Date().toISOString();
  if (input.messageType === "queue_update" || input.messageType === "reported") {
    patch.token_update_count = (t.token_update_count ?? 0) + 1;
  }
  const { error: saveError } = Object.keys(patch).length
    ? await (supabase.from("tokens") as any).update(patch).eq("id", t.id)
    : { error: null };
  if (saveError) {
    return { ok: false, channel, status: sendResult.status, error: `Message accepted, but notification tracking could not be saved: ${saveError.message}` };
  }

  return { ok: true, channel, status: sendResult.status, optedIn };
}

export const notifyPatient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tokenId: string; messageType: NotifyType; tentativeTime?: string | null }) => input)
  .handler(async ({ data, context }) => {
    return await dispatchNotification(context.supabase, data);
  });
