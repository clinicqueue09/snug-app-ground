import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const BASE_DURATIONS = [5, 10, 15, 20, 30];
const CLINIC_DEFAULT = "__clinic_default__";

export function DurationSelect({
  value,
  onChange,
  allowClinicDefault = false,
  className,
  ariaLabel = "Average time per patient",
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  allowClinicDefault?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const options = [...new Set([...BASE_DURATIONS, ...(value !== null && !BASE_DURATIONS.includes(value) ? [value] : [])])];
  const selectedValue = value === null && allowClinicDefault ? CLINIC_DEFAULT : String(value ?? BASE_DURATIONS[1]);

  return (
    <Select
      value={selectedValue}
      onValueChange={(next) => onChange(next === CLINIC_DEFAULT ? null : Number(next))}
    >
      <SelectTrigger aria-label={ariaLabel} className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowClinicDefault && <SelectItem value={CLINIC_DEFAULT}>Clinic default</SelectItem>}
        {options.map((minutes) => (
          <SelectItem key={minutes} value={String(minutes)}>{minutes} minutes</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}