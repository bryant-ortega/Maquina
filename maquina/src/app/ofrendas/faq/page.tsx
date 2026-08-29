import type { Metadata } from 'next'
import { OfrendasMasthead } from '@/components/ofrendas/masthead'

/**
 * Ofrendas FAQ page. Copy provided by Chase directly — section styling
 * mirrors InfoSection in ../../ofrendas-vendors/vendor-call-shell.tsx
 * so the two surfaces read the same.
 */
export const metadata: Metadata = {
  title: 'FAQ — Ofrendas',
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-3 text-left">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {title}
      </h2>
      <div className="space-y-3 text-base leading-relaxed text-zinc-400">
        {children}
      </div>
    </div>
  )
}

function QA({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="font-medium text-zinc-200">{q}</p>
      <p className="text-base leading-relaxed text-zinc-400">{children}</p>
    </div>
  )
}

export default function OfrendasFaqPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-black px-3 py-8 sm:px-6 sm:py-16">
      <div className="w-full max-w-2xl space-y-8">
        <OfrendasMasthead />

        <h1 className="text-center text-3xl font-semibold tracking-tight text-zinc-100">
          Vendor Info and FAQ
        </h1>

        <div className="space-y-8 text-left">
          <div className="space-y-3 text-base leading-relaxed text-zinc-400">
            <p className="text-lg font-semibold text-zinc-100">¡Hola!</p>
            <p>
              Welcome, and thank you for your interest in vending with
              Ofrendas! We are a culturally curated market created with
              community at heart.
            </p>
            <p>
              We are intentional about our application process because we
              truly cherish the community we are building. As a vendor,
              you&apos;ll experience the care, and intention that goes into
              every aspect of our market.
            </p>
            <p>
              We look forward to learning more about you, your work, and
              what you bring to our community.
            </p>
            <p>
              We have a tremendous amount of interest from vendors who are
              eager to be part of our market, which means we are very
              intentional about who we invite to participate.
            </p>
            <p>
              Each vendor is thoughtfully selected based on what they bring
              to the overall experience and community. We also consider how
              easy and enjoyable it is to work together, and that starts
              with the application process.
            </p>
            <p>
              Please take your time, read through the questions carefully,
              and make sure your application reflects your brand, your
              work, and the experience you hope to create with us. We value
              vendors who are communicative, reliable, respectful, and
              aligned with the spirit of Ofrendas.
            </p>
          </div>

          <Section title="What we look for">
            <p>
              Having an active Instagram presence, a distinct and
              recognizable brand, and/or demonstrating that you are
              actively building and growing your business will strengthen
              your application and increase your chances of being
              selected.
            </p>
            <p>
              We want to see the heart behind what you do! Your social
              media and application are an opportunity to show us your
              brand, your products, and the work you are putting into your
              business.
            </p>
          </Section>

          <Section title="Our approval process">
            <p>
              Our selection process takes 7 days from the date applications
              open. During this time, we carefully review each application
              and thoughtfully curate our vendor lineup.
            </p>
            <p>
              Please do not message us asking whether you have been
              accepted. We kindly ask that you wait until the application
              window has closed and decisions have been finalized.
            </p>
            <p>
              We have a limited number of spaces available, and while we
              would truly love to welcome everyone, we simply do not have
              the capacity to accept every vendor who applies.
            </p>
            <p>
              Thank you for understanding, respecting our process, and
              trusting us to thoughtfully curate each Ofrendas market. 🤎
            </p>
          </Section>

          <div className="space-y-6 border-t border-zinc-800 pt-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
              FAQ
            </h2>

            <QA q="How big are the vendor spaces?">
              We offer 10x10 spaces and 6-ft table spaces. Please make sure
              you select the exact space size you need when submitting your
              application. We cannot guarantee that we will be able to
              accommodate size changes after you are accepted.
            </QA>

            <QA q="How much is the booth fee?">
              Booth fees range from $55–$110, depending on the space
              selected.
            </QA>

            <QA q="Can we share a booth?">
              No. Booth sharing is not permitted. Each vendor must apply
              and be approved individually.
            </QA>

            <QA q="What if I can't make the event?">
              If you are unable to attend after being accepted, your space
              will be forfeited and offered to the next vendor on our
              waitlist. There are no refunds, and your space cannot be
              transferred to a future Ofrendas event.
            </QA>

            <QA q="As a food vendor, do we need permits and TFFs?">
              Yes! Ofrendas is a permitted event, and all required permits,
              paperwork, and TFFs must be submitted and approved as
              applicable. Please make sure you have all necessary
              documentation before applying.
            </QA>

            <QA q="Do we need a canopy?">
              No. Ofrendas is an indoor event, so a canopy is generally not
              necessary. If you are purchasing a 10x10 space and plan to
              use a canopy frame for hanging displays or décor, you may do
              so only if the canopy shell/top is removed. Please keep in
              mind that your setup must remain within your designated
              footprint.
            </QA>

            <div className="space-y-1.5">
              <p className="font-medium text-zinc-200">
                What kind of vendors are you looking for?
              </p>
              <p className="text-base leading-relaxed text-zinc-400">
                We love vendors with distinct brands, creative offerings,
                and unique points of view. Our markets are intentionally
                curated, and we are especially excited about vendors who
                contribute to a spooky, cultural, eclectic, or unexpected
                experience.
              </p>
              <p className="text-base leading-relaxed text-zinc-400">
                Some of the vendors we welcome include:
              </p>
              <p className="text-sm leading-relaxed text-zinc-300">
                Jewelry &middot; Leather &middot; Lucha &middot; Makeup
                &middot; Plants &middot; Pet Goods &middot; Oddities
                &middot; Candles &middot; Flowers &middot; Vinyl &middot;
                Spiritual &middot; Coffee &middot; Nails &middot;
                Photography &middot; Purses &middot; Fragrances &middot;
                Clothing &middot; Art &middot; Collectibles &amp; More
              </p>
              <p className="text-base leading-relaxed text-zinc-400">
                We are not limited to this list! If you have something
                unique, creative, culturally inspired, or a little unusual,
                we want to see what you&apos;re creating.
              </p>
            </div>
          </div>

          <Section title="Last-minute spaces & waitlist">
            <p>
              We are unable to accommodate last minute requests if a vendor
              drops out. Because we receive so many applications, we
              maintain a waitlist of vendors who applied but were not
              selected for the initial lineup.
            </p>
            <p>
              If a spot becomes available, we will work our way through
              the waitlist and reach out to the next vendor who is a good
              fit for the market.
            </p>
            <p>
              Please do not message us asking to be squeezed in or to
              check on open spots. We appreciate your understanding and
              respect for the process. Our goal is to keep the market
              thoughtfully curated while being fair to everyone who took
              the time to apply.
            </p>
          </Section>
        </div>
      </div>
    </div>
  )
}
