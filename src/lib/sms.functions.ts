import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Fast2SMS Quick SMS ("q" route) sender.
 * Reads FAST2SMS_API_KEY from server env (process.env, not Deno).
 */
export async function sendSmsRaw(phone10: string, message: string): Promise<{ ok: boolean; status: number; error?: string; body?: any }> {
  const key = process.env.FAST2SMS_API_KEY;
  if (!key) return { ok: false, status: 0, error: "FAST2SMS_API_KEY not configured" };
  if (!/^[0-9]{10}$/.test(phone10)) return { ok: false, status: 0, error: "Invalid phone number" };

  const body = new URLSearchParams({
    route: "q",
    message,
    language: "english",
    numbers: phone10,
  }).toString();

  try {
    const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        authorization: key,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const text = await res.text();
    let parsed: any = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
    if (!res.ok || parsed?.return === false) {
      return { ok: false, status: res.status, error: parsed?.message ?? `SMS failed (${res.status})`, body: parsed };
    }
    return { ok: true, status: res.status, body: parsed };
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message ?? "network error" };
  }
}

export const sendSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string; message: string }) => input)
  .handler(async ({ data }) => {
    const phone10 = (data.phone ?? "").replace(/\D/g, "").slice(-10);
    return await sendSmsRaw(phone10, data.message);
  });
