export type SmsKeyword = "STOP" | "START" | "HELP" | "UNKNOWN";

export function parseSmsKeyword(body: unknown): SmsKeyword {
  if (typeof body !== "string") return "UNKNOWN";
  const word = body.trim().toUpperCase().split(/\s+/)[0];
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(word)) return "STOP";
  if (["START", "UNSTOP", "YES"].includes(word)) return "START";
  if (word === "HELP" || word === "INFO") return "HELP";
  return "UNKNOWN";
}

export interface SmsTransport {
  send(args: { to: string; body: string; idempotencyKey: string }): Promise<{ ok: boolean; providerMessageId?: string }>;
}

export const disabledSmsTransport: SmsTransport = {
  async send() {
    return { ok: false };
  },
};
