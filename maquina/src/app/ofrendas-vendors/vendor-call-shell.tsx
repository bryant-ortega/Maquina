import Image from 'next/image'
import Link from 'next/link'

/**
 * Shared visual shell for the Ofrendas vendor call — the header, the
 * intro copy, and every InfoSection (event snapshot, house rules,
 * investment, etc). Used by both the public form
 * (src/app/ofrendas-vendors/page.tsx) and the private invite route
 * (src/app/ofrendas-vendors/invite/[code]/page.tsx) so the two never
 * drift out of sync — only `badge` (the small pill under the title)
 * and `formSlot` (what renders where the form goes) differ between
 * them.
 */

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
      <div className="space-y-2 text-base leading-relaxed text-zinc-400">
        {children}
      </div>
    </div>
  )
}

export function OfrendasVendorCallShell({
  badge,
  formSlot,
}: {
  badge?: React.ReactNode
  formSlot: React.ReactNode
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-3 py-8 sm:px-6 sm:py-16">
      <div className="w-full max-w-2xl space-y-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-sm sm:space-y-8 sm:p-10">
        <div className="space-y-5 text-center">
          <div className="flex items-center justify-center gap-2">
            <Image
              src="/ofrendas/losgothsco-wordmark.png"
              alt="LosGothsCo"
              width={107}
              height={24}
              priority
              className="h-6 w-auto object-contain"
            />
            <span className="text-base font-semibold uppercase tracking-widest leading-none text-zinc-500">
              Presents
            </span>
          </div>
          <div className="relative mx-auto h-32 w-32 sm:h-36 sm:w-36">
            <Image
              src="/ofrendas/aztec-sun-skull.jpeg"
              alt="Aztec sun-skull carving"
              fill
              sizes="144px"
              className="rounded-full object-cover"
            />
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-100">
            Ofrendas: A Community Market
          </h1>
          <p className="text-base text-zinc-500">
            The Regent Theater, LA &middot; Sunday, September 20, 2026
          </p>
          {badge}
        </div>

        <div className="space-y-4 text-left text-base leading-relaxed text-zinc-400">
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
              <a
                href="mailto:ofrendasmarket@gmail.com"
                className="text-zinc-300 underline underline-offset-2 hover:text-zinc-100"
              >
                ofrendasmarket@gmail.com
              </a>{' '}
              Instagram{' '}
              <a
                href="https://instagram.com/ofrendasmarket"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-300 underline underline-offset-2 hover:text-zinc-100"
              >
                @Ofrendasmarket
              </a>
            </p>
          </InfoSection>

          <InfoSection title="Before you apply — space & setup">
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                Standard space is 6ft x 6ft, indoors, no canopies. Need more
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

        <div className="border-t border-zinc-800 pt-8">{formSlot}</div>

        <div className="border-t border-zinc-800 pt-6 text-center text-sm leading-relaxed text-zinc-500">
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
          <p className="mt-4">
            <Link
              href="/ofrendas-vendors/privacy"
              className="underline underline-offset-2 hover:text-zinc-300"
            >
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export function ClosedNotice() {
  return (
    <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Applications are closed
      </p>
      <p className="text-base leading-relaxed text-zinc-400">
        We&apos;re no longer accepting new vendor applications for this
        event. If you already applied, watch your email — you should hear
        back soon. Follow{' '}
        <a
          href="https://instagram.com/ofrendasmarket"
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-300 underline underline-offset-2 hover:text-zinc-100"
        >
          @Ofrendasmarket
        </a>{' '}
        for future calls. ¡Gracias! 🖤
      </p>
    </div>
  )
}
