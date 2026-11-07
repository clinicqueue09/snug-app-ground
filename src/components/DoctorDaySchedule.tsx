import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { addDays, format } from "date-fns";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDisplay } from "@/components/TimeSelect";
import { cn } from "@/lib/utils";
import {
  clampSlotLength,
  escapeHtml,
  makeSlotTimes,
  maskPhone,
  sessionsForWeekday,
  slotForTime,
  type AvailabilityRow,
} from "@/lib/scheduling";

export type ScheduleToken = {
  id: string;
  patient_name: string;
  phone_number: string;
  doctor_id: string | null;
  status: "waiting" | "in_consultation" | "completed" | "no_show" | "cancelled";
  appointment_date: string;
  appointment_time: string | null;
};
type ScheduleDoctor = { id: string; name: string; avg_time_per_patient: number | null };

const dateKey = (d: Date) => format(d, "yyyy-MM-dd");

const pill: Record<string, { label: string; className: string }> = {
  waiting: { label: "Waiting", className: "bg-chart-5/15 text-chart-5 border-chart-5" },
  in_consultation: { label: "In room", className: "bg-info-surface text-info border-info" },
  completed: { label: "Seen", className: "bg-muted text-muted-foreground border-border" },
  no_show: { label: "No show", className: "bg-danger-surface text-danger border-danger" },
};

