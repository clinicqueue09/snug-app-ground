import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  sendWhatsAppMessage,
  advanceQueueNotifications,
  sendDoctorArrivedForDoctor,
  applyDoctorShiftStatus,
} from "@/lib/whatsapp.functions";
import { submitFeedback } from "@/lib/feedback.functions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { toast } from "sonner";
import {
  LogOut,
  Stethoscope,
  Clock,
  CheckCircle2,
  PlayCircle,
  XCircle,
  UserPlus,
  AlertTriangle,
  Sparkles,
  CalendarIcon,
  Bell,
  CalendarClock,
  Settings,
  Pencil,
  DoorOpen,
  MessageCircle,
  Shield,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { TimeSelect, to24h, parse24h, formatDisplay } from "@/components/TimeSelect";
import { WhatsAppSetupCard, WarmConnectCard } from "@/components/WhatsAppSetupCard";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type Clinic = {
  id: string;
  name: string;
  status: string;
  trial_ends_at: string;
  address: string;
  clinic_mobile: string | null;
  avg_time_per_patient: number;
  whatsapp_connected: boolean;
};
type Doctor = { id: string; name: string; specialty: string | null; avg_time_per_patient: number | null };
type Token = {
  id: string;
  clinic_id: string;
  token_number: number;
  patient_name: string;
  phone_number: string;
  doctor_id: string | null;
  status: "waiting" | "in_consultation" | "completed" | "no_show" | "cancelled";
  appointment_date: string;
  appointment_time: string | null;
  created_at: string;
  doctor_arrived_sent_at?: string | null;
};
type PlatformNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

const statusMeta: Record<Token["status"], { label: string; className: string; icon: React.ElementType }> = {
  waiting: { label: "Waiting", className: "bg-sky-100 text-sky-700 border-sky-200", icon: Clock },
  in_consultation: {
    label: "In Consultation",
    className: "bg-blue-100 text-blue-700 border-blue-200",
    icon: PlayCircle,
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-100 text-emerald-700 border-emerald-200",
    icon: CheckCircle2,
  },
  no_show: { label: "No Show", className: "bg-rose-100 text-rose-700 border-rose-200", icon: XCircle },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-500 border-slate-200", icon: XCircle },
};

const todayISO = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return format(d, "yyyy-MM-dd");
};

