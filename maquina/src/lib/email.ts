/**
 * Email — central Resend wrapper (Phase 20).
 *
 * DORMANT-SAFE BY DESIGN. Every send goes through `sendEmail`, which
 * checks for RESEND_API_KEY. If the key is missing (e.g. before Chase
 * has signed up at resend.com and added it to Vercel), the send is a
 * logged no-op that returns `{ skipped: true }`. Nothing throws. That
 * means registration, the W-9 cron, and any future caller keep working
 * with zero email side-effects until the key is present — flip the env
 * var and email goes live with no code change.
 *
 * Env vars (all optional until you want email to actually send):
 *   RESEND_API_KEY     — from resend.com. Absent ⇒ dormant no-op.
 *   RESEND_FROM        — "LosGothsCo <noreply@yourdomain>". Falls back
 *                        to Resend's shared test sender so dev works
 *                        before you've verified a domain.
 *   NEXT_PUBLIC_APP_URL— canonical https origin for links in emails.
 *                        Falls back to VERCEL_URL, then localhost.
 */

import { Resend } from 'resend'

// Matches the fallback used by the existing Run of Show email feature
// (src/app/(admin)/events/[id]/runofshow/actions.ts) so both send from
// the same verified losgoths.co domain when RESEND_FROM isn't set.
const FROM_FALLBACK = 'Maquina <maquina@losgoths.co>'

// Ofrendas vendor-call emails (approval + payment confirmation) always
// send under this display name, regardless of RESEND_FROM, so vendors
// consistently see "Ofrendas Team" rather than "Maquina".
const OFRENDAS_FROM = 'Ofrendas Team <maquina@losgoths.co>'

export type SendResult =
  | { ok: true; id: string | null }
  | { ok: false; skipped: true; reason: 'no_api_key' }
  | { ok: false; skipped: false; reason: 'send_failed'; message: string }

/**
 * True when RESEND_API_KEY is configured (i.e. email will actually
 * send rather than no-op). Use this to fast-fail a feature with a
 * clear message before doing expensive work like rendering a PDF —
 * rather than every caller reaching into process.env directly.
 */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

/**
 * Absolute origin for building links inside emails. Prefers an
 * explicitly-configured public URL, then Vercel's deploy URL, then
 * localhost for dev. Never returns a trailing slash.
 */
export function appOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`.replace(/\/+$/, '')
  return 'http://localhost:3000'
}

/** Build an absolute URL from a path (e.g. "/dj/upload-w9"). */
export function absoluteUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${appOrigin()}${p}`
}

type SendArgs = {
  to: string | string[]
  subject: string
  html: string
  text?: string
  /** Resend attachments — { filename, content: Buffer | base64 string }. */
  attachments?: { filename: string; content: Buffer | string }[]
  /** Override the default From. */
  from?: string
  replyTo?: string
}

/**
 * The single choke-point for outbound mail. Returns a discriminated
 * result instead of throwing — callers decide whether a failed/skipped
 * send matters (for registration + cron, it never should block the
 * primary action).
 */
export async function sendEmail(args: SendArgs): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // Dormant mode — no key configured yet.
    console.warn(
      `[email] RESEND_API_KEY not set — skipping send "${args.subject}" to`,
      args.to
    )
    return { ok: false, skipped: true, reason: 'no_api_key' }
  }

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from: args.from ?? process.env.RESEND_FROM ?? FROM_FALLBACK,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.text ? { text: args.text } : {}),
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
      ...(args.attachments ? { attachments: args.attachments } : {}),
    })
    if (error) {
      console.error('[email] send failed:', error)
      return { ok: false, skipped: false, reason: 'send_failed', message: error.message }
    }
    return { ok: true, id: data?.id ?? null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[email] send threw:', message)
    return { ok: false, skipped: false, reason: 'send_failed', message }
  }
}