export function DoctorDaySchedule<T extends ScheduleToken>({
  clinicId,
  clinicName,
  clinicDuration,
  doctors,
  tokens,
  trialExpired,
  onBooked,
  renderReschedule,
}: {
  clinicId?: string;
  clinicName: string;
  clinicDuration: number;
  doctors: ScheduleDoctor[];
  tokens: T[];
  trialExpired: boolean;
  onBooked: (token: T) => Promise<void> | void;
  renderReschedule: (token: T) => ReactNode;
}) {
  const [doctorId, setDoctorId] = useState<string>("");
  const [day, setDay] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const [onLeave, setOnLeave] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bookTime, setBookTime] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!doctorId && doctors.length) setDoctorId(doctors[0].id);
    if (doctorId && !doctors.some((d) => d.id === doctorId)) setDoctorId(doctors[0]?.id ?? "");
  }, [doctors, doctorId]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const key = dateKey(day);
  const doctor = doctors.find((d) => d.id === doctorId);

  const load = useCallback(async () => {
    if (!doctorId || !clinicId) return;
    setLoading(true);
    const [a, off] = await Promise.all([
      supabase.from("doctor_availability").select("weekday,start_time,end_time").eq("doctor_id", doctorId).eq("clinic_id", clinicId),
      supabase.from("doctor_time_off").select("id").eq("doctor_id", doctorId).eq("clinic_id", clinicId).eq("off_date", key).maybeSingle(),
    ]);
    setLoading(false);
    if (a.error || off.error) return toast.error((a.error ?? off.error)!.message);
    setAvailability((a.data ?? []) as AvailabilityRow[]);
    setOnLeave(Boolean(off.data));
  }, [doctorId, clinicId, key]);

  useEffect(() => { void load(); }, [load]);

  const slotLength = clampSlotLength(doctor?.avg_time_per_patient, clinicDuration);
  const sessions = sessionsForWeekday(day.getDay(), availability);
  const sessionSlots = sessions.map((s) => ({ ...s, slots: makeSlotTimes([s], slotLength) }));
  const allSlots = sessionSlots.flatMap((s) => s.slots);

  const dayTokens = useMemo(
    () => tokens.filter((t) => t.doctor_id === doctorId && t.appointment_date === key && t.status !== "cancelled"),
    [tokens, doctorId, key],
  );
  const bySlot = new Map<string, T[]>();
  const outside: T[] = [];
  for (const t of dayTokens) {
    const s = slotForTime(t.appointment_time, allSlots, slotLength);
    if (s) (bySlot.get(s) ?? bySlot.set(s, []).get(s)!).push(t);
    else outside.push(t);
  }
  for (const list of bySlot.values()) list.sort((a, b) => (a.appointment_time ?? "").localeCompare(b.appointment_time ?? ""));

  const seen = dayTokens.filter((t) => t.status === "completed" || t.status === "no_show").length;
  const inRoom = dayTokens.filter((t) => t.status === "in_consultation").length;
  const waiting = dayTokens.filter((t) => t.status === "waiting").length;
  const free = allSlots.filter((s) => !bySlot.has(s)).length;

  const isPast = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    const dt = new Date(day);
    dt.setHours(h, m, 0, 0);
    return dt.getTime() < now.getTime();
  };

  const setLeave = async (value: boolean) => {
    if (!clinicId || !doctorId) return;
    const { error } = value
      ? await supabase.from("doctor_time_off").insert({ clinic_id: clinicId, doctor_id: doctorId, off_date: key })
      : await supabase.from("doctor_time_off").delete().eq("clinic_id", clinicId).eq("doctor_id", doctorId).eq("off_date", key);
    if (error) return toast.error(error.message);
    setOnLeave(value);
    toast.success(value ? "Day blocked: doctor on leave" : "Leave removed");
  };

  const toggleLeave = (value: boolean) => {
    if (value && waiting > 0) return setConfirmLeave(true);
    void setLeave(value);
  };

  const printDay = () => {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return toast.error("Allow pop-ups to print the day list.");
    const rows = sessionSlots.map((s, i) => {
      const body = s.slots.map((slot) => {
        const list = bySlot.get(slot) ?? [];
        const who = list.length
          ? list.map((t) => `${escapeHtml(t.patient_name)} (${escapeHtml(maskPhone(t.phone_number))}) – ${escapeHtml(pill[t.status]?.label ?? t.status)}`).join("<br>")
          : "Free";
        return `<tr><td>${escapeHtml(formatDisplay(slot))}</td><td>${who}</td></tr>`;
      }).join("");
      return `<h3>Session ${i + 1} · ${escapeHtml(formatDisplay(s.start_time))} - ${escapeHtml(formatDisplay(s.end_time))}</h3><table>${body}</table>`;
    }).join("");
    const extra = outside.length
      ? `<h3>Outside the slots / working hours</h3><table>${outside.map((t) => `<tr><td>${escapeHtml(t.appointment_time ? formatDisplay(t.appointment_time) : "—")}</td><td>${escapeHtml(t.patient_name)} (${escapeHtml(maskPhone(t.phone_number))})</td></tr>`).join("")}</table>`
      : "";
    w.document.write(`<!doctype html><html><head><title>Day list</title><style>body{font-family:sans-serif;padding:24px}table{border-collapse:collapse;width:100%;margin-bottom:16px}td{border:1px solid #ccc;padding:6px;font-size:13px}td:first-child{width:110px}</style></head><body><h2>${escapeHtml(clinicName)}</h2><p><strong>${escapeHtml(doctor?.name ?? "")}</strong> · ${escapeHtml(format(day, "EEE d MMM yyyy"))}${onLeave ? " · ON LEAVE" : ""}</p>${rows || "<p>No working hours.</p>"}${extra}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  if (!doctors.length) return <p className="text-sm text-muted-foreground">Add a doctor to see the day schedule.</p>;

  const bookDisabled = trialExpired || onLeave;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap gap-2">
        {doctors.map((d) => (
          <button
            key={d.id}
            onClick={() => setDoctorId(d.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium",
              d.id === doctorId ? "border-info bg-info text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {d.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" aria-label="Previous day" onClick={() => setDay((d) => addDays(d, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <span className="min-w-[9.5rem] text-center text-sm font-semibold text-foreground">{format(day, "EEE d MMM yyyy")}</span>
        <Button size="icon" variant="outline" aria-label="Next day" onClick={() => setDay((d) => addDays(d, 1))}><ChevronRight className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setDay(d); }}>Today</Button>
        {onLeave && <span className="rounded-full bg-danger-surface px-2 py-0.5 text-xs font-medium text-danger">On leave</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Seen", seen], ["In the room", inRoom], ["Booked waiting", waiting], ["Free slots", free]].map(([label, n]) => (
          <div key={label as string} className="rounded-lg border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold text-foreground">{n}</p>
          </div>
        ))}
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading schedule…</p>}
      {!loading && sessions.length === 0 && <p className="text-sm text-muted-foreground">No working hours on this day.</p>}

      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
        {sessionSlots.map((s, i) => (
          <section key={s.start_time} className="min-w-0 space-y-2 rounded-lg border border-border bg-card p-3">
            <h3 className="text-sm font-semibold text-foreground">Session {i + 1} · {formatDisplay(s.start_time)} - {formatDisplay(s.end_time)}</h3>
            {s.slots.map((slot) => {
              const list = bySlot.get(slot);
              return (
                <div key={slot} className="flex min-w-0 items-start gap-3">
                  <span className="w-[9ch] shrink-0 pt-2 text-xs font-medium tabular-nums text-muted-foreground">{formatDisplay(slot)}</span>
                  {list ? (
                    <div className="min-w-0 flex-1 space-y-1">
                      {list.map((t) => <BookedRow key={t.id} token={t} reschedule={renderReschedule(t)} />)}
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md border border-dashed border-info px-3 py-1.5">
                      <span className="text-xs text-info">Free slot</span>
                      {!isPast(slot) && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-info" disabled={bookDisabled} onClick={() => setBookTime(slot)}>
                          <Plus className="mr-1 h-3.5 w-3.5" />Book
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      {outside.length > 0 && (
        <section className="space-y-2 rounded-lg border border-border bg-card p-3">
          <h3 className="text-sm font-semibold text-foreground">Outside the slots / working hours</h3>
          {outside.map((t) => (
            <div key={t.id} className="flex min-w-0 items-start gap-3">
              <span className="w-[9ch] shrink-0 pt-2 text-xs tabular-nums text-muted-foreground">{t.appointment_time ? formatDisplay(t.appointment_time) : "—"}</span>
              <div className="min-w-0 flex-1"><BookedRow token={t} reschedule={renderReschedule(t)} /></div>
            </div>
          ))}
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Switch checked={onLeave} onCheckedChange={toggleLeave} />
          Doctor on leave: block this day
        </label>
        <Button size="sm" variant="outline" onClick={printDay}><Printer className="mr-1 h-4 w-4" />Print day list</Button>
      </div>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block this day?</AlertDialogTitle>
            <AlertDialogDescription>
              {waiting} {waiting === 1 ? "patient is" : "patients are"} already waiting on this day. They will not be notified automatically — please contact or reschedule them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void setLeave(true)}>Block day</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BookSlotDialog
        open={bookTime !== null}
        onOpenChange={(o) => !o && setBookTime(null)}
        clinicId={clinicId}
        doctorId={doctorId}
        doctorName={doctor?.name ?? ""}
        date={key}
        dayLabel={format(day, "EEE d MMM yyyy")}
        time={bookTime}
        onBooked={async (t) => { setBookTime(null); await onBooked(t as T); }}
      />
    </div>
  );
}

function BookedRow({ token, reschedule }: { token: ScheduleToken; reschedule: ReactNode }) {
  const meta = pill[token.status];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
      <span className="min-w-0 truncate text-sm font-medium text-foreground">{token.patient_name}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{maskPhone(token.phone_number)}</span>
      {meta && <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", meta.className)}>{meta.label}</span>}
      {token.status === "waiting" && <span className="ml-auto">{reschedule}</span>}
    </div>
  );
}

function BookSlotDialog({
  open, onOpenChange, clinicId, doctorId, doctorName, date, dayLabel, time, onBooked,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clinicId?: string;
  doctorId: string;
  doctorName: string;
  date: string;
  dayLabel: string;
  time: string | null;
  onBooked: (t: ScheduleToken) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setName(""); setPhone(""); } }, [open]);

  const submit = async () => {
    if (!clinicId || !time) return;
    if (!name.trim()) return toast.error("Patient name required");
    if (!/^[0-9]{10}$/.test(phone)) return toast.error("Enter a valid 10-digit phone number");
    const [h, m] = time.split(":").map(Number);
    const dt = new Date(`${date}T00:00:00`);
    dt.setHours(h, m, 0, 0);
    if (dt.getTime() < Date.now()) return toast.error("Appointment must be in the future.");
    setSaving(true);
    const { data, error } = await supabase
      .from("tokens")
      .insert({
        clinic_id: clinicId,
        patient_name: name.trim(),
        phone_number: phone,
        doctor_id: doctorId,
        token_number: 0,
        appointment_date: date,
        appointment_time: time,
      })
      .select("*")
      .single();
    setSaving(false);
    if (error) {
      if ((error as { code?: string }).code === "23505" || /duplicate|unique/i.test(error.message)) {
        onOpenChange(false);
        return toast.error("This slot was just booked. Please pick another time.");
      }
      return toast.error(error.message);
    }
    toast.success("Patient added");
    await onBooked(data as ScheduleToken);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-sm">
        <DialogHeader>
          <DialogTitle>Book slot</DialogTitle>
          <DialogDescription>{doctorName} · {dayLabel} · {time ? formatDisplay(time) : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="book-name">Patient name</Label>
            <Input id="book-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="book-phone">Phone (10 digits)</Label>
            <Input id="book-phone" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))} />
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Booking..." : "Book"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
