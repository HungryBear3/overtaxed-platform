export const FOLLOWUP_DELIVERY_FLAG = "OT_FREE_CHECK_FOLLOWUPS_ENABLED";
export const EMAIL_CONSENT_VERSION = "ot-free-check-email-v1";
export const SMS_CONSENT_VERSION = "ot-free-check-sms-v1";
export const FOLLOWUP_SOURCE = "free-check-result";

export function followupDeliveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" && env[FOLLOWUP_DELIVERY_FLAG] === "true";
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function normalizeUsPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  const normalized = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits[0] === "1" ? `+${digits}` : "";
  return /^\+1[2-9]\d{9}$/.test(normalized) ? normalized : null;
}