// ---------------------------------------------------------------------------
// Shared HTML shell — keeps every email visually consistent without a
// templating dependency. Plain, dark-text-on-light so it renders fine
// in every mail client (we do NOT assume the recipient's color scheme).
// ---------------------------------------------------------------------------
function shell(opts: { heading: string; bodyHtml: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f4f4f5;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;overflow:hidden;">
          <tr><td style="padding:24px 28px 8px;">
            <p style="margin:0;font-size:13px;letter-spacing:0.08em;color:#71717a;text-transform:uppercase;">LosGothsCo · MΛQUIИΛ</p>
            <h1 style="margin:8px 0 0;font-size:20px;color:#18181b;">${opts.heading}</h1>
          </td></tr>
          <tr><td style="padding:8px 28px 28px;font-size:14px;line-height:1.6;color:#3f3f46;">
            ${opts.bodyHtml}
          </td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#a1a1aa;">Sent by Maquina, LosGothsCo's event operations tool.</p>
      </td></tr>
    </table>
  </body>
</html>`
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:8px;">${label}</a>`
}

/**
 * Escapes user-supplied text before it's interpolated into an HTML
 * email body. Every sender below deals in free-text fields DJs,
 * vendors, and Ofrendas applicants typed into a public form (name,
 * company name, business name) — none of that is safe to drop
 * straight into `bodyHtml`/`heading` template strings unescaped. This
 * was already reinvented twice (runofshow/actions.ts,
 * lib/calendar-invite.ts) as a local, unexported copy; this is now
 * the one shared version — the two duplicates were pointed at this
 * one instead of removed outright, minimizing the change to those
 * already-working files.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Typed senders. Each builds content + delegates to sendEmail. Callers
// just pass the recipient + name.
// ---------------------------------------------------------------------------

/** DJ registration confirmation. Nudges them to finish the W-9 upload. */
export async function sendDjRegistrationConfirmation(args: {
  to: string
  djName: string
}): Promise<SendResult> {
  const uploadUrl = absoluteUrl('/dj/upload-w9')
  const html = shell({
    heading: `Welcome, ${escapeHtml(args.djName)}`,
    bodyHtml: `
      <p style="margin:0 0 12px;">Your DJ profile with LosGothsCo is set up. 🎧</p>
      <p style="margin:0 0 16px;">One last step: upload your W-9 so we can keep you on file for bookings and payments.</p>
      <p style="margin:0 0 16px;">${button(uploadUrl, 'Upload your W-9')}</p>
      <p style="margin:0;color:#71717a;font-size:13px;">If the button doesn't work, paste this into your browser:<br>${uploadUrl}</p>
    `,
  })
  return sendEmail({
    to: args.to,
    subject: 'Welcome to LosGothsCo — upload your W-9',
    html,
    text: `Welcome, ${args.djName}. Your DJ profile is set up. Upload your W-9 here: ${uploadUrl}`,
  })
}

/** Vendor registration confirmation. */
export async function sendVendorRegistrationConfirmation(args: {
  to: string
  companyName: string
}): Promise<SendResult> {
  const uploadUrl = absoluteUrl('/vendor/upload-w9')
  const html = shell({
    heading: `Welcome, ${escapeHtml(args.companyName)}`,
    bodyHtml: `
      <p style="margin:0 0 12px;">Your vendor profile with LosGothsCo is set up.</p>
      <p style="margin:0 0 16px;">One last step: upload your W-9 so we can keep you on file for payments.</p>
      <p style="margin:0 0 16px;">${button(uploadUrl, 'Upload your W-9')}</p>
      <p style="margin:0;color:#71717a;font-size:13px;">If the button doesn't work, paste this into your browser:<br>${uploadUrl}</p>
    `,
  })
  return sendEmail({
    to: args.to,
    subject: 'Welcome to LosGothsCo — upload your W-9',
    html,
    text: `Welcome, ${args.companyName}. Your vendor profile is set up. Upload your W-9 here: ${uploadUrl}`,
  })
}

/** Weekly W-9 reminder for a recipient who still hasn't uploaded. */
export async function sendW9Reminder(args: {
  to: string
  name: string
  kind: 'dj' | 'vendor'
}): Promise<SendResult> {
  const uploadUrl = absoluteUrl(
    args.kind === 'dj' ? '/dj/upload-w9' : '/vendor/upload-w9'
  )
  const html = shell({
    heading: 'Quick reminder: your W-9',
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${escapeHtml(args.name)},</p>
      <p style="margin:0 0 16px;">We still don't have your W-9 on file. It only takes a minute and keeps your payments moving without delay.</p>
      <p style="margin:0 0 16px;">${button(uploadUrl, 'Upload your W-9')}</p>
      <p style="margin:0;color:#71717a;font-size:13px;">If the button doesn't work, paste this into your browser:<br>${uploadUrl}</p>
    `,
  })
  return sendEmail({
    to: args.to,
    subject: 'Reminder: please upload your W-9',
    html,
    text: `Hi ${args.name}, we still need your W-9 on file. Upload it here: ${uploadUrl}`,
  })
}

/**
 * Ofrendas vendor-call application receipt (see
 * src/app/ofrendas-vendors/). Not part of the real vendor onboarding
 * flow — just a "we got it" confirmation for the standalone market
 * event form. No links back into the app; applicants aren't creating
 * an account here.
 */
export async function sendOfrendasVendorApplicationReceipt(args: {
  to: string
  contactName: string
  businessName: string
}): Promise<SendResult> {
  const igUrl = 'https://instagram.com/ofrendasmarket'
  const supportEmail = 'ofrendasmarket@gmail.com'
  const html = shell({
    heading: 'We got your Ofrendas vendor application',
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${escapeHtml(args.contactName)},</p>
      <p style="margin:0 0 12px;">Thanks for applying to be a vendor at Ofrendas, LosGothsCo's market event. We've got your application for <strong>${escapeHtml(args.businessName)}</strong> on file.</p>
      <p style="margin:0 0 12px;">We review applications on a rolling basis and will follow up by email if it's a fit for the market. Follow along at <a href="${igUrl}" style="color:#18181b;">@ofrendasmarket</a> for updates, and reach out to <a href="mailto:${supportEmail}" style="color:#18181b;">${supportEmail}</a> if you have any questions.</p>
      <p style="margin:0 0 16px;">Gracias,<br>LosGothsCo</p>
      <p style="margin:0;font-size:12px;color:#a1a1aa;">This is a do-not-reply address — for questions, email <a href="mailto:${supportEmail}" style="color:#a1a1aa;">${supportEmail}</a> instead.</p>
    `,
  })
  return sendEmail({
    to: args.to,
    subject: 'We got your Ofrendas vendor application 🖤',
    html,
    text: `Hi ${args.contactName}, thanks for applying to be a vendor at Ofrendas. We've got your application for ${args.businessName} on file. We review applications on a rolling basis and will follow up by email if it's a fit. Follow along at @ofrendasmarket (${igUrl}) for updates, and reach out to ${supportEmail} with questions. Gracias, LosGothsCo. This is a do-not-reply address — for questions, email ${supportEmail} instead.`,
  })
}

/**
 * $55/space, sold as "1 space" or "2 spaces" (see SPACE_OPTIONS in
 * src/app/ofrendas-vendors/application-form.tsx — the space_needed
 * column stores the full label, e.g. "2 spaces (up to 10x10
 * footprint)"). Only two options exist today; this reads the leading
 * digit so it still does something sane if that copy changes slightly.
 */
function ofrendasSpaceCount(spaceNeeded: string): 1 | 2 {
  return spaceNeeded.trim().startsWith('2') ? 2 : 1
}

function ofrendasAmountDue(spaceNeeded: string): number {
  return ofrendasSpaceCount(spaceNeeded) === 2 ? 110 : 55
}

/**
 * Ofrendas vendor-call approval notice. Sent in bulk from the admin
 * "Email approved vendors" button on
 * src/app/(admin)/ofrendas-vendor-applications/page.tsx — one send per
 * vendor (not a single multi-recipient email), so each is personalized
 * and no applicant sees anyone else's address.
 */
export async function sendOfrendasVendorApprovalEmail(args: {
  to: string
  contactName: string
  businessName: string
  spaceNeeded: string
}): Promise<SendResult> {
  const supportEmail = 'ofrendasmarket@gmail.com'
  const spaceCount = ofrendasSpaceCount(args.spaceNeeded)
  const spaceLabel = spaceCount === 2 ? '2 spaces (10ft x 10ft)' : '1 space (6ft x 6ft)'
  const amountDue = ofrendasAmountDue(args.spaceNeeded)
  const html = shell({
    heading: `You're approved for Ofrendas 🖤`,
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${escapeHtml(args.contactName)},</p>
      <p style="margin:0 0 12px;">Felicidades! <strong>${escapeHtml(args.businessName)}</strong> is approved as a vendor for <strong>Ofrendas: A Community Market</strong> at The Regent Theater, LA, on Sunday, September 20, 2026.</p>
      <p style="margin:0 0 12px;">Next step is securing your space. You requested <strong>${spaceLabel}</strong>, so please send <strong>$${amountDue}</strong> via one of these payment methods:</p>
      <p style="margin:0 0 12px;">Venmo: @Stephanie-Gonzalez-56709<br>or<br>Zelle: 8187922493</p>
      <p style="margin:0 0 12px;">Please send payment within 48 hours (by this Friday, 8/14 at midnight PST) to be confirmed. We know that feels quick. We hold spots on a short window so we can offer them to another vendor if it doesn't work out, and so we can keep our marketing timeline on track. If we don't receive payment within 48 hours, we'll release your spot to the next vendor on our list.</p>
      <p style="margin:0 0 16px;">Questions in the meantime? Please reach out to <a href="mailto:${supportEmail}" style="color:#18181b;">${supportEmail}</a>.</p>
      <p style="margin:0;">Gracias,<br>Ofrendas Team</p>
    `,
  })
  return sendEmail({
    to: args.to,
    subject: "You're approved for Ofrendas 🖤",
    html,
    text: `Hi ${args.contactName}, Felicidades! ${args.businessName} is approved as a vendor for Ofrendas: A Community Market at The Regent Theater, LA, on Sunday, September 20, 2026. Next step is securing your space. You requested ${spaceLabel}, so please send $${amountDue} via one of these payment methods: Venmo @Stephanie-Gonzalez-56709 or Zelle 8187922493. Please send payment within 48 hours (by this Friday, 8/14 at midnight PST) to be confirmed. We know that feels quick. We hold spots on a short window so we can offer them to another vendor if it doesn't work out, and so we can keep our marketing timeline on track. If we don't receive payment within 48 hours, we'll release your spot to the next vendor on our list. Questions in the meantime? Please reach out to ${supportEmail}. Gracias, Ofrendas Team.`,
    from: OFRENDAS_FROM,
  })
}

/**
 * Ofrendas vendor-call payment confirmation. Sent in bulk from the
 * admin "Email paid vendors" button, same one-send-per-vendor pattern
 * as the approval email above.
 */
export async function sendOfrendasVendorPaymentConfirmationEmail(args: {
  to: string
  contactName: string
  businessName: string
}): Promise<SendResult> {
  const supportEmail = 'ofrendasmarket@gmail.com'
  const html = shell({
    heading: `You're confirmed for Ofrendas 🖤`,
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${escapeHtml(args.contactName)},</p>
      <p style="margin:0 0 12px;">We've received payment for <strong>${escapeHtml(args.businessName)}</strong>'s space at <strong>Ofrendas: A Community Market</strong> — The Regent Theater, LA, Sunday, September 20, 2026. You're all set!</p>
      <p style="margin:0 0 12px;">We'll be in touch closer to the date with load-in time and any final logistics. In the meantime, follow along at <a href="https://instagram.com/ofrendasmarket" style="color:#18181b;">@ofrendasmarket</a>.</p>
      <p style="margin:0 0 12px;">One thing we need from you: please send us a decent-resolution PNG of your logo so we can include it in marketing. If we don't have it within 48 hours, we'll pick a font to promote you with instead.</p>
      <p style="margin:0 0 16px;">Questions? Reach out to <a href="mailto:${supportEmail}" style="color:#18181b;">${supportEmail}</a>.</p>
      <p style="margin:0;">Gracias,<br>Ofrendas Team</p>
    `,
  })
  return sendEmail({
    to: args.to,
    subject: "You're confirmed for Ofrendas — payment received",
    html,
    text: `Hi ${args.contactName}, we've received payment for ${args.businessName}'s space at Ofrendas: A Community Market — The Regent Theater, LA, Sunday, September 20, 2026. You're all set! We'll be in touch closer to the date with load-in time and any final logistics. Follow along at @ofrendasmarket. One thing we need from you: please send us a decent-resolution PNG of your logo so we can include it in marketing. If we don't have it within 48 hours, we'll pick a font to promote you with instead. Questions? Reach out to ${supportEmail}. Gracias, Ofrendas Team.`,
    from: OFRENDAS_FROM,
  })
}

/**
 * Ofrendas vendor-call waitlist notice. Sent in bulk from the admin
 * "Email waitlisted vendors" button — every application NOT marked
 * approved (approved = false), one send per vendor, same
 * one-send-per-vendor / no-shared-recipient pattern as the approval
 * and payment emails above.
 */
export async function sendOfrendasVendorWaitlistEmail(args: {
  to: string
  contactName: string
  businessName: string
}): Promise<SendResult> {
  const html = shell({
    heading: `Update on your Ofrendas application 🖤`,
    bodyHtml: `
      <p style="margin:0 0 12px;">Hi ${escapeHtml(args.contactName)},</p>
      <p style="margin:0 0 12px;">Muchísimas gracias for applying to be part of our first Ofrendas Community Market! We were so moved by the number of applications we received, and truly appreciate you taking the time to share <strong>${escapeHtml(args.businessName)}</strong> and your work with us.</p>
      <p style="margin:0 0 12px;">This year we had way more incredible applicants than we had spaces for, so we've placed your application on our waitlist. If any additional spaces open up after our vendor payment deadline, we'll be reaching out right away.</p>
      <p style="margin:0 0 12px;">We know this isn't the answer you were hoping for, and we don't take your interest in Ofrendas for granted. Follow along at <a href="https://instagram.com/ofrendasmarket" style="color:#18181b;">@ofrendasmarket</a> for updates, and we hope to see you at a future market.</p>
      <p style="margin:0;">Gracias de corazón,<br>Ofrendas Team</p>
    `,
  })
  return sendEmail({
    to: args.to,
    subject: 'Update on your Ofrendas application 🖤',
    html,
    text: `Hi ${args.contactName}, Muchísimas gracias for applying to be part of our first Ofrendas Community Market! We were so moved by the number of applications we received, and truly appreciate you taking the time to share ${args.businessName} and your work with us. This year we had way more incredible applicants than we had spaces for, so we've placed your application on our waitlist. If any additional spaces open up after our vendor payment deadline, we'll be reaching out right away. We know this isn't the answer you were hoping for, and we don't take your interest in Ofrendas for granted. Follow along at @ofrendasmarket for updates, and we hope to see you at a future market. Gracias de corazón, Ofrendas Team.`,
    from: OFRENDAS_FROM,
  })
}

