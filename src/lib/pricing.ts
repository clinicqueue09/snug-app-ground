// Pricing tiers for ClinicQ.
// - Single doctor clinic: flat 499 INR / month
// - Multi-doctor clinic: 499 INR * active doctor count / month
export const PER_DOCTOR_INR = 499;

export function monthlyFeeInr(activeDoctorCount: number): number {
  const n = Math.max(1, Math.floor(activeDoctorCount || 0) || 1);
  return PER_DOCTOR_INR * n;
}

export function pricingLabel(activeDoctorCount: number): string {
  const n = Math.max(1, activeDoctorCount || 1);
  const fee = monthlyFeeInr(n);
  if (n === 1) return `₹${fee} / month (single doctor tier)`;
  return `₹${fee} / month (₹${PER_DOCTOR_INR} × ${n} doctors)`;
}
