import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";
import { Shield } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/whatsapp")({
  component: AdminWhatsApp,
});

function AdminWhatsApp() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { navigate({ to: "/auth", replace: true }); return; }
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
      const isAdmin = ((roles as any[]) ?? []).some((r) => r.role === "super_admin");
      setAllowed(isAdmin);
      if (isAdmin) {
        const { data } = await supabase.from("app_settings").select("whatsapp_tunnel_url").eq("id", "global").maybeSingle();
        setUrl(((data as any)?.whatsapp_tunnel_url ?? "") as string);
      }
    })();
  }, [navigate]);

  if (allowed === null) return <div className="p-8 text-slate-500">Loading…</div>;
  if (!allowed) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-md w-full"><CardHeader><CardTitle>Not authorized</CardTitle><CardDescription>Super admin access only.</CardDescription></CardHeader></Card>
    </div>
  );

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase.from("app_settings") as any)
      .upsert({ id: "global", whatsapp_tunnel_url: url.trim() || null, updated_at: new Date().toISOString() }, { onConflict: "id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Global WhatsApp gateway saved");
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" /> Global WhatsApp Gateway</CardTitle>
            <CardDescription>Central tunnel URL for the entire ClinicQ platform. Hidden from tenants.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label className="text-xs">Tunnel URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-tunnel.loca.lt" />
            <p className="text-xs text-slate-500">All clinics POST through <code>{"{URL}/send-message"}</code>.</p>
            <Button onClick={save} disabled={saving} className="bg-sky-600 hover:bg-sky-700">{saving ? "Saving…" : "Save"}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
