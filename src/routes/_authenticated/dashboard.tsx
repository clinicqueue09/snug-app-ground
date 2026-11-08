import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useState } from "react";
import { todayISTString } from "@/lib/token-note";
import { supabase } from "@/integrations/supabase/client";
import {
  notifyPatient,
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
import { cn, isValidGoogleMapsLink } from "@/lib/utils";
import { format } from "date-fns";
import { TimeSelect, to24h, parse24h, formatDisplay } from "@/components/TimeSelect";
import { DurationSelect } from "@/components/DurationSelect";
import { SlotPicker } from "@/components/SlotPicker";
import { DoctorDaySchedule } from "@/components/DoctorDaySchedule";
import { DoctorWorkingHoursEditor } from "@/components/DoctorWorkingHoursEditor";
import { WhatsAppSetupCard } from "@/components/WhatsAppSetupCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import logoUrl from "@/assets/logo.png";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [
    {"title": "Appointments and queue · ClinicQ"},
    {"name": "description", "content": "Manage clinic bookings, doctor schedules, and patient notifications."},
    {"property": "og:title", "content": "Appointments and queue · ClinicQ"},
    {"property": "og:description", "content": "Manage clinic bookings, doctor schedules, and patient notifications."},
    {"property": "og:type", "content": "website"},
    {"name": "twitter:card", "content": "summary_large_image"},
  ] }),
  component: Dashboard,
});

