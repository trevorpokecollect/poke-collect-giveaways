// Transactional email (verification codes, winner notices) via Resend's HTTP API.
// Without RESEND_API_KEY the message is logged instead, which is fine for local dev.

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Resend refused the address itself (422), as opposed to an outage. Callers can show a friendly
// "check your email" message instead of a 500.
export class MailAddressRejected extends Error {}

export async function sendMail(mail: Mail) {
  const key = process.env.RESEND_API_KEY;
  const from =
    process.env.MAIL_FROM ??
    "Poke-Collect Giveaways <giveaways@poke-collect.com>";
  if (!key) {
    console.info(
      `[mailer] (not sent) to=${mail.to} subject="${mail.subject}"\n${mail.text}`,
    );
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, ...mail }),
  });
  if (!res.ok) {
    const message = `Email send failed: ${res.status} ${await res.text()}`;
    if (res.status === 422) throw new MailAddressRejected(message);
    throw new Error(message);
  }
}
