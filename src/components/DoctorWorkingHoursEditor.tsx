import { useEffect, useMemo, useState } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { validateAvailabilityDraft, type AvailabilityRow } from "@/lib/scheduling";

const DAYS = [
  { label: "Mon", weekday: 1 },
  { label: "Tue", weekday: 2 },
  { label: "Wed", weekday: 3 },
  { label: "Thu", weekday: 4 },
  { label: "Fri", weekday: 5 },
  { label: "Sat", weekday: 6 },
  { label: "Sun", weekday: 0 },
];

type Session = { start_time: string; end_time: string };
const EMPTY_SESSION: Session = { start_time: "09:00", end_time: "13:00" };

function toDisplayTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function sessionSummary(rows: AvailabilityRow[]) {
  const dayNames = DAYS.filter(({ weekday }) => rows.some((row) => row.weekday === weekday)).map(({ label }) => label);
  const sessions = [...new Map(rows.map((row) => [`${row.start_time}-${row.end_time}`, row])).values()]
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((row) => `${toDisplayTime(row.start_time)}-${toDisplayTime(row.end_time)}`);
  if (dayNames.length === 0) return "Not set, default hours are used";
  return `${dayNames.join(", ")} · ${sessions.join(", ")}`;
}

export function DoctorWorkingHoursEditor({ doctorId, clinicId }: { doctorId: string; clinicId: string }) {
  const [open, setOpen] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [session1, setSession1] = useState<Session>({ ...EMPTY_SESSION });
  const [hasSession2, setHasSession2] = useState(false);
  const [session2, setSession2] = useState<Session>({ start_time: "17:00", end_time: "21:00" });
  const [savedRows, setSavedRows] = useState<AvailabilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("doctor_availability")
      .select("weekday,start_time,end_time")
      .eq("doctor_id", doctorId)
      .eq("clinic_id", clinicId)
      .order("weekday")
      .order("start_time");
    setLoading(false);
    if (error) return toast.error(`Could not load working hours: ${error.message}`);
    const rows = (data ?? []) as AvailabilityRow[];
    setSavedRows(rows);
    if (rows.length === 0) {
      setSelectedDays([]);
      setSession1({ ...EMPTY_SESSION });
      setHasSession2(false);
      setSession2({ start_time: "17:00", end_time: "21:00" });
      return;
    }
    setSelectedDays([...new Set(rows.map((row) => row.weekday))]);
    const sessions = [...new Map(rows.map((row) => [`${row.start_time}-${row.end_time}`, {
      start_time: row.start_time,
      end_time: row.end_time,
    }])).values()].sort((a, b) => a.start_time.localeCompare(b.start_time));
    setSession1(sessions[0] ?? { ...EMPTY_SESSION });
    setHasSession2(sessions.length > 1);
    setSession2(sessions[1] ?? { start_time: "17:00", end_time: "21:00" });
  };

  useEffect(() => { void load(); }, [doctorId, clinicId]);

  const summary = useMemo(() => sessionSummary(savedRows), [savedRows]);

  const save = async () => {
    const validationError = validateAvailabilityDraft({
      days: selectedDays,
      session1,
      session2: hasSession2 ? session2 : undefined,
    });
    if (validationError) return toast.error(validationError);
    setSaving(true);
    const oldRowsQuery = await supabase
      .from("doctor_availability")
      .select("id")
      .eq("doctor_id", doctorId)
      .eq("clinic_id", clinicId);
    if (oldRowsQuery.error) {
      setSaving(false);
      return toast.error(`Could not check existing hours: ${oldRowsQuery.error.message}`);
    }
    const rows = selectedDays.flatMap((weekday) => [
      { clinic_id: clinicId, doctor_id: doctorId, weekday, ...session1 },
      ...(hasSession2 ? [{ clinic_id: clinicId, doctor_id: doctorId, weekday, ...session2 }] : []),
    ]);
    const inserted = await supabase.from("doctor_availability").insert(rows).select("id");
    if (inserted.error) {
      setSaving(false);
      return toast.error(`Could not save working hours: ${inserted.error.message}`);
    }
    const oldIds = (oldRowsQuery.data ?? []).map((row) => row.id);
    if (oldIds.length > 0) {
      const removedOld = await supabase.from("doctor_availability").delete().in("id", oldIds);
      if (removedOld.error) {
        const insertedIds = (inserted.data ?? []).map((row) => row.id);
        if (insertedIds.length > 0) {
          await supabase.from("doctor_availability").delete().in("id", insertedIds);
        }
        setSaving(false);
        return toast.error(`Could not replace working hours: ${removedOld.error.message}`);
      }
    }
    setSaving(false);
    toast.success("Working hours saved");
    await load();
  };

  const useDefaults = async () => {
    if (savedRows.length === 0) return;
    setSaving(true);
    const { error } = await supabase
      .from("doctor_availability")
      .delete()
      .eq("doctor_id", doctorId)
      .eq("clinic_id", clinicId);
    setSaving(false);
    if (error) return toast.error(`Could not restore default hours: ${error.message}`);
    toast.success("Default working hours restored");
    await load();
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 flex-1 basis-full">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="h-auto w-full justify-between whitespace-normal px-1 py-2 text-left text-xs">
          <span className="min-w-0"><span className="font-semibold">Working hours</span><span className="ml-2 text-muted-foreground">{loading ? "Loading…" : summary}</span></span>
          <ChevronDown className={`ml-2 h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t border-border pt-3">
        <div className="flex flex-wrap gap-2" aria-label="Working days">
          {DAYS.map(({ label, weekday }) => {
            const checked = selectedDays.includes(weekday);
            return (
              <Button
                key={weekday}
                type="button"
                size="sm"
                variant={checked ? "default" : "outline"}
                aria-pressed={checked}
                onClick={() => setSelectedDays((current) => checked ? current.filter((day) => day !== weekday) : [...current, weekday])}
                className="h-8 min-w-12"
              >
                {label}
              </Button>
            );
          })}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-xs font-medium">Session 1</p>
            <div className="grid grid-cols-2 gap-2">
              <Input aria-label="Session 1 start" type="time" value={session1.start_time} onChange={(event) => setSession1({ ...session1, start_time: event.target.value })} />
              <Input aria-label="Session 1 end" type="time" value={session1.end_time} onChange={(event) => setSession1({ ...session1, end_time: event.target.value })} />
            </div>
          </div>
          <div className="space-y-2 rounded-md border border-border p-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
              <Checkbox checked={hasSession2} onCheckedChange={(checked) => setHasSession2(checked === true)} />
              Session 2
            </label>
            {hasSession2 && (
              <div className="grid grid-cols-2 gap-2">
                <Input aria-label="Session 2 start" type="time" value={session2.start_time} onChange={(event) => setSession2({ ...session2, start_time: event.target.value })} />
                <Input aria-label="Session 2 end" type="time" value={session2.end_time} onChange={(event) => setSession2({ ...session2, end_time: event.target.value })} />
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" variant="outline" disabled={saving || savedRows.length === 0} onClick={useDefaults}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Use default hours
          </Button>
          <Button type="button" size="sm" disabled={saving || loading} onClick={save}>
            {saving ? "Saving…" : "Save hours"}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}