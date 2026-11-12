import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo-wide.png";
import {
  Smartphone, MessageCircle, PhoneOff, Users, CalendarClock, Star, Clock, CheckCircle2,
} from "lucide-react";

const TITLE = "ClinicQ · Declare OPD delays in seconds, patients updated on WhatsApp";
const DESC =
  "Live token tracking on WhatsApp for Indian clinics. Declare doctor delays from your mobile, cut front-desk calls, calmer waiting rooms. Pilot: ₹999/month per doctor.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const doctorBenefits = [
  { icon: Clock, t: "Shorter waits, happier patients", d: "Patients arrive close to their turn, so your waiting room stays calm." },
  { icon: PhoneOff, t: "Fewer 'what is my number?' calls", d: "Patients see token updates on WhatsApp instead of calling the front desk." },
  { icon: Smartphone, t: "No receptionist? No problem", d: "Doctor declares a delay from mobile in seconds — every patient is updated." },
  { icon: Users, t: "Doctor & receptionist live together", d: "Both can log in at the same time. Phone bookings, walk-ins and multiple doctors in one queue." },
  { icon: CalendarClock, t: "Doctor hours and visual slots", d: "One or two sessions a day per doctor, days off, 5/10/15 min slots. Reschedule in one click." },
  { icon: Star, t: "Higher Google rating", d: "Patients who don't wait an hour leave better reviews." },
];

const patientBenefits = [
  "Appointment date, time and location on SMS right away",
  "“Doctor has arrived” and “you are next” alerts",
  "Reminder the evening before, and a message if the time changes",
  "No app to install; clinic location on WhatsApp",
  "Less time sitting in the clinic, more time at home or work",
];

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  return (
    <div className="dashboard-theme min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2">
          <img src={logo} alt="ClinicQ - Queues reduced. Care enhanced." className="h-20 w-auto rounded-xl bg-card p-1 object-contain sm:h-24 md:h-28" />
        </div>
        <Button asChild variant="outline" size="sm"><Link to="/auth">Sign in</Link></Button>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 md:grid-cols-2 md:py-16">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Queues reduced. Care enhanced.</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight md:text-5xl">
            Running late? Declare the delay in seconds from your phone.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Every waiting patient gets their revised time on WhatsApp — no more crowded waiting rooms asking
            “Doctor kab aayenge?”. No app or software to install.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg"><Link to="/auth">Start free pilot</Link></Button>
            <Button asChild size="lg" variant="outline"><Link to="/auth">Doctor / Receptionist sign in</Link></Button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">21-day free trial · Works on PC, mobile and tablet</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-2xl border bg-card p-4 shadow-lg">
            <p className="text-xs font-semibold text-muted-foreground">Doctor's phone</p>
            <p className="mt-2 text-sm font-semibold">I'm running late by</p>
            <div className="mt-3 grid gap-2">
              {["+15 min", "+30 min", "+45 min"].map((m, i) => (
                <div key={m} className={`rounded-lg px-3 py-2 text-center text-sm font-semibold ${i === 1 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>{m}</div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">12 waiting patients will be updated</p>
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-lg">
            <p className="flex items-center gap-1 text-xs font-semibold text-muted-foreground"><MessageCircle className="h-3 w-3" /> Patient's WhatsApp</p>
            <div className="mt-2 rounded-lg bg-secondary p-3 text-sm text-secondary-foreground">
              Dr. Shah is delayed by 30 mins. Your token <b>#7</b> is now expected at <b>7:45 PM</b>. Please plan accordingly.
            </div>
            <p className="mt-2 text-right text-xs text-muted-foreground">7:02 PM ✓✓</p>
          </div>
        </div>
      </section>

      <section className="bg-secondary/50 py-14">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-3xl font-bold">Benefits for doctors & clinics</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {doctorBenefits.map(({ icon: Icon, t, d }) => (
              <div key={t} className="rounded-xl border bg-card p-5">
                <Icon className="h-6 w-6 text-primary" />
                <h3 className="mt-3 font-semibold">{t}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-2">
        <div>
          <h2 className="text-3xl font-bold">How a patient is reached</h2>
          <ol className="mt-6 space-y-4">
            {[
              "Booked through a call or walk-in — token issued in seconds",
              "Patient gets an SMS with the clinic's WhatsApp link",
              "Patient sends “Hi” on WhatsApp",
              "All further updates arrive on WhatsApp automatically",
            ].map((s, i) => (
              <li key={s} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h2 className="text-3xl font-bold">Benefits for patients</h2>
          <ul className="mt-6 space-y-3">
            {patientBenefits.map((b) => (
              <li key={b} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />{b}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-4 pb-16">
        <div className="mx-auto max-w-3xl rounded-2xl bg-primary p-8 text-center text-primary-foreground">
          <p className="text-sm font-semibold uppercase tracking-wider opacity-90">Pilot clinic offer</p>
          <p className="mt-2 text-4xl font-extrabold">₹999 <span className="text-lg font-medium">/ month per doctor</span></p>
          <p className="mt-2 opacity-90">Locked for 12 months · 21-day free trial · For single-doctor, multi-doctor and multi-speciality clinics</p>
          <Button asChild size="lg" variant="secondary" className="mt-6"><Link to="/auth">Create clinic account in 1 minute</Link></Button>
          <p className="mt-3 text-sm opacity-90">You'll need: clinic name, work email, clinic WhatsApp mobile, address and Google Maps link.</p>
        </div>
      </section>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} ClinicQ · Currently in pilot
      </footer>
    </div>
  );
}
