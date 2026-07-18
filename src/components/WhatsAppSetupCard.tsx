import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { connectWhatsApp, sendWarmConnectMessage, checkWhatsAppStatus } from "@/lib/whatsapp.functions";
import { CheckCircle2, QrCode, RefreshCw, Send, Smartphone } from "lucide-react";

type Props = { clinicId: string | undefined; connected: boolean; onChange: () => void };

export function WhatsAppSetupCard({ clinicId, connected, onChange }: Props) {
  const connect = useServerFn(connectWhatsApp);
  const checkStatus = useServerFn(checkWhatsAppStatus);
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(connected ? "connected" : "idle");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { setStatus(connected ? "connected" : "idle"); }, [connected]);

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  useEffect(() => stopPolling, []);

  async function callConnect() {
    if (!clinicId) return null;
    const r = await connect({ data: { clinicId } });
    return r;
  }

  async function startLink() {
    if (!clinicId) return;
    setBusy(true); setQr(null); setStatus("requesting");
    const r = await callConnect();
    setBusy(false);
    if (!r) return;
    const body: any = r.body ?? {};
    if (body.status === "already_connected") {
      setStatus("connected"); setQr(null); onChange();
      toast.success("WhatsApp already connected");
      return;
    }
    if (body.qr) {
      setQr(body.qr); setStatus("awaiting_scan");
      // Poll status via GET every 3s (no more repeated /connect calls)
      stopPolling();
      pollRef.current = setInterval(async () => {
        if (!clinicId) return;
        const s = await checkStatus({ data: { clinicId } });
        if (s?.connected) {
          stopPolling(); setQr(null); setStatus("connected");
          onChange();
          toast.success("WhatsApp linked");
        }
      }, 3000);
    } else {
      setStatus("error");
      toast.error(body.error ?? `Gateway responded ${r.status}`);
    }
  }

  async function disconnect() {
    if (!clinicId) return;
    await supabase.from("clinics").update({ whatsapp_connected: false }).eq("id", clinicId);
    setStatus("idle"); setQr(null); stopPolling(); onChange();
  }

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="h-4 w-4 text-emerald-600" /> WhatsApp Setup
            </CardTitle>
            <CardDescription>Link this clinic's WhatsApp number to send appointment updates.</CardDescription>
          </div>
          {status === "connected" ? (
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-slate-600">Not connected</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {status === "connected" ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={disconnect}>Disconnect</Button>
            <Button size="sm" variant="ghost" onClick={startLink} disabled={busy}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Re-link
            </Button>
          </div>
        ) : (
          <>
            {!qr && (
              <Button size="sm" onClick={startLink} disabled={busy || !clinicId} className="gap-1.5">
                <QrCode className="h-4 w-4" /> {busy ? "Requesting…" : "Link WhatsApp"}
              </Button>
            )}
            {qr && (
              <div className="flex items-start gap-4 flex-wrap">
                <div className="p-3 bg-white border border-slate-200 rounded-md">
                  <QRCode value={qr} size={180} />
                </div>
                <div className="text-sm text-slate-600 max-w-xs space-y-2">
                  <p className="font-medium text-slate-800">Scan with WhatsApp</p>
                  <ol className="list-decimal ml-4 space-y-1">
                    <li>Open WhatsApp on the clinic phone</li>
                    <li>Menu → Linked devices → Link a device</li>
                    <li>Point the camera at this QR</li>
                  </ol>
                  <p className="text-xs text-slate-500">Status: {status}. Polling every 3s…</p>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function WarmConnectCard({ disabled }: { disabled: boolean }) {
  const sendWarm = useServerFn(sendWarmConnectMessage);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = useMemo(() => /^[0-9]{10}$/.test(phone), [phone]);

  async function submit() {
    if (!valid) return;
    setBusy(true);
    const r = await sendWarm({ data: { phone } });
    setBusy(false);
    if (r.ok) { toast.success("Warm connect message sent"); setPhone(""); }
    else toast.error(r.error ?? "Send failed");
  }

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="h-4 w-4 text-sky-600" /> Warm Connection
        </CardTitle>
        <CardDescription>
          Send a one-time intro message so patients recognise the clinic's WhatsApp number.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="warm-phone">Patient WhatsApp number</Label>
          <Input
            id="warm-phone"
            inputMode="numeric"
            placeholder="10 digits"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
            disabled={disabled || busy}
          />
        </div>
        <Button size="sm" onClick={submit} disabled={!valid || busy || disabled} className="gap-1.5">
          <Send className="h-3.5 w-3.5" /> {busy ? "Sending…" : "Send warm message"}
        </Button>
      </CardContent>
    </Card>
  );
}
