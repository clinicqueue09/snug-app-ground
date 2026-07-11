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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { LogOut, Plus, Stethoscope, Clock, CheckCircle2, PlayCircle, XCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type Patient = { id: string; name: string; phone: string | null };
type Doctor = { id: string; name: string; specialty: string | null };
type QueueEntry = {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  status: "waiting" | "in-progress" | "completed" | "no-show";
  priority: "normal" | "urgent";
  notes: string | null;
  check_in_time: string;
};

const statusMeta: Record<QueueEntry["status"], { label: string; className: string; icon: React.ElementType }> = {
  waiting: { label: "Waiting", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400", icon: Clock },
  "in-progress": { label: "In progress", className: "bg-blue-500/15 text-blue-700 dark:text-blue-400", icon: PlayCircle },
  completed: { label: "Completed", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", icon: CheckCircle2 },
  "no-show": { label: "No-show", className: "bg-rose-500/15 text-rose-700 dark:text-rose-400", icon: XCircle },
};

function Dashboard() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const patientMap = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const doctorMap = useMemo(() => new Map(doctors.map((d) => [d.id, d])), [doctors]);

  const loadAll = async () => {
    const [p, d, q] = await Promise.all([
      supabase.from("patients").select("id,name,phone").order("name"),
      supabase.from("doctors").select("id,name,specialty").eq("is_active", true).order("name"),
      supabase.from("queue_entries").select("*").order("check_in_time", { ascending: true }),
    ]);
    if (p.data) setPatients(p.data as Patient[]);
    if (d.data) setDoctors(d.data as Doctor[]);
    if (q.data) setEntries(q.data as QueueEntry[]);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    loadAll();
    const channel = supabase
      .channel("queue-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_entries" }, loadAll)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const updateStatus = async (id: string, status: QueueEntry["status"]) => {
    const patch: Partial<QueueEntry> & { start_time?: string; end_time?: string } = { status };
    if (status === "in-progress") (patch as any).start_time = new Date().toISOString();
    if (status === "completed" || status === "no-show") (patch as any).end_time = new Date().toISOString();
    const { error } = await supabase.from("queue_entries").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Updated");
    loadAll();
  };

  const removeEntry = async (id: string) => {
    const { error } = await supabase.from("queue_entries").delete().eq("id", id);
    if (error) return toast.error(error.message);
    loadAll();
  };

  const waiting = entries.filter((e) => e.status === "waiting");
  const active = entries.filter((e) => e.status === "in-progress");
  const done = entries.filter((e) => e.status === "completed" || e.status === "no-show");

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold leading-tight">Clinic Queue</div>
              <div className="text-xs text-muted-foreground">{email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ManageDoctorsDialog doctors={doctors} onChange={loadAll} />
            <AddToQueueDialog patients={patients} doctors={doctors} onCreated={loadAll} />
            <Button variant="ghost" size="icon" onClick={handleSignOut} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Waiting" value={waiting.length} tone="amber" />
          <StatCard label="In progress" value={active.length} tone="blue" />
          <StatCard label="Completed today" value={done.length} tone="emerald" />
        </div>

        <Section title="Waiting" empty="No patients waiting.">
          {loading ? null : waiting.map((e) => (
            <QueueRow key={e.id} entry={e} patient={patientMap.get(e.patient_id)} doctor={e.doctor_id ? doctorMap.get(e.doctor_id) : undefined}
              onStart={() => updateStatus(e.id, "in-progress")}
              onNoShow={() => updateStatus(e.id, "no-show")}
              onRemove={() => removeEntry(e.id)}
            />
          ))}
        </Section>

        <Section title="In progress" empty="No active consultations.">
          {active.map((e) => (
            <QueueRow key={e.id} entry={e} patient={patientMap.get(e.patient_id)} doctor={e.doctor_id ? doctorMap.get(e.doctor_id) : undefined}
              onComplete={() => updateStatus(e.id, "completed")}
              onRemove={() => removeEntry(e.id)}
            />
          ))}
        </Section>

        <Section title="Recent" empty="Nothing completed yet.">
          {done.slice(0, 10).map((e) => (
            <QueueRow key={e.id} entry={e} patient={patientMap.get(e.patient_id)} doctor={e.doctor_id ? doctorMap.get(e.doctor_id) : undefined}
              onRemove={() => removeEntry(e.id)}
            />
          ))}
        </Section>
      </main>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "amber" | "blue" | "emerald" }) {
  const toneClass = {
    amber: "text-amber-600 dark:text-amber-400",
    blue: "text-blue-600 dark:text-blue-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
  }[tone];
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`text-3xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section>
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">{title}</h2>
      <div className="space-y-2">
        {hasChildren ? children : <div className="text-sm text-muted-foreground bg-background border rounded-lg px-4 py-6 text-center">{empty}</div>}
      </div>
    </section>
  );
}

function QueueRow({
  entry, patient, doctor, onStart, onComplete, onNoShow, onRemove,
}: {
  entry: QueueEntry;
  patient?: Patient;
  doctor?: Doctor;
  onStart?: () => void;
  onComplete?: () => void;
  onNoShow?: () => void;
  onRemove?: () => void;
}) {
  const meta = statusMeta[entry.status];
  const Icon = meta.icon;
  const checkIn = new Date(entry.check_in_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="bg-background border rounded-lg px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
      <div className="flex items-center gap-3 min-w-0">
        <Badge className={meta.className + " gap-1"} variant="secondary">
          <Icon className="h-3 w-3" />
          {meta.label}
        </Badge>
        <div className="min-w-0">
          <div className="font-medium truncate">{patient?.name ?? "Unknown patient"}</div>
          <div className="text-xs text-muted-foreground truncate">
            {doctor ? `${doctor.name}${doctor.specialty ? ` · ${doctor.specialty}` : ""}` : "No doctor assigned"} · Checked in {checkIn}
            {entry.priority === "urgent" ? " · Urgent" : ""}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onStart && <Button size="sm" onClick={onStart}>Start</Button>}
        {onComplete && <Button size="sm" onClick={onComplete}>Complete</Button>}
        {onNoShow && <Button size="sm" variant="outline" onClick={onNoShow}>No-show</Button>}
        {onRemove && <Button size="sm" variant="ghost" onClick={onRemove}>Remove</Button>}
      </div>
    </div>
  );
}

function AddToQueueDialog({ patients, doctors, onCreated }: { patients: Patient[]; doctors: Doctor[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"existing" | "new">(patients.length ? "existing" : "new");
  const [patientId, setPatientId] = useState<string>("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [doctorId, setDoctorId] = useState<string>("");
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    let pid = patientId;
    if (mode === "new") {
      if (!name.trim()) { setSaving(false); return toast.error("Name required"); }
      const { data, error } = await supabase.from("patients").insert({ name: name.trim(), phone: phone || null }).select("id").single();
      if (error || !data) { setSaving(false); return toast.error(error?.message ?? "Failed"); }
      pid = data.id;
    }
    if (!pid) { setSaving(false); return toast.error("Select a patient"); }
    const { error } = await supabase.from("queue_entries").insert({
      patient_id: pid,
      doctor_id: doctorId || null,
      priority,
      notes: notes || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Added to queue");
    setOpen(false);
    setName(""); setPhone(""); setNotes(""); setPatientId(""); setDoctorId(""); setPriority("normal");
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add patient</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add to queue</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button type="button" variant={mode === "existing" ? "default" : "outline"} size="sm" onClick={() => setMode("existing")}>Existing patient</Button>
            <Button type="button" variant={mode === "new" ? "default" : "outline"} size="sm" onClick={() => setMode("new")}>New patient</Button>
          </div>
          {mode === "existing" ? (
            <div className="space-y-2">
              <Label>Patient</Label>
              <Select value={patientId} onValueChange={setPatientId}>
                <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
                <SelectContent>
                  {patients.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}{p.phone ? ` · ${p.phone}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2 col-span-2">
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label>Doctor (optional)</Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger><SelectValue placeholder="Any doctor" /></SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}{d.specialty ? ` · ${d.specialty}` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving}>{saving ? "Adding..." : "Add to queue"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageDoctorsDialog({ doctors, onChange }: { doctors: Doctor[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const add = async () => {
    if (!name.trim()) return toast.error("Name required");
    const { error } = await supabase.from("doctors").insert({ name: name.trim(), specialty: specialty || null });
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
        <Button size="sm" variant="outline">Doctors</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Doctors</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Specialty" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
          </div>
          <Button onClick={add} size="sm">Add doctor</Button>
          <div className="space-y-2 pt-2">
            {doctors.length === 0 && <div className="text-sm text-muted-foreground">No doctors yet.</div>}
            {doctors.map((d) => (
              <div key={d.id} className="flex items-center justify-between border rounded-md px-3 py-2">
                <div className="text-sm">
                  <div className="font-medium">{d.name}</div>
                  {d.specialty && <div className="text-xs text-muted-foreground">{d.specialty}</div>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => remove(d.id)}>Remove</Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
