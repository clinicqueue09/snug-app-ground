import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Stethoscope, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · Clinic Queue" },
      { name: "description", content: "Sign in to the clinic queue management dashboard." },
    ],
  }),
  component: AuthPage,
});

function PasswordInput({ id, value, onChange, ...rest }: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} value={value} onChange={onChange} {...rest} className={cn("pr-10", rest.className)} />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [clinicName, setClinicName] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [clinicMobile, setClinicMobile] = useState("");
  const [touched, setTouched] = useState(false);
  const mobileValid = /^[0-9]{10}$/.test(clinicMobile);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Welcome back");
    navigate({ to: "/dashboard", replace: true });
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!clinicName.trim()) return toast.error("Clinic name is required.");
    if (!clinicAddress.trim()) return toast.error("Full Clinic Address / Google Map Link is required.");
    if (!mobileValid) return toast.error("Clinic WhatsApp mobile must be exactly 10 digits.");
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: {
          clinic_name: clinicName.trim(),
          clinic_address: clinicAddress.trim(),
          clinic_mobile: clinicMobile.trim(),
        },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Account created, verify your email");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Stethoscope className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">ClinicQ</h1>
          <p className="text-sm text-muted-foreground">Receptionist workspace</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Staff access</CardTitle>
            <CardDescription>Sign in with your work email to manage the queue.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="si-email">Email</Label>
                    <Input id="si-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="si-password">Password</Label>
                    <PasswordInput id="si-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in..." : "Sign in"}
                  </Button>
                  <div className="text-center">
                    <Link to="/forgot-password" className="text-sm text-sky-600 hover:underline">Forgot password?</Link>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="su-cname">Clinic Name <span className="text-rose-500">*</span></Label>
                    <Input id="su-cname" required value={clinicName} onChange={(e) => setClinicName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-caddr">Full Clinic Address / Google Map Link <span className="text-rose-500">*</span></Label>
                    <Input id="su-caddr" required value={clinicAddress} onChange={(e) => setClinicAddress(e.target.value)} placeholder="123 Main St, City / https://maps.google.com/…" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-cmob">Clinic Mobile (optional)</Label>
                    <Input
                      id="su-cmob"
                      inputMode="numeric"
                      value={clinicMobile}
                      onChange={(e) => setClinicMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      placeholder="10 digits"
                      className={cn(touched && !mobileValid && "border-rose-400")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-email">Email</Label>
                    <Input id="su-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-password">Password</Label>
                    <PasswordInput id="su-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Creating..." : "Create account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
