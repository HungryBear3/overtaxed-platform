import nodemailer from "nodemailer"

/**
 * Create a reusable nodemailer transport from env config.
 * Call .sendMail({ from, to, subject, text, html }).
 */
export function getMailer() {
  const host = process.env.SMTP_HOST
  const port = process.env.SMTP_PORT
  const password = process.env.SMTP_PASSWORD
  const isSendGrid = host?.toLowerCase().includes("sendgrid")

  // SendGrid: user must be "apikey", password is the API key
  const authUser = isSendGrid ? "apikey" : process.env.SMTP_USER
  const authPass = password

  if (!host || !port || !authUser || !authPass) {
    console.warn("[email] SMTP env vars not set – emails disabled")
    return null
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: port === "465", // TLS on 465
    auth: {
      user: authUser,
      pass: authPass,
    },
  })
}

export const defaultFrom = process.env.SMTP_FROM || "noreply@overtaxed.com"
