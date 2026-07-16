import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { message: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const message = (data.message ?? "").trim();
    if (message.length < 1 || message.length > 5000) return { ok: false as const, error: "Message must be 1–5000 chars" };

    // Best-effort clinic + role capture
    const [{ data: recept }, { data: roles }] = await Promise.all([
      supabase.from("receptionists").select("clinic_id").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    const clinicId = (recept as any)?.clinic_id ?? null;
    const isAdmin = ((roles as any[]) ?? []).some((r) => r.role === "super_admin");
    const userRole = isAdmin ? "super_admin" : "receptionist";

    const { error } = await (supabase.from("feedback") as any).insert({
      clinic_id: clinicId, user_id: userId, user_role: userRole, message,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
