import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Accepts https-only Google Maps links: google.com/maps, maps.app.goo.gl, goo.gl/maps.
export function isValidGoogleMapsLink(value: string): boolean {
  return /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)(\/|$|\?|#)/i.test(value);
}
