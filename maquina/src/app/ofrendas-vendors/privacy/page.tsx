import type { Metadata } from 'next'
import Link from 'next/link'

/**
 * Privacy policy for the Ofrendas vendor-call flow (public form +
 * private invite route, both under src/app/ofrendas-vendors/). Kept
 * self-contained in this directory, same "delete the folder and it's
 * all gone" philosophy as the rest of this feature — nothing else
 * links here except vendor-call-shell.tsx's footer and the agreement
 * section in application-form.tsx.
 *
 * Scope is intentionally narrow: this covers what the Ofrendas
 * application form itself collects (contact + business info), not
 * the separate main vendor/DJ onboarding flow (which handles W-9s
 * and lives under /vendor and /dj instead).
 *
 * Not legal advice — a plain-language draft covering CalOPPA's
 * baseline requirements (what's collected, who it's shared with, a
 * Do Not Track position) so Chase has something conspicuously posted
 * before the next application cycle opens. Have a lawyer review
 * before relying on it for anything higher-stakes.
 */
export const metadata: Metadata = {
  title: 'Ofrendas Vendor Application: Privacy Policy',
  robots: { index: false, follow: false },
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {title}
      </h2>
      <div className="space-y-3 text-base leading-relaxed text-zinc-400">
        {children}
      </div>
    </div>
  )
}

export default function OfrendasPrivacyPolicyPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-3 py-8 sm:px-6 sm:py-16">
      <div className="w-full max-w-2xl space-y-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-sm sm:p-10">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Ofrendas Vendor Application: Privacy Policy
          </h1>
          <p className="text-sm text-zinc-500">Last updated August 13, 2026</p>
        </div>

        <div className="space-y-6 text-left">
          <Section title="What we collect">
            <p>
              When you apply to be an Ofrendas vendor, we collect the
              information you submit on the application form: your business
              name, your name(s), email address, phone number, Instagram
              handle, website (if any), a description of your business and
              offerings, your space and food/beverage permit needs, and
              whether you consent to us using your content in our
              marketing.
            </p>
            <p>
              We don&apos;t collect payment card, banking, or tax ID
              information through this form. Vendor fees are paid
              separately (Venmo or Zelle) after approval, and we don&apos;t
              store those payment details.
            </p>
          </Section>

          <Section title="How we use it">
            <ul className="ml-4 list-disc space-y-1.5">
              <li>To review and process your vendor application.</li>
              <li>
                To contact you about your application status, event
                logistics, invoices, and receipts.
              </li>
              <li>
                To send marketing/promotional emails about Ofrendas, if you
                indicated you&apos;re fine receiving them in the vendor
                agreement.
              </li>
              <li>
                To feature your content in our marketing, only if you opted
                in on the application form.
              </li>
            </ul>
          </Section>

          <Section title="Who we share it with">
            <p>
              We use a small number of service providers to run this
              process: an email delivery service to send you application
              and event emails, and a secure cloud database provider to
              store application data. We don&apos;t sell your information,
              and we don&apos;t share it with anyone else outside of
              running the Ofrendas vendor call and event.
            </p>
          </Section>

          <Section title="How long we keep it">
            <p>
              We keep application data for as long as needed to run the
              current Ofrendas market and follow up afterward (e.g. for a
              future event), and delete or anonymize it on request (see
              below).
            </p>
          </Section>

          <Section title="Your choices">
            <p>
              To ask us to access, correct, or delete the information you
              submitted, email{' '}
              <a
                href="mailto:ofrendasmarket@gmail.com"
                className="text-zinc-300 underline underline-offset-2 hover:text-zinc-100"
              >
                ofrendasmarket@gmail.com
              </a>
              . You can also unsubscribe from marketing emails at any time
              using the link in those emails, or by emailing us directly.
            </p>
          </Section>

          <Section title="Do Not Track">
            <p>
              This site doesn&apos;t run third-party analytics or ad
              tracking, and it doesn&apos;t currently respond to browser
              &quot;Do Not Track&quot; signals differently.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy? Email{' '}
              <a
                href="mailto:ofrendasmarket@gmail.com"
                className="text-zinc-300 underline underline-offset-2 hover:text-zinc-100"
              >
                ofrendasmarket@gmail.com
              </a>
              .
            </p>
          </Section>
        </div>

        <div className="border-t border-zinc-800 pt-6 text-center">
          <Link
            href="/ofrendas-vendors"
            className="text-sm text-zinc-400 underline underline-offset-2 hover:text-zinc-100"
          >
            ← Back to the application
          </Link>
        </div>
      </div>
    </div>
  )
}
