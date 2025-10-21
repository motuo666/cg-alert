import nodemailer from "nodemailer";
import crypto from "crypto";

export function hmacHex(secret, msg) {
  return crypto.createHmac("sha256", secret).update(msg).digest("hex");
}

export async function sendMail({ host, port, secure, user, pass, from, to, subject, html }) {
  const transporter = nodemailer.createTransport({
    host, port: Number(port || 587), secure: !!secure,
    auth: { user, pass },
  });
  return transporter.sendMail({ from, to, subject, html });
}

export function renderTemplate(tpl, vars) {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_\.]+)\s*\}\}/g, (_, k) => {
    const v = k.split(".").reduce((a, b) => (a ? a[b] : ""), vars);
    return (v === undefined || v === null) ? "" : String(v);
  });
}