type Clinic = {
  id: string;
  name: string;
  status: string;
  trial_ends_at: string;
  address: string;
  map_link: string | null;
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
  reported_at?: string | null;
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
  waiting: { label: "Waiting", className: "bg-info-surface text-info border-info", icon: Clock },
  in_consultation: {
    label: "In Consultation",
    className: "bg-info-surface text-info border-info",
    icon: PlayCircle,
  },
  completed: {
    label: "Completed",
    className: "bg-success-surface text-success border-success",
    icon: CheckCircle2,
  },
  no_show: { label: "No Show", className: "bg-danger-surface text-danger border-danger", icon: XCircle },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground border-border", icon: XCircle },
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

  const notify = useServerFn(notifyPatient);
  const advanceQueue = useServerFn(advanceQueueNotifications);
  const sendDoctorArrived = useServerFn(sendDoctorArrivedForDoctor);
  const applyShift = useServerFn(applyDoctorShiftStatus);
  const feedbackFn = useServerFn(submitFeedback);

  const doctorMap = useMemo(() => new Map(doctors.map((d) => [d.id, d])), [doctors]);

  const loadAll = async () => {
    const [c, d, t, n] = await Promise.all([
      supabase
        .from("clinics")
        .select("id,name,status,trial_ends_at,address,map_link,clinic_mobile,avg_time_per_patient,whatsapp_connected")
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
          const messageType = q.variant === "next_in_line" ? "next_in_line" : "queue_update";
          const r = await notify({
            data: { tokenId: q.tokenId, messageType, tentativeTime: q.tentativeTime },
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
  // Chronological: earliest date first, then earliest time (nulls last, created_at tiebreak)
  const upcomingTokens = upcomingAll.slice().sort((a, b) => {
    if (a.appointment_date !== b.appointment_date) return a.appointment_date.localeCompare(b.appointment_date);
    const at = a.appointment_time ?? "99:99";
    const bt = b.appointment_time ?? "99:99";
    if (at !== bt) return at.localeCompare(bt);
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
  // 30-day history: past dates (excluding today), any status
  const historyCutoff = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    d.setHours(0, 0, 0, 0);
    return format(d, "yyyy-MM-dd");
  })();
  const historyAll = tokens
    .filter((t) => t.appointment_date < today && t.appointment_date >= historyCutoff)
    .filter(filterDoctor);
  const historyTokens = sortAndTokenize(
    historyAll.slice().sort((a, b) => b.appointment_date.localeCompare(a.appointment_date)),
  );

  const unreadNotifs = notifs.filter((n) => !n.read_at).length;

  return (
    <div className="dashboard-theme min-h-screen bg-background">
      {trialExpired && (
        <div className="bg-danger text-primary-foreground px-6 py-3 flex items-center justify-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4" />
          Your 21-day free trial has expired. Please upgrade to continue adding patients.
        </div>
      )}
      {showTrialBanner && (
        <div className="bg-info-surface border-b border-info text-info px-6 py-2.5 flex items-center justify-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-info" />
          <span className="font-medium">
            {trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left
          </span>
          <span className="text-info">in your 21-day free trial</span>
        </div>
      )}

      <PilotBanner />
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={logoUrl}
              alt="ClinicQ logo"
              width={40}
              height={40}
              className="h-10 w-10 rounded-xl shadow-sm shrink-0 bg-card object-contain"
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-semibold text-foreground leading-tight truncate">
                  {clinic?.name ?? "Clinic Queue"}
                </span>
                <span className="rounded-full bg-info-surface text-info px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  Pilot
                </span>
              </div>
              {clinic?.address && <div className="text-sm text-muted-foreground truncate">{clinic.address}</div>}
              <div className="text-xs text-muted-foreground truncate">{email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <NotificationsBell notifs={notifs} unread={unreadNotifs} onRead={loadAll} />
            <ClinicProfileDialog clinic={clinic} onSaved={loadAll} />
            <ManageDoctorsDialog doctors={doctors} clinicId={clinic?.id} onChange={loadAll} />
            {isAdmin && (
              <Link
                to="/admin/feedback"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card text-foreground hover:bg-muted px-3 py-1.5 text-xs font-medium"
              >
                <Shield className="h-3.5 w-3.5" /> Admin
              </Link>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="text-muted-foreground hover:text-foreground"
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
          onApply={async (doctorId, delta) => {
            const res = await applyShift({ data: { doctorId, deltaMinutes: delta } });
            if (!res.ok) { toast.error(res.error ?? "Shift update failed"); return false; }
            const head = res.cumulative > 0 ? `Delay now ${res.cumulative} min.` : "Doctor back on time.";
            const moved = `${res.shifted} ${res.shifted === 1 ? "patient" : "patients"} moved`;
            const msg = res.notified > 0 ? `, ${res.notified} notified.` : res.capReached ? ", nobody messaged." : ", nobody messaged yet (under 10 minutes).";
            const extra = (res.skipped > 0 ? ` ${res.skipped} could not be moved.` : "") +
              (res.capReached ? " Message limit reached, please call the remaining patients." : "");
            (res.capReached || res.skipped > 0 ? toast.warning : toast.success)(`${head} ${moved}${res.shifted === 0 ? "." : msg}${extra}`);
            loadAll();
            return true;
          }}
        />
        <div className="grid grid-cols-1 gap-4">
          <WhatsAppSetupCard
            clinicId={clinic?.id}
            connected={Boolean(clinic?.whatsapp_connected)}
            onChange={loadAll}
          />
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-6">
        <section className="min-w-0">
          <AddPatientCard
            clinicId={clinic?.id}
            clinicDuration={clinic?.avg_time_per_patient ?? 10}
            doctors={doctors}
            disabled={trialExpired}
            onAdded={async (createdToken) => {
              await loadAll();
              const res = await notify({ data: { tokenId: createdToken.id, messageType: "confirmation" } });
              if (res.ok) toast.success(res.channel === "sms" ? "SMS confirmation sent" : "WhatsApp confirmation sent");
              else if (res.error) toast.warning(res.error);
            }}
          />
        </section>

        <section className="min-w-0 space-y-4">
          <Tabs defaultValue="today">
            <TabsList className="grid h-auto w-full grid-cols-4 sm:inline-flex sm:w-auto">
              <TabsTrigger value="today" className="gap-1 px-1.5 text-xs sm:px-3 sm:text-sm">
                <Clock className="h-3.5 w-3.5" />
                Today's Queue
              </TabsTrigger>
              <TabsTrigger value="upcoming" className="gap-1 px-1.5 text-xs sm:px-3 sm:text-sm">
                <CalendarClock className="h-3.5 w-3.5" />
                Upcoming
              </TabsTrigger>
              <TabsTrigger value="schedule" className="gap-1 px-1.5 text-xs sm:px-3 sm:text-sm">
                <CalendarIcon className="h-3.5 w-3.5" />
                Schedule
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1 px-1.5 text-xs sm:px-3 sm:text-sm">
                <CalendarClock className="h-3.5 w-3.5" />
                History (30d)
              </TabsTrigger>
            </TabsList>

            <TabsContent value="today" className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-foreground tracking-tight">Today's Queue</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {todayTokens.length} {todayTokens.length === 1 ? "patient" : "patients"}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setDoctorFilter("all")}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border",
                      doctorFilter === "all"
                        ? "bg-info text-primary-foreground border-info"
                        : "bg-card text-muted-foreground border-border hover:bg-muted",
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
                          ? "bg-info text-primary-foreground border-info"
                          : "bg-card text-muted-foreground border-border hover:bg-muted",
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
                <h2 className="text-xl font-semibold text-foreground tracking-tight">Upcoming Appointments</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{upcomingTokens.length} scheduled</p>
              </div>
              <UpcomingList
                tokens={upcomingTokens}
                loading={loading}
                doctorMap={doctorMap}
                onUpdate={updateStatus}
                onEdited={loadAll}
                emptyText="No upcoming appointments."
              />
            </TabsContent>

            <TabsContent value="schedule" className="space-y-4">
              <DoctorDaySchedule
                clinicId={clinic?.id}
                clinicName={clinic?.name ?? ""}
                clinicDuration={clinic?.avg_time_per_patient ?? 10}
                doctors={doctors}
                tokens={tokens}
                trialExpired={trialExpired}
                renderReschedule={(t) => <RescheduleDialog token={t} onSaved={loadAll} />}
                onBooked={async (createdToken) => {
                  await loadAll();
                  const res = await notify({ data: { tokenId: createdToken.id, messageType: "confirmation" } });
                  if (res.ok) toast.success(res.channel === "sms" ? "SMS confirmation sent" : "WhatsApp confirmation sent");
                  else if (res.error) toast.warning(res.error);
                }}
              />
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold text-foreground tracking-tight">History</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Last 30 days · {historyTokens.length} records</p>
              </div>
              <QueueTable
                tokens={historyTokens}
                loading={loading}
                doctorMap={doctorMap}
                onUpdate={updateStatus}
                onEdited={loadAll}
                emptyText="No history in the last 30 days."
                showDate
                readOnly
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
        <Button variant="outline" size="sm" className="border-border relative">
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-danger text-primary-foreground text-[10px] leading-4 text-center">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-semibold">Notifications</div>
          <button className="text-xs text-info hover:underline" onClick={markAllRead}>
            Mark all read
          </button>
        </div>
        <div className="max-h-80 overflow-auto divide-y">
          {notifs.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No notifications yet.</div>}
          {notifs.map((n) => (
            <div key={n.id} className={cn("p-3 text-sm", !n.read_at && "bg-info-surface/60")}>
              <div className="font-medium text-foreground">{n.title}</div>
              <div className="text-muted-foreground text-xs mt-0.5">{n.body}</div>
              <div className="text-muted-foreground text-[10px] mt-1">{new Date(n.created_at).toLocaleString()}</div>
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
  readOnly,
}: {
  tokens: Array<Token & { displayToken: number }>;
  loading: boolean;
  doctorMap: Map<string, Doctor>;
  onUpdate: (t: Token, s: Token["status"]) => void;
  onEdited: () => void;
  emptyText: string;
  showDate?: boolean;
  readOnly?: boolean;
}) {
  return (
    <Card className="border-border shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              <th className="px-3 py-2 w-14">Token</th>
              <th className="px-3 py-2">Patient</th>
              <th className="px-3 py-2 hidden lg:table-cell">Phone</th>
              <th className="px-3 py-2 hidden md:table-cell">Doctor</th>
              {showDate && <th className="px-3 py-2 hidden md:table-cell">Date</th>}
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : tokens.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
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
                  readOnly={readOnly}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function UpcomingList({
  tokens,
  loading,
  doctorMap,
  onUpdate,
  onEdited,
  emptyText,
}: {
  tokens: Token[];
  loading: boolean;
  doctorMap: Map<string, Doctor>;
  onUpdate: (t: Token, s: Token["status"]) => void;
  onEdited: () => void;
  emptyText: string;
}) {
  const groups: Array<{ date: string; label: string; items: Token[] }> = [];
  for (const t of tokens) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.appointment_date) last.items.push(t);
    else {
      groups.push({
        date: t.appointment_date,
        label: format(new Date(t.appointment_date + "T00:00:00"), "EEE d MMM"),
        items: [t],
      });
    }
  }
  return (
    <Card className="border-border shadow-sm">
      {loading ? (
        <div className="px-4 py-10 text-center text-muted-foreground text-sm">Loading…</div>
      ) : tokens.length === 0 ? (
        <div className="px-4 py-10 text-center text-muted-foreground text-sm">{emptyText}</div>
      ) : (
        <div className="divide-y divide-border">
          {groups.map((g) => (
            <div key={g.date}>
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/80">
                {g.label}
              </div>
              <div className="divide-y divide-border">
                {g.items.map((t) => (
                  <UpcomingRow
                    key={t.id}
                    token={t}
                    doctor={t.doctor_id ? doctorMap.get(t.doctor_id) : undefined}
                    onUpdate={onUpdate}
                    onEdited={onEdited}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function UpcomingRow({
  token,
  doctor,
  onUpdate,
  onEdited,
}: {
  token: Token;
  doctor?: Doctor;
  onUpdate: (t: Token, s: Token["status"]) => void;
  onEdited: () => void;
}) {
  const meta = statusMeta[token.status];
  const Icon = meta.icon;
  const reported = Boolean(token.reported_at);

  const markReported = async () => {
    const { error } = await (supabase.from("tokens") as any)
      .update({ reported_at: new Date().toISOString() })
      .eq("id", token.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Marked as reported");
      onEdited();
    }
  };

  return (
    <div className={cn("flex items-center gap-2 px-3 py-1.5 min-w-0", reported && "bg-success-surface/40")}>
      <span className="w-16 shrink-0 text-xs font-medium text-foreground">{formatDisplay(token.appointment_time)}</span>
      <div className="flex-1 min-w-0">
        <span className="font-medium text-foreground text-sm truncate block">{token.patient_name}</span>
      </div>
      <span className="hidden sm:block text-xs text-muted-foreground truncate max-w-[140px]">{doctor?.name ?? "—"}</span>
      <Badge variant="outline" className={cn("gap-1 font-medium text-[11px] px-1.5 py-0.5 shrink-0", meta.className)}>
        <Icon className="h-3 w-3" />
        <span className="hidden sm:inline">{meta.label}</span>
      </Badge>
      <div className="flex items-center gap-0.5 shrink-0">
        {!reported && token.status === "waiting" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-success hover:bg-success-surface text-xs"
            onClick={markReported}
          >
            Reported
          </Button>
        )}
        {token.status === "waiting" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-info hover:bg-info-surface text-xs"
            onClick={() => onUpdate(token, "in_consultation")}
          >
            Start
          </Button>
        )}
        {(token.status === "waiting" || token.status === "in_consultation") && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-danger hover:bg-danger-surface text-xs"
            onClick={() => onUpdate(token, "no_show")}
          >
            No Show
          </Button>
        )}
        <RescheduleDialog token={token} onSaved={onEdited} />
      </div>
    </div>
  );
}

function TokenRow({
  token,
  doctor,
  onUpdate,
  onEdited,
  showDate,
  readOnly,
}: {
  token: Token & { displayToken: number };
  doctor?: Doctor;
  onUpdate: (t: Token, s: Token["status"]) => void;
  onEdited: () => void;
  showDate?: boolean;
  readOnly?: boolean;
}) {
  const meta = statusMeta[token.status];
  const Icon = meta.icon;
  const reported = Boolean(token.reported_at);

  const markReported = async () => {
    const { error } = await (supabase.from("tokens") as any)
      .update({ reported_at: new Date().toISOString() })
      .eq("id", token.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Marked as reported");
      onEdited();
    }
  };

  return (
    <tr className={cn("hover:bg-muted/60 transition-colors", reported && "bg-success-surface/40")}>
      <td className="px-3 py-2">
        <div
          className={cn(
            "h-8 w-8 rounded-lg font-semibold text-xs flex items-center justify-center",
            reported
              ? "bg-success-surface text-success ring-2 ring-success"
              : "bg-info-surface text-info",
          )}
        >
          {token.displayToken}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col min-w-0">
          {readOnly ? (
            <span className="font-medium text-foreground truncate">{token.patient_name}</span>
          ) : (
            <InlineNameEdit token={token} onSaved={onEdited} />
          )}
          <span className="text-[11px] text-muted-foreground lg:hidden truncate">{token.phone_number}</span>
          {reported && (
            <span className="text-[10px] font-medium text-success uppercase tracking-wide">Reported</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell text-xs">{token.phone_number}</td>
      <td className="px-3 py-2 text-muted-foreground hidden md:table-cell text-xs truncate max-w-[140px]">
        {doctor?.name ?? "—"}
      </td>
      {showDate && (
        <td className="px-3 py-2 text-muted-foreground hidden md:table-cell text-xs">{token.appointment_date}</td>
      )}
      <td className="px-3 py-2">
        {readOnly ? (
          <span className="text-xs text-foreground">{formatDisplay(token.appointment_time)}</span>
        ) : (
          <InlineTimeEdit token={token} onSaved={onEdited} />
        )}
      </td>
      <td className="px-3 py-2">
        <Badge variant="outline" className={`gap-1 font-medium text-[11px] px-1.5 py-0.5 ${meta.className}`}>
          <Icon className="h-3 w-3" />
          {meta.label}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-0.5 flex-wrap">
          {!readOnly && token.status === "waiting" && !reported && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-success hover:bg-success-surface text-xs"
              onClick={markReported}
            >
              Reported
            </Button>
          )}
          {!readOnly && token.status === "waiting" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-info hover:bg-info-surface text-xs"
              onClick={() => onUpdate(token, "in_consultation")}
            >
              Start
            </Button>
          )}
          {!readOnly && token.status === "in_consultation" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-success hover:bg-success-surface text-xs"
              onClick={() => onUpdate(token, "completed")}
            >
              Complete
            </Button>
          )}
          {!readOnly && (token.status === "waiting" || token.status === "in_consultation") && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-danger hover:bg-danger-surface text-xs"
              onClick={() => onUpdate(token, "no_show")}
            >
              No Show
            </Button>
          )}
          {!readOnly && <RescheduleDialog token={token} onSaved={onEdited} />}
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
        className="text-left font-medium text-foreground hover:text-info inline-flex items-center gap-1 group"
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
        <button className="text-foreground hover:text-info text-sm">{formatDisplay(token.appointment_time)}</button>
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
          <Button size="sm" className="bg-info hover:bg-info" onClick={save}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RescheduleDialog({ token, onSaved }: { token: Token; onSaved: () => void }) {
  const notify = useServerFn(notifyPatient);
  const [open, setOpen] = useState(false);
  const [slot, setSlot] = useState<{ date: string; time: string } | null>(
    token.appointment_time ? { date: token.appointment_date, time: token.appointment_time } : null,
  );
  const [date, setDate] = useState<Date | undefined>(
    token.appointment_date ? new Date(token.appointment_date + "T00:00:00") : new Date(),
  );
  const initial = parse24h(token.appointment_time);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [meridiem, setMeridiem] = useState<"AM" | "PM">(initial.meridiem);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const todayKey = format(new Date(), "yyyy-MM-dd");
    const horizonDate = new Date();
    horizonDate.setDate(horizonDate.getDate() + 30);
    const withinPickerHorizon = token.appointment_date >= todayKey
      && token.appointment_date <= format(horizonDate, "yyyy-MM-dd");
    setSlot(token.appointment_time && withinPickerHorizon
      ? { date: token.appointment_date, time: token.appointment_time }
      : null);
    setDate(token.appointment_date ? new Date(`${token.appointment_date}T00:00:00`) : new Date());
    const current = parse24h(token.appointment_time);
    setHour(current.hour);
    setMinute(current.minute);
    setMeridiem(current.meridiem);
  }, [open, token.appointment_date, token.appointment_time]);

  const save = async () => {
    if (token.doctor_id && !slot) return toast.error("Pick an available appointment slot.");
    if (!token.doctor_id && !date) return toast.error("Pick a date");
    setSaving(true);
    const { error } = await supabase
      .from("tokens")
      .update({
        appointment_date: token.doctor_id && slot ? slot.date : format(date ?? new Date(), "yyyy-MM-dd"),
        appointment_time: token.doctor_id && slot ? slot.time : to24h(hour, minute, meridiem),
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
    try {
      const res = await notify({ data: { tokenId: token.id, messageType: "rescheduled" } });
      if (res.ok) {
        toast.success(res.channel === "whatsapp" ? "Rescheduled — patient notified by WhatsApp" : "Rescheduled — patient notified by SMS");
      } else if (res.error) {
        toast.warning(res.error);
      }
    } catch (e) {
      console.warn("[reschedule notify] failed", e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-muted-foreground hover:bg-muted">
          <CalendarClock className="h-3.5 w-3.5 mr-1" />
          Reschedule
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] min-w-0 max-w-lg grid-cols-[minmax(0,1fr)] overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Reschedule appointment</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          {token.doctor_id ? (
            <SlotPicker
              clinicId={token.clinic_id}
              doctorId={token.doctor_id}
              value={slot}
              onChange={setSlot}
              excludeTokenId={token.id}
            />
          ) : (
          <>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">Appointment Date</Label>
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
            <Label className="text-xs font-medium text-foreground">Appointment Time</Label>
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
          </>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="bg-info hover:bg-info">
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPatientCard({
  clinicId,
  clinicDuration,
  doctors,
  disabled,
  onAdded,
}: {
  clinicId?: string;
  clinicDuration: number;
  doctors: Doctor[];
  disabled: boolean;
  onAdded: (t: Token) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [doctorId, setDoctorId] = useState<string>("");
  const [slot, setSlot] = useState<{ date: string; time: string } | null>(null);
  const [pickerRefreshSignal, setPickerRefreshSignal] = useState(0);
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
    if (doctorId && !slot) return toast.error("Pick an available appointment slot.");
    if (!doctorId && !date) return toast.error("Pick an appointment date");
    // Block past date-times (validated in local clinic time)
    const apptTime24 = doctorId && slot ? slot.time : to24h(hour, minute, meridiem);
    if (!apptTime24) return toast.error("Pick a valid appointment time");
    const [ah, am] = apptTime24.split(":").map((n) => parseInt(n, 10));
    const apptDT = doctorId && slot ? new Date(`${slot.date}T00:00:00`) : new Date(date ?? new Date());
    apptDT.setHours(ah, am, 0, 0);
    if (apptDT.getTime() < Date.now()) {
      return toast.error("Appointment must be in the future.");
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("tokens")
      .insert({
        clinic_id: clinicId,
        patient_name: name.trim(),
        phone_number: phone,
        doctor_id: doctorId,
        token_number: 0,
        appointment_date: doctorId && slot ? slot.date : format(date ?? new Date(), "yyyy-MM-dd"),
        appointment_time: apptTime24,
      })
      .select("*")
      .single();
    setSaving(false);
    if (error) {
      if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) {
        setSlot(null);
        setPickerRefreshSignal((current) => current + 1);
        return toast.error("This slot was just booked. Please pick another time.");
      }
      return toast.error(error.message);
    }
    toast.success("Patient added");
    setName("");
    setPhone("");
    setDoctorId("");
    setSlot(null);
    setHour("");
    setMinute("");
    setMeridiem("AM");
    setDate(new Date());
    setTouched(false);
    onAdded(data as Token);
  };

  return (
    <Card className="border-border shadow-sm sticky top-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-info-surface text-info flex items-center justify-center">
            <UserPlus className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-base text-foreground">Add Patient</CardTitle>
            <CardDescription className="text-xs">
              Insert between existing slots — tokens re-number automatically.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset disabled={disabled} className="min-w-0 space-y-4 disabled:opacity-50">
          <div className="space-y-1.5">
            <Label htmlFor="pname" className="text-xs font-medium text-foreground">
              Patient Name <span className="text-danger">*</span>
            </Label>
            <Input
              id="pname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="border-border"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-xs font-medium text-foreground">
              Phone Number <span className="text-danger">*</span>
            </Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              onBlur={() => setTouched(true)}
              inputMode="numeric"
              placeholder="10-digit mobile number"
              className={cn("border-border", phoneError && "border-danger focus-visible:ring-danger")}
            />
            {phoneError && <p className="text-xs text-danger">Enter exactly 10 digits.</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">
              Doctor <span className="text-danger">*</span>
            </Label>
            <Select value={doctorId} onValueChange={(value) => { setDoctorId(value); setSlot(null); }}>
              <SelectTrigger className="border-border">
                <SelectValue placeholder="Select a doctor" />
              </SelectTrigger>
              <SelectContent>
                {doctors.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No doctors yet</div>}
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                    {d.specialty ? ` · ${d.specialty}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {doctorId && clinicId ? (
            <SlotPicker
              key={doctorId}
              clinicId={clinicId}
              doctorId={doctorId}
              clinicDuration={clinicDuration}
              doctorDuration={doctors.find((doctor) => doctor.id === doctorId)?.avg_time_per_patient ?? null}
              value={slot}
              onChange={setSlot}
              refreshSignal={pickerRefreshSignal}
            />
          ) : <>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal border-border",
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
            <Label className="text-xs font-medium text-foreground">Time</Label>
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
          </>}
          <Button onClick={submit} disabled={saving || disabled} className="w-full bg-info hover:bg-info">
            {saving ? "Adding..." : "Add to Queue"}
          </Button>
        </fieldset>
        {disabled && (
          <p className="text-xs text-danger text-center">Adding patients is disabled while the trial is expired.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ClinicProfileDialog({ clinic, onSaved }: { clinic: Clinic | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(clinic?.name ?? "");
  const [address, setAddress] = useState(clinic?.address ?? "");
  const [mapLink, setMapLink] = useState(clinic?.map_link ?? "");
  const [mobile, setMobile] = useState(clinic?.clinic_mobile ?? "");
  const [avg, setAvg] = useState(clinic?.avg_time_per_patient ?? 10);
  const [saving, setSaving] = useState(false);
  const mapLinkValid = isValidGoogleMapsLink(mapLink.trim());

  useEffect(() => {
    if (open && clinic) {
      setName(clinic.name);
      setAddress(clinic.address);
      setMapLink(clinic.map_link ?? "");
      setMobile(clinic.clinic_mobile ?? "");
      setAvg(clinic.avg_time_per_patient);
    }
  }, [open, clinic]);

  const save = async () => {
    if (!clinic) return;
    if (!name.trim() || !address.trim()) return toast.error("Name and address are required.");
    if (!mapLink.trim() || !isValidGoogleMapsLink(mapLink.trim()))
      return toast.error("Please paste a valid Google Maps location link.");
    if (mobile && !/^[0-9]{10}$/.test(mobile)) return toast.error("Mobile must be 10 digits.");
    const avgN = avg;
    const clinicNumberChanged = mobile.trim() !== (clinic.clinic_mobile ?? "");
    const mustRelinkWhatsApp = clinicNumberChanged && clinic.whatsapp_connected;
    setSaving(true);
    const { error } = await supabase
      .from("clinics")
      .update({
        name: name.trim(),
        address: address.trim(),
        map_link: mapLink.trim() || null,
        clinic_mobile: mobile.trim() || null,
        avg_time_per_patient: avgN,
        ...(mustRelinkWhatsApp ? { whatsapp_connected: false } : {}),
      })
      .eq("id", clinic.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    if (mustRelinkWhatsApp) {
      toast.success("Clinic number changed. Please link WhatsApp again with the new number.");
    } else {
      toast.success("Clinic profile updated");
    }
    setOpen(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="border-border text-foreground">
          <Settings className="h-3.5 w-3.5 mr-1.5" />
          Profile
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clinic Profile</DialogTitle>
        </DialogHeader>
        {!clinic?.map_link && (
          <div className="rounded-md border border-warning bg-warning-surface px-3 py-2 text-xs text-warning">
            Add your Google Map location link
          </div>
        )}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              Clinic Name <span className="text-danger">*</span>
            </Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Clinic Address <span className="text-danger">*</span>
            </Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, City"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Google Map Location Link <span className="text-danger">*</span>
            </Label>
            <Input
              type="url"
              value={mapLink}
              onChange={(e) => setMapLink(e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
              className={cn(mapLink && !mapLinkValid && "border-danger")}
            />
          </div>
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <p className="text-xs font-medium text-foreground">WhatsApp location preview</p>
            <div className="rounded-md bg-background px-3 py-2 text-xs leading-relaxed text-foreground">
              <p className="break-words">
                Clinic Address: {address.trim() || "Your clinic address"}.
                {mobile.trim() ? ` Contact: ${mobile.trim()}.` : ""}
              </p>
              <p className="mt-1 break-all text-primary">
                Location: {mapLink.trim() || "Your Google Maps link"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Clinic's Whatsapp Number <span className="text-danger">*</span>
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
              <DurationSelect value={avg} onChange={(next) => { if (next !== null) setAvg(next); }} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="bg-info hover:bg-info">
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
  const [avg, setAvg] = useState<number | null>(null);
  const add = async () => {
    if (!clinicId) return toast.error("Clinic not loaded");
    if (!name.trim()) return toast.error("Name required");
    if (!specialty.trim()) return toast.error("Specialty required");
    const { error } = await supabase.from("doctors").insert({
      clinic_id: clinicId,
      name: name.trim(),
      specialty: specialty.trim(),
      avg_time_per_patient: avg,
    });
    if (error) return toast.error(error.message);
    setName("");
    setSpecialty("");
    setAvg(null);
    onChange();
  };

  const updateAvg = async (id: string, value: number | null) => {
    const { error } = await supabase.from("doctors").update({ avg_time_per_patient: value }).eq("id", id);
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
        <Button size="sm" variant="outline" className="border-border text-foreground">
          Doctors
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Doctors</DialogTitle>
          <DialogDescription className="text-xs">
            Specialty is required. Set a doctor-specific duration or use the clinic default.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_180px]">
            <Input placeholder="Name *" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Specialty *" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
            <DurationSelect value={avg} allowClinicDefault onChange={setAvg} ariaLabel="New doctor appointment duration" />
          </div>
          <Button onClick={add} size="sm" className="bg-info hover:bg-info">
            Add doctor
          </Button>
          <div className="space-y-2 pt-2">
            {doctors.length === 0 && <div className="text-sm text-muted-foreground">No doctors yet.</div>}
            {doctors.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-2 border border-border rounded-md px-3 py-2">
                <div className="text-sm flex-1 min-w-[180px]">
                  <div className="font-medium text-foreground truncate">{d.name}</div>
                  {d.specialty && <div className="text-xs text-muted-foreground truncate">{d.specialty}</div>}
                </div>
                <div className="flex items-center gap-1">
                  <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                  <DurationSelect
                    value={d.avg_time_per_patient}
                    allowClinicDefault
                    onChange={(value) => updateAvg(d.id, value)}
                    className="h-8 w-[150px] text-xs"
                    ariaLabel={`${d.name} appointment duration`}
                  />
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger hover:bg-danger-surface"
                  onClick={() => remove(d.id)}
                >
                  Remove
                </Button>
                {clinicId && <DoctorWorkingHoursEditor doctorId={d.id} clinicId={clinicId} />}
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
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-foreground">Active doctors</CardTitle>
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
  const [avg, setAvg] = useState<number | null>(doctor.avg_time_per_patient);
  const [saving, setSaving] = useState(false);
  const [arriving, setArriving] = useState(false);
  useEffect(() => {
    setAvg(doctor.avg_time_per_patient);
  }, [doctor.avg_time_per_patient]);

  const saveAvg = async (parsed: number | null) => {
    setAvg(parsed);
    if (parsed === doctor.avg_time_per_patient) return;
    setSaving(true);
    const { error } = await supabase.from("doctors").update({ avg_time_per_patient: parsed }).eq("id", doctor.id);
    setSaving(false);
    if (error) {
      setAvg(doctor.avg_time_per_patient);
      return toast.error(error.message);
    }
    toast.success("Avg time updated");
    onAvgChanged();
  };

  return (
    <div className="doctor-panel min-w-0 border border-border rounded-lg p-3 flex flex-col gap-2">
      <div>
        <div className="font-medium text-foreground text-sm truncate">{doctor.name}</div>
        <div className="text-xs text-muted-foreground truncate">{doctor.specialty ?? "—"}</div>
      </div>
      <div className="flex items-center gap-2">
        <Label className="text-xs text-muted-foreground whitespace-nowrap">Avg (min)</Label>
        <DurationSelect
          value={avg}
          allowClinicDefault
          onChange={saveAvg}
          ariaLabel={`${doctor.name} average time per patient`}
          className="h-8 w-36 text-xs"
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
        className="border-success bg-success text-success-foreground hover:bg-success/90"
      >
        <DoorOpen className="h-3.5 w-3.5 mr-1.5" />
        {arriving ? "Sending…" : "Doctor Arrived"}
      </Button>
    </div>
  );
}

function DailyShiftPanel({
  doctors,
  disabled,
  onApply,
}: {
  doctors: Doctor[];
  tokens: Token[];
  disabled: boolean;
  onApply: (doctorId: string, delta: number) => Promise<boolean>;
}) {
  const [delays, setDelays] = useState<Record<string, number>>({});
  const loadDelays = useCallback(async () => {
    const { data } = await supabase.from("doctor_shift_status").select("doctor_id, delay_minutes").eq("shift_date", todayISTString());
    const m: Record<string, number> = {};
    for (const r of (data ?? []) as { doctor_id: string; delay_minutes: number | null }[]) m[r.doctor_id] = r.delay_minutes ?? 0;
    setDelays(m);
  }, []);
  useEffect(() => { void loadDelays(); }, [loadDelays]);
  if (doctors.length === 0) return null;

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-foreground flex items-center gap-2">
          <Timer className="h-4 w-4" /> Daily shift status
        </CardTitle>
        <CardDescription className="text-xs">
          Running late? Add a delay at any time. Patients are only messaged when the change reaches 10 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {doctors.map((d) => (
            <ShiftDoctorCard
              key={d.id}
              doctor={d}
              current={delays[d.id] ?? 0}
              disabled={disabled}
              onApply={async (delta) => { const ok = await onApply(d.id, delta); if (ok) await loadDelays(); return ok; }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ShiftDoctorCard({
  doctor,
  current,
  disabled,
  onApply,
}: {
  doctor: Doctor;
  current: number;
  disabled: boolean;
  onApply: (delta: number) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"add" | "reduce" | null>(null);
  const [minutes, setMinutes] = useState("10");

  const run = async (delta: number) => {
    setBusy(true);
    const ok = await onApply(delta);
    setBusy(false);
    if (ok) setMode(null);
  };
  const submit = () => {
    const m = parseInt(minutes, 10);
    if (!Number.isFinite(m) || m < 1) return toast.error("Enter minutes greater than 0");
    if (mode === "reduce" && m > current) return toast.error(`Can't reduce by more than ${current} min`);
    if (mode === "add" && current + m > 480) return toast.error("Delay can't be more than 480 minutes");
    void run(mode === "reduce" ? -m : m);
  };

  return (
    <div className="doctor-panel min-w-0 border border-border rounded-lg p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-foreground text-sm truncate min-w-0">{doctor.name}</div>
        {current > 0 ? (
          <span className="rounded-full border border-warning bg-warning-surface px-2 py-0.5 text-[11px] font-medium text-warning">Running {current} min late</span>
        ) : (
          <span className="rounded-full border border-success bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">On time</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={disabled || busy}
          className="border-warning bg-warning-surface text-warning hover:bg-warning-surface/90"
          onClick={() => { setMinutes("10"); setMode("add"); }}>Add delay</Button>
        {current > 0 && (
          <>
            <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => { setMinutes(String(Math.min(10, current))); setMode("reduce"); }}>Reduce delay</Button>
            <Button size="sm" variant="outline" disabled={disabled || busy}
              className="border-success bg-success text-success-foreground hover:bg-success/90"
              onClick={() => void run(-current)}>Back on time</Button>
          </>
        )}
      </div>
      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode === "reduce" ? "Reduce delay" : "Add delay"} · {doctor.name}</DialogTitle>
            <DialogDescription>
              Current delay: {current} min. Moves today's waiting patients {mode === "reduce" ? "earlier" : "later"}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {[10, 15, 30].filter((n) => mode !== "reduce" || n <= current).map((n) => (
                <Button key={n} size="sm" variant={minutes === String(n) ? "default" : "outline"} onClick={() => setMinutes(String(n))}>
                  {mode === "reduce" ? "−" : "+"}{n}
                </Button>
              ))}
            </div>
            <Label className="text-xs">Minutes</Label>
            <Input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))} />
          </div>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setMode(null)}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Applying…" : "Apply"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <button
                type="button"
                className="fixed bottom-6 right-6 z-40 inline-flex items-center justify-center h-11 w-11 rounded-full bg-primary hover:bg-primary text-primary-foreground shadow-lg ring-2 ring-card/60"
                aria-label="Suggestions / Feedback"
              >
                <MessageCircle className="h-5 w-5" />
              </button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">Suggestions / Feedback</TooltipContent>
        </Tooltip>
      </TooltipProvider>
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
          <Button onClick={send} disabled={saving} className="bg-info hover:bg-info">
            {saving ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PilotBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(localStorage.getItem("clinicq_pilot_banner_dismissed") !== "1");
  }, []);
  if (!show) return null;
  return (
    <div className="bg-info-surface text-info border-b border-border">
      <div className="max-w-7xl mx-auto px-6 py-2 flex items-start gap-3 text-sm">
        <p className="flex-1">
          <span className="font-semibold">Welcome to the ClinicQ Pilot.</span> You have early access with full
          features. If anything looks unexpected, tap the Feedback button at the bottom right.
        </p>
        <button
          type="button"
          aria-label="Dismiss pilot banner"
          className="shrink-0 rounded px-1 font-semibold hover:opacity-70"
          onClick={() => {
            localStorage.setItem("clinicq_pilot_banner_dismissed", "1");
            setShow(false);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
