import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin/feedback")({
  component: AdminFeedback,
});

type Row = { id: string; message: string; user_role: string | null; created_at: string; clinic_id: string | null };

function AdminFeedback() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [clinics, setClinics] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { navigate({ to: "/auth", replace: true }); return; }
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
      const isAdmin = ((roles as any[]) ?? []).some((r) => r.role === "super_admin");
      setAllowed(isAdmin);
      if (!isAdmin) return;
      const { data } = await supabase.from("feedback").select("id, message, user_role, created_at, clinic_id").order("created_at", { ascending: false });
      const list = (data as Row[]) ?? [];
      setRows(list);
      const cids = Array.from(new Set(list.map((r) => r.clinic_id).filter(Boolean))) as string[];
      if (cids.length) {
        const { data: cs } = await supabase.from("clinics").select("id, name").in("id", cids);
        setClinics(new Map(((cs as any[]) ?? []).map((c) => [c.id, c.name])));
      }
    })();
  }, [navigate]);

  if (allowed === null) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!allowed) return <div className="p-8 text-rose-600">Super admin access only.</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>System Master Feedback</CardTitle>
            <CardDescription>Chronological, grouped by clinic / role / date.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.length === 0 && <div className="text-sm text-slate-500">No feedback yet.</div>}
            {rows.map((r) => (
              <div key={r.id} className="border border-slate-200 rounded p-3 bg-white">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-800">{r.clinic_id ? (clinics.get(r.clinic_id) ?? "—") : "—"}</span>
                  <span>·</span>
                  <span>{r.user_role ?? "user"}</span>
                  <span>·</span>
                  <span>{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <div className="text-sm text-slate-900 whitespace-pre-wrap mt-1">{r.message}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
