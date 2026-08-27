/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> is not an HTML <img>; the rule does not apply. */
/**
 * Shared brand band for the top of every PDF export. Was duplicated
 * verbatim in run-of-show-pdf.tsx and budget-pdf.tsx (each with its own
 * "kept in sync with..." comment) until this was pulled out — now both
 * templates render the same component instead of two copies drifting
 * apart.
 *
 * Normally shows the LosGothsCo triangle + wordmark. When an event is
 * presented under a different name (events.presented_by, see
 * src/lib/event-defaults.ts), that name renders as plain text in the
 * same spot instead, so the PDF doesn't carry LosGothsCo branding on
 * someone else's show.
 */
import { View, Text, Image } from '@react-pdf/renderer'
import { styles } from './styles'
import { LOGO_LOSGOTHS_TRIANGLE, LOGO_LOSGOTHS_WORDMARK } from './branding'
import { DEFAULT_PRESENTED_BY } from '@/lib/event-defaults'

const TRIANGLE_HEIGHT = 32
const TRIANGLE_WIDTH = TRIANGLE_HEIGHT * (2820 / 2661)
const WORDMARK_HEIGHT = 22
const WORDMARK_WIDTH = WORDMARK_HEIGHT * (2732 / 690)

export function BrandBand({
  presentedBy,
  caption,
}: {
  /** events.presented_by. Falls back to the default when empty. */
  presentedBy?: string | null
  /** Right-aligned page caption, e.g. "Run of Show" or "Budget — Estimated". */
  caption: string
}) {
  const isDefault = (presentedBy || DEFAULT_PRESENTED_BY) === DEFAULT_PRESENTED_BY

  return (
    <View style={styles.brandRow}>
      {isDefault ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image
            src={LOGO_LOSGOTHS_TRIANGLE}
            style={{ height: TRIANGLE_HEIGHT, width: TRIANGLE_WIDTH }}
          />
          <Image
            src={LOGO_LOSGOTHS_WORDMARK}
            style={{ height: WORDMARK_HEIGHT, width: WORDMARK_WIDTH }}
          />
        </View>
      ) : (
        <Text style={styles.wordmark}>{presentedBy}</Text>
      )}
      <Text style={styles.brandRight}>{caption}</Text>
    </View>
  )
}
