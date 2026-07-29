import type { Metadata } from 'next'
import Image from 'next/image'
import { ApplicationForm } from './application-form'

/**
 * Public, unlinked vendor-call form for Ofrendas: A Market Event.
 * No nav entry anywhere in the app — Chase sends this URL directly to
 * prospective vendors. No auth required, and nothing here touches the
 * real vendor roster (see actions.ts for details).
 *
 * Copy below follows Ofrendas_Vendor_Application_Form_Spec.md closely
 * — the intro, Event Snapshot, Before You Apply, and Investment
 * sections are all from that spec, not summarized, so applicants see
 * the same framing as the original call before they start answering
 * questions.
 *
 * Root layout already sets robots: noindex/nofollow site-wide, so this
 * page won't get crawled or indexed either.
 */
export const metadata: Metadata = {
  title:
    'Ofrendas Vendor Application — The Regent Theater, LA — Sep 20, 2026',
}

function InfoSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2 text-left">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {title}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed text-zinc-400">
        {children}
      </div>
    </div>
  )
}

export default function OfrendasVendorApplicationPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-2xl space-y-8 rounded-2xl border border-zinc-800 bg-zinc-950 p-8 shadow-sm sm:p-10">
        <div className="space-y-5 text-center">
          <div className="flex items-center justify-center gap-2">
            <Image
              src="/ofrendas/losgothsco-wordmark.png"
              alt="LosGothsCo"
              width={89}
              height={20}
              priority
              className="h-5 w-auto object-contain"
            />
            <span className="text-sm font-semibold uppercase tracking-widest leading-none text-zinc-500">
              Presents
            </span>
          </div>
          <div className="relative mx-auto h-28 w-28 sm:h-32 sm:w-32">
            <Image
              src="/ofrendas/aztec-sun-skull.jpeg"
              alt="Aztec sun-skull carving"
              fill
              sizes="128px"
              className="rounded-full object-cover"
            />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
            Ofrendas: A Market Event
          </h1>
          <p className="text-sm text-zinc-500">
            The Regent Theater, LA &middot; Sunday, September 20, 2026
          </p>
        </div>

        <div className="space-y-4 text-left text-sm leading-relaxed text-zinc-400 sm:text-base">
          <p>
            Ofrendas is an immersive market experience by LosGothsCo, born
            from LA&apos;s Latino goth community. We thoughtfully curate
            vendors whose offerings deepen the atmosphere and help us honor
            community and culture!
          </p>
          <p>
            We look for unique gothic, alternative, and
            Latino-culture-inspired products and services that align with
            our mission of honoring darkness as a form of beauty and
            belonging. We also look for local food and beverage vendors to
            serve our market. Some of the offerings we look for include (but
            are not limited to):
          </p>
          <ul className="space-y-2 text-zinc-300">
            <li>
              🖤 Clothing and accessories ranging from handmade and
              independent designer pieces to curated thrifted and vintage
              goth fashion, including jewelry, totes, handbags, corsets, and
              wearable statement pieces.
            </li>
            <li>
              🖤 Occult and oddity collectibles, including tarot,
              curiosities, taxidermy-inspired pieces, and altar goods.
            </li>
            <li>
              🖤 Arts and artistic creations such as paintings,
              illustrations, handmade décor, home decor items, prints,
              stickers, vinyls, and one-of-a-kind dark or Latino-goth-
              inspired creative pieces.
            </li>
            <li>
              🖤 Pet-related goods including accessories, treats, toys,
              collars, bandanas, etc.
            </li>
            <li>
              🖤 Food and beverage vendors offering meals, treats, drinks,
              and specialty items with plant-based options available.
            </li>
          </ul>
        </div>

        <div className="space-y-6 border-t border-zinc-800 pt-6">
          <InfoSection title="Event snapshot">
            <p>
              <span className="text-zinc-300">Venue:</span> The Regent
              Theater, 448 S Main St, Los Angeles, CA 90013
            </p>
            <p>
              <span className="text-zinc-300">When:</span> Sunday, September
              20, 2026, 12:00pm – 6:00pm
            </p>
            <p>
              <span className="text-zinc-300">Audience:</span> All ages
            </p>
            <p>
              <span className="text-zinc-300">Contact:</span>{' '}
              ofrendasmarket@gmail.com | IG @Ofrendasmarket
            </p>
          </InfoSection>

          <InfoSection title="Before you apply — space & setup">
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                Standard space is 6ft x 4ft, indoors, no canopies. Need more
                room? You can reserve 2 spaces for up to a 10x10 footprint.
              </li>
              <li>
                Bring your own table, tablecloth, and display/lighting
                setup.
              </li>
              <li>
                No power is provided — plan for your own power, lighting,
                and wifi.
              </li>
              <li>
                Load-in starts 3 hours before doors open; full logistics
                sent after approval.
              </li>
            </ul>
          </InfoSection>

          <InfoSection title="House rules">
            <ul className="ml-4 list-disc space-y-1.5">
              <li>No smoking or vaping.</li>
              <li>
                No outside alcohol — The Regent Theater has its own bar (this
                is an all-ages event, so alcohol sales are handled by venue
                staff).
              </li>
              <li>No open flame.</li>
              <li>
                Ofrendas curates the sound for the whole event, so no
                outside speakers or music.
              </li>
            </ul>
          </InfoSection>

          <InfoSection title="How review works">
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                Applying doesn&apos;t guarantee a spot — we review every
                submission against our curation criteria.
              </li>
              <li>
                Watch your email after you apply. If you haven&apos;t heard
                back, assume you&apos;re on the waitlist and sit tight.
              </li>
            </ul>
          </InfoSection>

          <InfoSection title="Investment">
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <span className="text-zinc-300">Flat vendor fee: $55</span> —
                covers every vendor type: goods, services, artists, and
                food/beverage alike.
              </li>
              <li>
                Due within 48 hours of your acceptance email; an invoice
                goes to the email you list below.
              </li>
              <li>
                Double-check your email and Instagram handle for typos —
                that&apos;s how we&apos;ll reach you.
              </li>
              <li>A receipt follows once payment clears.</li>
            </ul>
          </InfoSection>
        </div>

        <div className="border-t border-zinc-800 pt-8">
          <ApplicationForm />
        </div>

        <div className="border-t border-zinc-800 pt-6 text-center text-xs leading-relaxed text-zinc-500">
          <p className="font-medium uppercase tracking-widest text-zinc-500">
            What happens next
          </p>
          <p className="mx-auto mt-2 max-w-md">
            Once your fee is paid, you&apos;ll get an emailed receipt and an
            invite to our Instagram DM group for vendors. All the details
            leading up to the event get shared through that DM group and
            email, so keep an eye on both. Say hi and ask questions any
            time! Happy vending! 🖤
          </p>
        </div>
      </div>
    </div>
  )
}