/** Chronological sort + dynamic display token. */
function sortAndTokenize(tokens: Token[]): Array<Token & { displayToken: number }> {
  const sorted = tokens.slice().sort((a, b) => {
    const at = a.appointment_time ?? "99:99";
    const bt = b.appointment_time ?? "99:99";
    if (at !== bt) return at.localeCompare(bt);
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
  return sorted.map((t, i) => ({ ...t, displayToken: i + 1 }));
}

function Dashboard() {
  const navigate = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [notifs, setNotifs] = useState<PlatformNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [doctorFilter, setDoctorFilter] = useState<string>("all");

  const sendWhatsApp = useServerFn(sendWhatsAppMessage);
  const advanceQueue = useServerFn(advanceQueueNotifications);
  const sendDoctorArrived = useServerFn(sendDoctorArrivedForDoctor);
  const applyShift = useServerFn(applyDoctorShiftStatus);
  const feedbackFn = useServerFn(submitFeedback);

  const doctorMap = useMemo(() => new Map(doctors.map((d) => [d.id, d])), [doctors]);

  const loadAll = async () => {
    const [c, d, t, n] = await Promise.all([
      supabase
        .from("clinics")
        .select("id,name,status,trial_ends_at,address,clinic_mobile,avg_time_per_patient,whatsapp_connected")
        .limit(1)
        .maybeSingle(),
      supabase.from("doctors").select("id,name,specialty,avg_time_per_patient").eq("is_active", true).order("name"),
      supabase
        .from("tokens")
        .select("*")
        .order("appointment_date")
        .order("appointment_time", { ascending: true, nullsFirst: false }),
      supabase
        .from("platform_notifications")
        .select("id,kind,title,body,read_at,created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (c.data) setClinic(c.data as Clinic);
    if (d.data) setDoctors(d.data as Doctor[]);
    if (t.data) setTokens(t.data as Token[]);
    if (n.data) setNotifs(n.data as PlatformNotification[]);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      setEmail(data.user?.email ?? null);
      setUserId(data.user?.id ?? null);
      if (data.user) {
        const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
        setIsAdmin(((roles as any[]) ?? []).some((r) => r.role === "super_admin"));
      }
    });
    loadAll();
    const channel = supabase
      .channel("dashboard-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "tokens" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "doctors" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "platform_notifications" }, loadAll)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const runAdvance = async (t: Token) => {
    try {
      const res = await advanceQueue({ data: { doctorId: t.doctor_id, appointmentDate: t.appointment_date } });
      if (res.ok && res.queued && res.queued.length > 0) {
        for (const q of res.queued) {
          const r = await sendWhatsApp({
            data: { tokenId: q.tokenId, variant: q.variant, tentativeTime: q.tentativeTime },
          });
          if (!r.ok && r.error) console.warn("[whatsapp]", r.error);
        }
      }
    } catch (e) {
      console.warn("advanceQueue failed", e);
    }
  };

  const updateStatus = async (t: Token, status: Token["status"]) => {
    const { error } = await supabase.from("tokens").update({ status }).eq("id", t.id);
    if (error) return toast.error(error.message);
    toast.success("Updated");
    if (status === "completed" || status === "no_show" || status === "in_consultation") runAdvance(t);
  };

  const trialDaysLeft = clinic
    ? Math.ceil((new Date(clinic.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 0;
  const trialExpired = clinic
    ? new Date(clinic.trial_ends_at).getTime() < Date.now() && clinic.status !== "active"
    : false;
  const showTrialBanner = clinic?.status === "trial" && !trialExpired;

  const today = todayISO();
  const filterDoctor = (t: Token) => doctorFilter === "all" || t.doctor_id === doctorFilter;
  const todayAll = tokens.filter((t) => t.appointment_date === today && t.status !== "cancelled").filter(filterDoctor);
  const todayTokens = sortAndTokenize(todayAll);
  const upcomingAll = tokens.filter((t) => t.appointment_date > today && t.status !== "cancelled");
  const upcomingTokens = sortAndTokenize(upcomingAll);

  const unreadNotifs = notifs.filter((n) => !n.read_at).length;

  return (
    <div className="min-h-screen bg-slate-50">
      {trialExpired && (
        <div className="bg-rose-600 text-white px-6 py-3 flex items-center justify-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" />
          Your 21-day free trial has expired. Please upgrade to continue adding patients.
        </div>
      )}
      {showTrialBanner && (
        <div className="bg-sky-50 border-b border-sky-100 text-sky-900 px-6 py-2.5 flex items-center justify-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-sky-600" />
          <span className="font-medium">
            {trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left
          </span>
          <span className="text-sky-700">in your 21-day free trial</span>
        </div>
      )}

      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-sky-500 text-white flex items-center justify-center shadow-sm shrink-0">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 leading-tight truncate">
                {clinic?.name ?? "Clinic Queue"}
              </div>
              {clinic?.address && <div className="text-sm text-slate-600 truncate">{clinic.address}</div>}
              <div className="text-xs text-slate-500 truncate">{email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <NotificationsBell notifs={notifs} unread={unreadNotifs} onRead={loadAll} />
            <ClinicProfileDialog clinic={clinic} onSaved={loadAll} />
            <ManageDoctorsDialog doctors={doctors} clinicId={clinic?.id} onChange={loadAll} />
            {isAdmin && (
              <Link
                to="/admin/feedback"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 py-1.5 text-xs font-medium"
              >
                <Shield className="h-3.5 w-3.5" /> Admin
              </Link>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="text-slate-500 hover:text-slate-900"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 pt-6 space-y-4">
        <DoctorControlsStrip
          doctors={doctors}
          disabled={trialExpired}
          onDoctorArrived={async (doctorId: string) => {
            const res = await sendDoctorArrived({ data: { doctorId } });
            if (res.ok) toast.success(`Doctor-arrived alerts sent: ${res.sent ?? 0}`);
            else toast.warning(res.error ?? "Send failed");
            loadAll();
          }}
          onAvgChanged={loadAll}
        />
        <DailyShiftPanel
          doctors={doctors}
          tokens={tokens.filter((t) => t.appointment_date === today && t.status === "waiting")}
          disabled={trialExpired}
          onApply={async (doctorId, status, minutes) => {
            const res = await applyShift({ data: { doctorId, status, delayMinutes: minutes } });
            if (res.ok) {
              toast.success(
                status === "delayed"
                  ? `Delay applied. ${res.shifted} slots shifted, ${res.sent} patients notified.`
                  : `Doctor confirmed on time. ${res.sent} patients notified.`,
              );
              loadAll();
            } else {
              toast.error(res.error ?? "Shift update failed");
            }
          }}
        />
      </div>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-1">
          <AddPatientCard
            clinicId={clinic?.id}
            doctors={doctors}
            disabled={trialExpired}
            onAdded={async (createdToken) => {
              await loadAll();
              const res = await sendWhatsApp({ data: { tokenId: createdToken.id, variant: "confirmation" } });
              if (res.ok) toast.success("WhatsApp confirmation sent");
              else if (res.error) toast.warning(res.error);
            }}
          />
        </section>

        <section className="lg:col-span-2 space-y-4">
          <Tabs defaultValue="today">
            <TabsList>
              <TabsTrigger value="today" className="gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Today's Queue
              </TabsTrigger>
              <TabsTrigger value="upcoming" className="gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                Upcoming
              </TabsTrigger>
            </TabsList>

            <TabsContent value="today" className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-slate-900 tracking-tight">Today's Queue</h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {todayTokens.length} {todayTokens.length === 1 ? "patient" : "patients"}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setDoctorFilter("all")}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border",
                      doctorFilter === "all"
                        ? "bg-sky-600 text-white border-sky-600"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
                    )}
                  >
                    All
                  </button>
                  {doctors.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => setDoctorFilter(d.id)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border",
                        doctorFilter === d.id
                          ? "bg-sky-600 text-white border-sky-600"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
                      )}
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              </div>

              <QueueTable
                tokens={todayTokens}
                loading={loading}
                doctorMap={doctorMap}
                onUpdate={updateStatus}
                onEdited={loadAll}
                emptyText="No patients in the queue today."
              />
            </TabsContent>

            <TabsContent value="upcoming" className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900 tracking-tight">Upcoming Appointments</h2>
                <p className="text-sm text-slate-500 mt-0.5">{upcomingTokens.length} scheduled</p>
              </div>
              <QueueTable
                tokens={upcomingTokens}
                loading={loading}
                doctorMap={doctorMap}
                onUpdate={updateStatus}
                onEdited={loadAll}
                emptyText="No upcoming appointments."
                showDate
              />
            </TabsContent>
          </Tabs>
        </section>
      </main>

      <FeedbackTray
        onSubmit={async (message) => {
          const res = await feedbackFn({ data: { message } });
          if (res.ok) toast.success("Thanks for the feedback");
          else toast.error(res.error ?? "Failed to submit");
        }}
      />
    </div>
  );
}

function NotificationsBell({
  notifs,
  unread,
  onRead,
}: {
  notifs: PlatformNotification[];
  unread: number;
  onRead: () => void;
}) {
  const markAllRead = async () => {
    const unreadIds = notifs.filter((n) => !n.read_at).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from("platform_notifications").update({ read_at: new Date().toISOString() }).in("id", unreadIds);
    onRead();
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-slate-200 relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-rose-600 text-white text-[10px] leading-4 text-center">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-semibold">Notifications</div>
          <button className="text-xs text-sky-600 hover:underline" onClick={markAllRead}>
            Mark all read
          </button>
        </div>
        <div className="max-h-80 overflow-auto divide-y">
          {notifs.length === 0 && <div className="p-6 text-center text-sm text-slate-500">No notifications yet.</div>}
          {notifs.map((n) => (
            <div key={n.id} className={cn("p-3 text-sm", !n.read_at && "bg-sky-50/60")}>
              <div className="font-medium text-slate-900">{n.title}</div>
              <div className="text-slate-600 text-xs mt-0.5">{n.body}</div>
              <div className="text-slate-400 text-[10px] mt-1">{new Date(n.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function QueueTable({
  tokens,
  loading,
  doctorMap,
  onUpdate,
  onEdited,
  emptyText,
  showDate,
}: {
  tokens: Array<Token & { displayToken: number }>;
  loading: boolean;
  doctorMap: Map<string, Doctor>;
  onUpdate: (t: Token, s: Token["status"]) => void;
  onEdited: () => void;
  emptyText: string;
  showDate?: boolean;
}) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
              <th className="px-4 py-3 w-16">Token</th>
              <th className="px-4 py-3">Patient</th>
              <th className="px-4 py-3 hidden md:table-cell">Phone</th>
              <th className="px-4 py-3 hidden sm:table-cell">Doctor</th>
              {showDate && <th className="px-4 py-3 hidden md:table-cell">Date</th>}
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : tokens.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                  {emptyText}
                </td>
              </tr>
            ) : (
              tokens.map((t) => (
                <TokenRow
                  key={t.id}
                  token={t}
                  doctor={t.doctor_id ? doctorMap.get(t.doctor_id) : undefined}
                  onUpdate={onUpdate}
                  onEdited={onEdited}
                  showDate={showDate}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TokenRow({
  token,
  doctor,
  onUpdate,
  onEdited,
  showDate,
}: {
  token: Token & { displayToken: number };
  doctor?: Doctor;
  onUpdate: (t: Token, s: Token["status"]) => void;
  onEdited: () => void;
  showDate?: boolean;
}) {
  const meta = statusMeta[token.status];
  const Icon = meta.icon;

  return (
    <tr className="hover:bg-slate-50/60 transition-colors">
      <td className="px-4 py-3">
        <div className="h-9 w-9 rounded-lg bg-sky-50 text-sky-700 font-semibold text-sm flex items-center justify-center">
          {token.displayToken}
        </div>
      </td>
      <td className="px-4 py-3">
        <InlineNameEdit token={token} onSaved={onEdited} />
      </td>
      <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{token.phone_number}</td>
      <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{doctor?.name ?? "—"}</td>
      {showDate && <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{token.appointment_date}</td>}
      <td className="px-4 py-3">
        <InlineTimeEdit token={token} onSaved={onEdited} />
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline" className={`gap-1 font-medium ${meta.className}`}>
          <Icon className="h-3 w-3" />
          {meta.label}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1 flex-wrap">
          {token.status === "waiting" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-blue-700 hover:bg-blue-50"
              onClick={() => onUpdate(token, "in_consultation")}
            >
              Start
            </Button>
          )}
          {token.status === "in_consultation" && (
            <Button
              size="sm"
              variant="ghost"
              className="text-emerald-700 hover:bg-emerald-50"
              onClick={() => onUpdate(token, "completed")}
            >
              Complete
            </Button>
          )}
          {(token.status === "waiting" || token.status === "in_consultation") && (
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-700 hover:bg-rose-50"
              onClick={() => onUpdate(token, "no_show")}
            >
              No Show
            </Button>
          )}
          <RescheduleDialog token={token} onSaved={onEdited} />
        </div>
      </td>
    </tr>
  );
}

function InlineNameEdit({ token, onSaved }: { token: Token; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(token.patient_name);
  useEffect(() => {
    setValue(token.patient_name);
  }, [token.patient_name]);

  const save = async () => {
    const v = value.trim();
    setEditing(false);
    if (!v || v === token.patient_name) return;
    const { error } = await supabase.from("tokens").update({ patient_name: v }).eq("id", token.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Name updated");
      onSaved();
    }
  };

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-left font-medium text-slate-900 hover:text-sky-700 inline-flex items-center gap-1 group"
      >
        {token.patient_name}
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60" />
      </button>
    );
  }
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") setEditing(false);
      }}
      className="h-8 text-sm"
    />
  );
}

function InlineTimeEdit({ token, onSaved }: { token: Token; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const initial = parse24h(token.appointment_time);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [meridiem, setMeridiem] = useState<"AM" | "PM">(initial.meridiem);

  useEffect(() => {
    const p = parse24h(token.appointment_time);
    setHour(p.hour);
    setMinute(p.minute);
    setMeridiem(p.meridiem);
  }, [token.appointment_time]);

  const save = async () => {
    const v = to24h(hour, minute, meridiem);
    setOpen(false);
    if (v === token.appointment_time) return;
    const { error } = await supabase.from("tokens").update({ appointment_time: v }).eq("id", token.id);
    if (error) {
      if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) {
        toast.error("This slot is already booked for this doctor.");
      } else toast.error(error.message);
    } else {
      toast.success("Time updated");
      onSaved();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="text-slate-700 hover:text-sky-700 text-sm">{formatDisplay(token.appointment_time)}</button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <TimeSelect
          hour={hour}
          minute={minute}
          meridiem={meridiem}
          onChange={(v) => {
            setHour(v.hour);
            setMinute(v.minute);
            setMeridiem(v.meridiem);
          }}
        />
        <div className="flex justify-end gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" className="bg-sky-600 hover:bg-sky-700" onClick={save}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RescheduleDialog({ token, onSaved }: { token: Token; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(
    token.appointment_date ? new Date(token.appointment_date + "T00:00:00") : new Date(),
  );
  const initial = parse24h(token.appointment_time);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [meridiem, setMeridiem] = useState<"AM" | "PM">(initial.meridiem);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!date) return toast.error("Pick a date");
    setSaving(true);
    const { error } = await supabase
      .from("tokens")
      .update({
        appointment_date: format(date, "yyyy-MM-dd"),
        appointment_time: to24h(hour, minute, meridiem),
      })
      .eq("id", token.id);
    setSaving(false);
    if (error) {
      if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) {
        return toast.error("This slot is already booked for this doctor.");
      }
      return toast.error(error.message);
    }
    toast.success("Rescheduled");
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-slate-600 hover:bg-slate-100">
          <CalendarClock className="h-3.5 w-3.5 mr-1" />
          Reschedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reschedule appointment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">Appointment Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">Appointment Time</Label>
            <TimeSelect
              hour={hour}
              minute={minute}
              meridiem={meridiem}
              onChange={(v) => {
                setHour(v.hour);
                setMinute(v.minute);
                setMeridiem(v.meridiem);
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="bg-sky-600 hover:bg-sky-700">
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPatientCard({
  clinicId,
  doctors,
  disabled,
  onAdded,
}: {
  clinicId?: string;
  doctors: Doctor[];
  disabled: boolean;
  onAdded: (t: Token) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [doctorId, setDoctorId] = useState<string>("");
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");
  const [meridiem, setMeridiem] = useState<"AM" | "PM">("AM");
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const phoneValid = /^[0-9]{10}$/.test(phone);
  const phoneError = touched && !phoneValid;

  const submit = async () => {
    setTouched(true);
    if (!clinicId) return toast.error("Clinic not loaded");
    if (!name.trim()) return toast.error("Patient name required");
    if (!phoneValid) return toast.error("Enter a valid 10-digit phone number");
    if (!doctorId) return toast.error("Doctor is required");
    if (!date) return toast.error("Pick an appointment date");
    if (!hour || !minute) return toast.error("Pick an appointment time");
    setSaving(true);
    const { data, error } = await supabase
      .from("tokens")
      .insert({
        clinic_id: clinicId,
        patient_name: name.trim(),
        phone_number: phone,
        doctor_id: doctorId,
        token_number: 0,
        appointment_date: format(date, "yyyy-MM-dd"),
        appointment_time: to24h(hour, minute, meridiem),
      })
      .select("*")
      .single();
    setSaving(false);
    if (error) {
      if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) {
        return toast.error("This slot is already booked for this doctor. Pick another time.");
      }
      return toast.error(error.message);
    }
    toast.success("Patient added");
    setName("");
    setPhone("");
    setDoctorId("");
    setHour("");
    setMinute("");
    setMeridiem("AM");
    setDate(new Date());
    setTouched(false);
    onAdded(data as Token);
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
            <CardDescription className="text-xs">
              Insert between existing slots — tokens re-number automatically.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset disabled={disabled} className="space-y-4 disabled:opacity-50">
          <div className="space-y-1.5">
            <Label htmlFor="pname" className="text-xs font-medium text-slate-700">
              Patient Name <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="pname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="border-slate-200"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-xs font-medium text-slate-700">
              Phone Number <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              onBlur={() => setTouched(true)}
              inputMode="numeric"
              placeholder="10-digit mobile number"
              className={cn("border-slate-200", phoneError && "border-rose-400 focus-visible:ring-rose-400")}
            />
            {phoneError && <p className="text-xs text-rose-600">Enter exactly 10 digits.</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">
              Doctor <span className="text-rose-500">*</span>
            </Label>
            <Select value={doctorId} onValueChange={setDoctorId}>
              <SelectTrigger className="border-slate-200">
                <SelectValue placeholder="Select a doctor" />
              </SelectTrigger>
              <SelectContent>
                {doctors.length === 0 && <div className="px-2 py-1.5 text-sm text-slate-500">No doctors yet</div>}
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                    {d.specialty ? ` · ${d.specialty}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal border-slate-200",
                    !date && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "MMM d, yyyy") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={setDate}
                  disabled={(d) => {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    return d < today;
                  }}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-slate-700">Time</Label>
            <TimeSelect
              hour={hour}
              minute={minute}
              meridiem={meridiem}
              onChange={(v) => {
                setHour(v.hour);
                setMinute(v.minute);
                setMeridiem(v.meridiem);
              }}
            />
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

function ClinicProfileDialog({ clinic, onSaved }: { clinic: Clinic | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(clinic?.name ?? "");
  const [address, setAddress] = useState(clinic?.address ?? "");
  const [mobile, setMobile] = useState(clinic?.clinic_mobile ?? "");
  const [avg, setAvg] = useState(String(clinic?.avg_time_per_patient ?? 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && clinic) {
      setName(clinic.name);
      setAddress(clinic.address);
      setMobile(clinic.clinic_mobile ?? "");
      setAvg(String(clinic.avg_time_per_patient));
    }
  }, [open, clinic]);

  const save = async () => {
    if (!clinic) return;
    if (!name.trim() || !address.trim()) return toast.error("Name and address are required.");
    if (mobile && !/^[0-9]{10}$/.test(mobile)) return toast.error("Mobile must be 10 digits.");
    const avgN = parseInt(avg, 10);
    if (!Number.isFinite(avgN) || avgN < 1 || avgN > 240) return toast.error("Avg time must be 1–240 minutes.");
    setSaving(true);
    const { error } = await supabase
      .from("clinics")
      .update({
        name: name.trim(),
        address: address.trim(),
        clinic_mobile: mobile.trim() || null,
        avg_time_per_patient: avgN,
      })
      .eq("id", clinic.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Clinic profile updated");
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-slate-200 text-slate-700">
          <Settings className="h-3.5 w-3.5 mr-1.5" />
          Profile
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clinic Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              Clinic Name <span className="text-rose-500">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Full Clinic Address / Google Map Link <span className="text-rose-500">*</span>
            </Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, City / https://maps.google.com/…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Clinic's Whatsapp Number <span className="text-rose-500">*</span>
              </Label>
              <Input
                required
                inputMode="numeric"
                placeholder="10-digit WhatsApp number"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
              />
              <p className="text-[10px] text-muted-foreground">
                Must be an active WhatsApp number to route queue alerts
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Clinic default avg time / patient (min)</Label>
              <Input
                inputMode="numeric"
                value={avg}
                onChange={(e) => setAvg(e.target.value.replace(/\D/g, "").slice(0, 3))}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="bg-sky-600 hover:bg-sky-700">
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageDoctorsDialog({
  doctors,
  clinicId,
  onChange,
}: {
  doctors: Doctor[];
  clinicId?: string;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [avg, setAvg] = useState("");
  const add = async () => {
    if (!clinicId) return toast.error("Clinic not loaded");
    if (!name.trim()) return toast.error("Name required");
    if (!specialty.trim()) return toast.error("Specialty required");
    const avgParsed = avg.trim() === "" ? null : parseInt(avg, 10);
    if (avgParsed !== null && (!Number.isFinite(avgParsed) || avgParsed < 1 || avgParsed > 240)) {
      return toast.error("Avg time must be 1–240 minutes (or blank).");
    }
    const { error } = await supabase.from("doctors").insert({
      clinic_id: clinicId,
      name: name.trim(),
      specialty: specialty.trim(),
      avg_time_per_patient: avgParsed,
    });
    if (error) return toast.error(error.message);
    setName("");
    setSpecialty("");
    setAvg("");
    onChange();
  };

  const updateAvg = async (id: string, raw: string) => {
    const trimmed = raw.trim();
    const parsed = trimmed === "" ? null : parseInt(trimmed, 10);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 1 || parsed > 240)) {
      return toast.error("Avg time must be 1–240 minutes (or blank).");
    }
    const { error } = await supabase.from("doctors").update({ avg_time_per_patient: parsed }).eq("id", id);
    if (error) return toast.error(error.message);
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
        <Button size="sm" variant="outline" className="border-slate-200 text-slate-700">
          Doctors
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Doctors</DialogTitle>
          <DialogDescription className="text-xs">
            Specialty is required. Avg time per patient is optional (blank uses clinic default).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Specialty *" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
            <Input
              placeholder="Avg min (opt)"
              inputMode="numeric"
              value={avg}
              onChange={(e) => setAvg(e.target.value.replace(/\D/g, "").slice(0, 3))}
            />
          </div>
          <Button onClick={add} size="sm" className="bg-sky-600 hover:bg-sky-700">
            Add doctor
          </Button>
          <div className="space-y-2 pt-2">
            {doctors.length === 0 && <div className="text-sm text-slate-500">No doctors yet.</div>}
            {doctors.map((d) => (
              <div key={d.id} className="flex items-center gap-2 border border-slate-200 rounded-md px-3 py-2">
                <div className="text-sm flex-1 min-w-0">
                  <div className="font-medium text-slate-900 truncate">{d.name}</div>
                  {d.specialty && <div className="text-xs text-slate-500 truncate">{d.specialty}</div>}
                </div>
                <div className="flex items-center gap-1">
                  <Timer className="h-3.5 w-3.5 text-slate-400" />
                  <Input
                    defaultValue={d.avg_time_per_patient == null ? "" : String(d.avg_time_per_patient)}
                    onBlur={(e) => updateAvg(d.id, e.target.value.replace(/\D/g, "").slice(0, 3))}
                    inputMode="numeric"
                    placeholder="—"
                    className="w-16 h-8 text-sm"
                  />
                  <span className="text-xs text-slate-400">min</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-rose-600 hover:bg-rose-50"
                  onClick={() => remove(d.id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DoctorControlsStrip({
  doctors,
  disabled,
  onDoctorArrived,
  onAvgChanged,
}: {
  doctors: Doctor[];
  disabled: boolean;
  onDoctorArrived: (doctorId: string) => void | Promise<void>;
  onAvgChanged: () => void;
}) {
  if (doctors.length === 0) return null;
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-slate-700">Active doctors</CardTitle>
        <CardDescription className="text-xs">
          Set per-doctor avg consult time and mark the doctor's arrival for today.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {doctors.map((d) => (
            <DoctorControlCard
              key={d.id}
              doctor={d}
              disabled={disabled}
              onDoctorArrived={onDoctorArrived}
              onAvgChanged={onAvgChanged}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DoctorControlCard({
  doctor,
  disabled,
  onDoctorArrived,
  onAvgChanged,
}: {
  doctor: Doctor;
  disabled: boolean;
  onDoctorArrived: (doctorId: string) => void | Promise<void>;
  onAvgChanged: () => void;
}) {
  const [avg, setAvg] = useState<string>(
    doctor.avg_time_per_patient == null ? "" : String(doctor.avg_time_per_patient),
  );
  const [saving, setSaving] = useState(false);
  const [arriving, setArriving] = useState(false);
  useEffect(() => {
    setAvg(doctor.avg_time_per_patient == null ? "" : String(doctor.avg_time_per_patient));
  }, [doctor.avg_time_per_patient]);

  const saveAvg = async () => {
    const trimmed = avg.trim();
    const parsed = trimmed === "" ? null : parseInt(trimmed, 10);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 1 || parsed > 240)) {
      return toast.error("Avg time must be 1–240 minutes (or blank).");
    }
    if (parsed === doctor.avg_time_per_patient) return;
    setSaving(true);
    const { error } = await supabase.from("doctors").update({ avg_time_per_patient: parsed }).eq("id", doctor.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Avg time updated");
    onAvgChanged();
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3 flex flex-col gap-2 bg-white">
      <div>
        <div className="font-medium text-slate-900 text-sm truncate">{doctor.name}</div>
        <div className="text-xs text-slate-500 truncate">{doctor.specialty ?? "—"}</div>
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-xs text-slate-600 whitespace-nowrap">Avg (min)</Label>
        <Input
          inputMode="numeric"
          value={avg}
          onChange={(e) => setAvg(e.target.value.replace(/\D/g, "").slice(0, 3))}
          onBlur={saveAvg}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="—"
          disabled={saving}
          className="h-8 text-sm"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || arriving}
        onClick={async () => {
          setArriving(true);
          await onDoctorArrived(doctor.id);
          setArriving(false);
        }}
        className="border-emerald-200 text-emerald-700 hover:bg-emerald-50"
      >
        <DoorOpen className="h-3.5 w-3.5 mr-1.5" />
        {arriving ? "Sending…" : "Doctor Arrived"}
      </Button>
    </div>
  );
}

function DailyShiftPanel({
  doctors,
  tokens,
  disabled,
  onApply,
}: {
  doctors: Doctor[];
  tokens: Token[];
  disabled: boolean;
  onApply: (doctorId: string, status: "on_time" | "delayed", minutes?: number) => Promise<void>;
}) {
  if (doctors.length === 0) return null;
  const now = new Date();

  const byDoctor = new Map<string, Token[]>();
  for (const t of tokens) {
    if (!t.doctor_id) continue;
    if (!byDoctor.has(t.doctor_id)) byDoctor.set(t.doctor_id, []);
    byDoctor.get(t.doctor_id)!.push(t);
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-slate-700 flex items-center gap-2">
          <Timer className="h-4 w-4" /> Daily shift status
        </CardTitle>
        <CardDescription className="text-xs">
          Confirm on time or declare a delay — allowed up to 45 minutes before the doctor's first appointment.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {doctors.map((d) => {
            const list = (byDoctor.get(d.id) ?? [])
              .filter((t) => t.appointment_time)
              .sort((a, b) => (a.appointment_time ?? "").localeCompare(b.appointment_time ?? ""));
            const first = list[0]?.appointment_time ?? null;
            let allowed = false;
            let reason = "No waiting patients today";
            if (first && /^\d{1,2}:\d{2}$/.test(first)) {
              const [fh, fm] = first.split(":").map((n) => parseInt(n, 10));
              const dt = new Date();
              dt.setHours(fh, fm, 0, 0);
              const cutoff = new Date(dt.getTime() - 45 * 60_000);
              allowed = now <= cutoff && !disabled;
              reason = allowed ? "" : `Window closed (first appt ${first})`;
            }
            return (
              <ShiftDoctorCard
                key={d.id}
                doctor={d}
                allowed={allowed}
                reason={reason}
                first={first}
                onApply={onApply}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ShiftDoctorCard({
  doctor,
  allowed,
  reason,
  first,
  onApply,
}: {
  doctor: Doctor;
  allowed: boolean;
  reason: string;
  first: string | null;
  onApply: (doctorId: string, status: "on_time" | "delayed", minutes?: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [delayOpen, setDelayOpen] = useState(false);
  const [minutes, setMinutes] = useState("15");

  const runOnTime = async () => {
    setBusy(true);
    await onApply(doctor.id, "on_time");
    setBusy(false);
  };
  const runDelay = async () => {
    const m = parseInt(minutes, 10);
    if (!Number.isFinite(m) || m < 1) return toast.error("Enter a positive delay in minutes");
    setBusy(true);
    await onApply(doctor.id, "delayed", m);
    setBusy(false);
    setDelayOpen(false);
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3 flex flex-col gap-2 bg-white">
      <div>
        <div className="font-medium text-slate-900 text-sm truncate">{doctor.name}</div>
        <div className="text-xs text-slate-500 truncate">First today: {first ? formatDisplay(first) : "—"}</div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!allowed || busy}
          className="flex-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          onClick={runOnTime}
        >
          On Time
        </Button>
        <Dialog open={delayOpen} onOpenChange={setDelayOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={!allowed || busy}
              className="flex-1 border-amber-200 text-amber-700 hover:bg-amber-50"
            >
              Declare Delay
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Declare delay for {doctor.name}</DialogTitle>
              <DialogDescription>
                Shifts every today's waiting slot for this doctor forward and notifies patients.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs">Delay in minutes</Label>
              <Input
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDelayOpen(false)}>
                Cancel
              </Button>
              <Button onClick={runDelay} disabled={busy} className="bg-amber-600 hover:bg-amber-700">
                {busy ? "Applying…" : "Apply delay & notify"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {!allowed && <div className="text-[11px] text-slate-500">{reason}</div>}
    </div>
  );
}

function FeedbackTray({ onSubmit }: { onSubmit: (message: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const send = async () => {
    const v = msg.trim();
    if (!v) return toast.error("Add a message first");
    setSaving(true);
    await onSubmit(v);
    setSaving(false);
    setMsg("");
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-sky-600 hover:bg-sky-700 text-white px-4 py-3 shadow-lg text-sm font-medium"
          aria-label="Open feedback"
        >
          <MessageCircle className="h-4 w-4" /> Suggestions / Feedback
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Suggestions / Feedback</DialogTitle>
          <DialogDescription>
            Tell us what would make ClinicQ better. Your note goes to the ClinicQ team.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          rows={5}
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Share suggestions, bugs, ideas…"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={send} disabled={saving} className="bg-sky-600 hover:bg-sky-700">
            {saving ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
