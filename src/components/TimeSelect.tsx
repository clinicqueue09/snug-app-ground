import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Parses 24h "HH:MM" -> { hour12, minute, meridiem }
export function parse24h(value: string | null | undefined): { hour: string; minute: string; meridiem: "AM" | "PM" } {
  if (!value || !/^\d{1,2}:\d{2}$/.test(value)) return { hour: "", minute: "", meridiem: "AM" };
  const [hStr, mStr] = value.split(":");
  const h24 = parseInt(hStr, 10);
  const meridiem: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour: String(h12), minute: mStr, meridiem };
}

// Compose to 24h "HH:MM"; returns null if incomplete
export function to24h(hour: string, minute: string, meridiem: "AM" | "PM"): string | null {
  if (!hour || !minute) return null;
  let h = parseInt(hour, 10);
  if (isNaN(h) || h < 1 || h > 12) return null;
  if (meridiem === "PM" && h !== 12) h += 12;
  if (meridiem === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${minute}`;
}

export function formatDisplay(value: string | null | undefined): string {
  const { hour, minute, meridiem } = parse24h(value);
  if (!hour) return "—";
  return `${hour}:${minute} ${meridiem}`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = ["00", "10", "20", "30", "40", "50"];

export function TimeSelect({
  hour, minute, meridiem, onChange, compact,
}: {
  hour: string; minute: string; meridiem: "AM" | "PM";
  onChange: (v: { hour: string; minute: string; meridiem: "AM" | "PM" }) => void;
  compact?: boolean;
}) {
  const triggerCls = compact ? "h-8 text-xs" : "";
  return (
    <div className="flex items-center gap-1.5">
      <Select value={hour} onValueChange={(v) => onChange({ hour: v, minute, meridiem })}>
        <SelectTrigger className={triggerCls} aria-label="Hour"><SelectValue placeholder="HH" /></SelectTrigger>
        <SelectContent>{HOURS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
      </Select>
      <span className="text-slate-400">:</span>
      <Select value={minute} onValueChange={(v) => onChange({ hour, minute: v, meridiem })}>
        <SelectTrigger className={triggerCls} aria-label="Minute"><SelectValue placeholder="MM" /></SelectTrigger>
        <SelectContent>{MINUTES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={meridiem} onValueChange={(v) => onChange({ hour, minute, meridiem: v as "AM" | "PM" })}>
        <SelectTrigger className={triggerCls} aria-label="AM or PM"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
