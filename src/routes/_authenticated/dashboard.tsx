import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { LogOut, Stethoscope, Clock, CheckCircle2, PlayCircle, XCircle, UserPlus, AlertTriangle, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type Clinic = { id: string; name: string; status: string; trial_ends_at: string };
type Doctor = { id: string; name: string; specialty: string | null };
type Token = {
  id: string;
  token_number: number;
  patient_name: string;
  phone: string | null;
  doctor_id: string | null;
  status: "waiting" | "in_consultation" | "completed" | "no_show";
  created_at: string;
};

const statusMeta: Record<Token["status"], { label: string; className: string; icon: React.ElementType }> = {
  waiting: { label: "Waiting", className: "bg-sky-100 text-sky-700 border-sky-200", icon: Clock },
  in_consultation: { label: "In Consultation", className: "bg-blue-100 text-blue-700 border-blue-200", icon: PlayCircle },
  completed: { label: "Completed", className: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  no_show: { label: "No Show", className: "bg-rose-100 text-rose-700 border-rose-200", icon: XCircle },
};

function Dashboard() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);

  const doctorMap = useMemo(() => new Map(doctors.map((d) => [d.id, d])), [doctors]);

  const loadAll = async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [c, d, t] = await Promise.all([
      supabase.from("clinics").select("id,name,status,trial_ends_at").limit(1).maybeSingle(),
      supabase.from("doctors").select("id,name,specialty").eq("is_active", true).order("name"),
      supabase.from("tokens").select("*").gte("created_at", today.toISOString()).order("token_number", { ascending: true }),
    ]);
    if (c.data) setClinic(c.data as Clinic);
    if (d.data) setDoctors(d.data as Doctor[]);
    if (t.data) setTokens(t.data as Token[]);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    loadAll();
    const channel = supabase
      .channel("tokens-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tokens" }, loadAll)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const updateStatus = async (id: string, status: Token["status"]) => {
    const { error } = await supabase.from("tokens").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Updated");
  };

  const trialDaysLeft = clinic ? Math.ceil((new Date(clinic.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 0;
  const trialExpired = clinic ? new Date(clinic.trial_ends_at).getTime() < Date.now() && clinic.status !== "active" : false;
  const showTrialBanner = clinic?.status === "trial" && !trialExpired;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Trial / Expiry banner */}
      {trialExpired && (
        <div className="bg-rose-600 text-white px-6 py-3 flex items-center justify-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" />
          Your 14-day free trial has expired. Please upgrade to continue adding patients.
        </div>
      )}
      {showTrialBanner && (
        <div className="bg-sky-50 border-b border-sky-100 text-sky-900 px-6 py-2.5 flex items-center justify-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-sky-600" />
          <span className="font-medium">{trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left</span>
          <span className="text-sky-700">in your free trial</span>
        </div>
      )}

      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-sky-500 text-white flex items-center justify-center shadow-sm">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold text-slate-900 leading-tight">{clinic?.name ?? "Clinic Queue"}</div>
              <div className="text-xs text-slate-500">{email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ManageDoctorsDialog doctors={doctors} clinicId={clinic?.id} onChange={loadAll} />
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sign out" className="text-slate-500 hover:text-slate-900">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Add Patient */}
        <section className="lg:col-span-1">
          <AddPatientCard
            clinicId={clinic?.id}
            doctors={doctors}
            disabled={trialExpired}
            onAdded={loadAll}
          />
        </section>

        {/* Queue */}
        <section className="lg:col-span-2 space-y-4">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900 tracking-tight">Today's Queue</h2>
              <p className="text-sm text-slate-500 mt-0.5">{tokens.length} {tokens.length === 1 ? "patient" : "patients"}</p>
            </div>
          </div>

          <Card className="border-slate-200 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    <th className="px-4 py-3 w-16">Token</th>
                    <th className="px-4 py-3">Patient</th>
                    <th className="px-4 py-3 hidden md:table-cell">Phone</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Doctor</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">Loading…</td></tr>
                  ) : tokens.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No patients in the queue today.</td></tr>
                  ) : tokens.map((t) => (
                    <TokenRow key={t.id} token={t} doctor={t.doctor_id ? doctorMap.get(t.doctor_id) : undefined} onUpdate={updateStatus} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      </main>
    </div>
  );
}

function TokenRow({ token, doctor, onUpdate }: { token: Token; doctor?: Doctor; onUpdate: (id: string, s: Token["status"]) => void }) {
  const meta = statusMeta[token.status];
  const Icon = meta.icon;
  return (
    <tr className="hover:bg-slate-50/60 transition-colors">
      <td className="px-4 py-3">
        <div className="h-9 w-9 rounded-lg bg-sky-50 text-sky-700 font-semibold text-sm flex items-center justify-center">
          {token.token_number}
        </div>
      </td>
      <td className="px-4 py-3 font-medium text-slate-900">{token.patient_name}</td>
      <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{token.phone || "—"}</td>
      <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{doctor?.name ?? "—"}</td>
      <td className="px-4 py-3">
        <Badge variant="outline" className={`gap-1 font-medium ${meta.className}`}>
          <Icon className="h-3 w-3" />
          {meta.label}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {token.status === "waiting" && (
            <Button size="sm" variant="ghost" className="text-blue-700 hover:bg-blue-50" onClick={() => onUpdate(token.id, "in_consultation")}>Start</Button>
          )}
          {token.status === "in_consultation" && (
            <Button size="sm" variant="ghost" className="text-emerald-700 hover:bg-emerald-50" onClick={() => onUpdate(token.id, "completed")}>Complete</Button>
          )}
          {(token.status === "waiting" || token.status === "in_consultation") && (
            <Button size="sm" variant="ghost" className="text-rose-700 hover:bg-rose-50" onClick={() => onUpdate(token.id, "no_show")}>No Show</Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function AddPatientCard({ clinicId, doctors, disabled, onAdded }: { clinicId?: string; doctors: Doctor[]; disabled: boolean; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [doctorId, setDoctorId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!clinicId) return toast.error("Clinic not loaded");
    if (!name.trim()) return toast.error("Patient name required");
    setSaving(true);
    const { error } = await supabase.from("tokens").insert({
      clinic_id: clinicId,
      patient_name: name.trim(),
      phone: phone.trim() || null,
      doctor_id: doctorId || null,
      token_number: 0, // trigger assigns
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Patient added to queue");
    setName(""); setPhone(""); setDoctorId("");
    onAdded();
  };

  return (
    <Card className="border-slate-200 shadow-sm sticky top-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
            <UserPlus className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base text-slate-900">Add Patient</CardTitle>
            <CardDescription className="text-xs">Check a patient into the queue</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset disabled={disabled} className="space-y-4 disabled:opacity-50">
          <div className="space-y-1.5">
            <Label htmlFor="pname" className="text-xs font-medium text-slate-700">Patient Name</Label>
            <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" className="border-slate-200" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-xs font-medium text-slate-700">Phone Number</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 000 0000" className="border-slate-200" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">Doctor</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="border-slate-200"><SelectValue placeholder="Select a doctor" /></SelectTrigger>
              <SelectContent>
                {doctors.length === 0 && <div className="px-2 py-1.5 text-sm text-slate-500">No doctors yet</div>}
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}{d.specialty ? ` · ${d.specialty}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={submit} disabled={saving || disabled} className="w-full bg-sky-600 hover:bg-sky-700">
            {saving ? "Adding..." : "Add to Queue"}
          </Button>
        </fieldset>
        {disabled && (
          <p className="text-xs text-rose-600 text-center">Adding patients is disabled while the trial is expired.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ManageDoctorsDialog({ doctors, clinicId, onChange }: { doctors: Doctor[]; clinicId?: string; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const add = async () => {
    if (!clinicId) return toast.error("Clinic not loaded");
    if (!name.trim()) return toast.error("Name required");
    const { error } = await supabase.from("doctors").insert({ clinic_id: clinicId, name: name.trim(), specialty: specialty.trim() || null });
    if (error) return toast.error(error.message);
    setName(""); setSpecialty("");
    onChange();
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from("doctors").update({ is_active: false }).eq("id", id);
    if (error) return toast.error(error.message);
    onChange();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-slate-200 text-slate-700">Doctors</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage Doctors</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Specialty" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
          </div>
          <Button onClick={add} size="sm" className="bg-sky-600 hover:bg-sky-700">Add doctor</Button>
          <div className="space-y-2 pt-2">
            {doctors.length === 0 && <div className="text-sm text-slate-500">No doctors yet.</div>}
            {doctors.map((d) => (
              <div key={d.id} className="flex items-center justify-between border border-slate-200 rounded-md px-3 py-2">
                <div className="text-sm">
                  <div className="font-medium text-slate-900">{d.name}</div>
                  {d.specialty && <div className="text-xs text-slate-500">{d.specialty}</div>}
                </div>
                <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => remove(d.id)}>Remove</Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
