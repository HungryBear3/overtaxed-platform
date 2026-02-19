import nodemailer from "nodemailer"

/**
 * Create a reusable nodemailer transport from env config.
 * Call .sendMail({ from, to, subject, text, html }).
 */
export function getMailer() {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_PORT ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASSWORD
  ) {
    console.warn("[email] SMTP env vars not set – emails disabled")
    return null
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: process.env.SMTP_PORT === "465", // TLS on 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  })
}

export const defaultFrom = process.env.SMTP_FROM || "noreply@overtaxed.com"
