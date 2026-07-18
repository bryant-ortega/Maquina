/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> is not an HTML <img>; the rule does not apply. */
/**
 * RunOfShowPDF — Phase 12 export of the per-stage schedule.
 *
 * Mirrors what the on-screen /events/[id]/runofshow page shows:
 *   - LosGothsCo header band
 *   - Event meta (title · venue · address · date · city, state · doors / end)
 *   - One section per stage, with a Time/Label two-column table
 *   - Doors row visually emphasized (matches the on-screen highlight)
 *
 * Pure data → pure markup. The route handler does the DB fetch + calls
 * buildSchedule, and only passes finished, sorted rows in.
 */

import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from '@react-pdf/renderer'
import { styles, COLORS } from './styles'
import {
  LOGO_LOSGOTHS_TRIANGLE,
  LOGO_LOSGOTHS_WORDMARK,
  resolveTitleArtwork,
} from './branding'
import type { RunOfShowRow } from '@/lib/run-of-show'

export type RunOfShowPDFProps = {
  event: {
    title: string
    date: string // 'YYYY-MM-DD'
    city: string
    state: string
    doorsLabel: string // pre-formatted, e.g. '9:00 PM'
    endLabel: string // pre-formatted, may be '—'
    /** Venue name, or null when the event has no venue on file. */
    venueName?: string | null
    /** Street address, or null when the event/venue has none on file. */
    venueAddress?: string | null
  }
  stages: Array<{
    stageNumber: number
    stageName: string
    rows: RunOfShowRow[]
  }>
  /** ISO timestamp of when the PDF was generated, for the footer. */
  generatedAt: string
}

// ---------------------------------------------------------------------------
// Run-of-show body text is scaled 1.5× from the shared baseline so it
// reads cleanly on phones (the deliverable for DJs / venue staff —
// they pull this up on a phone screen). Brand band + page footer keep
// their original sizes — they're chrome, not content.
//
// Anything used for body content below references rosStyles instead
// of the shared styles. Layout (paddings, widths) is unchanged so
// pagination still works on Letter.
// ---------------------------------------------------------------------------
const ROS_SCALE = 1.5
const ROS_BODY = 10 * ROS_SCALE
const rosStyles = StyleSheet.create({
  page: {
    ...styles.page,
    fontSize: ROS_BODY,
  },
  title: {
    ...styles.title,
    fontSize: 20 * ROS_SCALE,
  },
  subtitle: {
    ...styles.subtitle,
    fontSize: 10 * ROS_SCALE,
  },
  venueName: {
    ...styles.subtitle,
    fontSize: 11 * ROS_SCALE,
    fontWeight: 700,
  },
  sectionTitle: {
    ...styles.sectionTitle,
    fontSize: 11 * ROS_SCALE,
  },
  tableHead: {
    ...styles.tableHead,
    fontSize: 8 * ROS_SCALE,
  },
  tableCell: {
    ...styles.tableCell,
    fontSize: 10 * ROS_SCALE,
  },
  tableCellMuted: {
    ...styles.tableCellMuted,
    fontSize: 10 * ROS_SCALE,
  },
  monoCell: {
    ...styles.monoCell,
    fontSize: 9 * ROS_SCALE,
  },
  doorsCellTime: {
    ...styles.doorsCellTime,
    fontSize: 10 * ROS_SCALE,
  },
  doorsCellLabel: {
    ...styles.doorsCellLabel,
    fontSize: 10 * ROS_SCALE,
  },
  smallMuted: {
    ...styles.smallMuted,
    fontSize: 9 * ROS_SCALE,
  },
})
// Silence "COLORS imported but unused" if rosStyles ends up not
// referencing it directly — keep the import for future tweaks.
void COLORS

// Wider time column — 1.5× text needs more horizontal room before it
// wraps in the schedule's two-column tables.
const TIME_COL_WIDTH = 90 * ROS_SCALE

// Brand band sizing. Skull triangle is ~square; wordmark is wide.
const TRIANGLE_HEIGHT = 32
const TRIANGLE_WIDTH = TRIANGLE_HEIGHT * (2820 / 2661)
const WORDMARK_HEIGHT = 22
const WORDMARK_WIDTH = WORDMARK_HEIGHT * (2732 / 690)

// Title artwork (e.g., Gothicumbia) target height.
const TITLE_ART_HEIGHT = 60

function formatDate(iso: string): string {
  // Avoid timezone drift — anchor at noon UTC then format.
  const d = new Date(`${iso}T12:00:00Z`)
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function RunOfShowPDF({
  event,
  stages,
  generatedAt,
}: RunOfShowPDFProps) {
  return (
    <Document
      title={`Run of Show — ${event.title}`}
      author="LosGothsCo"
      creator="Maquina"
    >
      <Page size="LETTER" style={rosStyles.page}>
        {/* Brand band — skull triangle + wordmark on left, page caption on right. */}
        <View style={styles.brandRow}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <Image
              src={LOGO_LOSGOTHS_TRIANGLE}
              style={{ height: TRIANGLE_HEIGHT, width: TRIANGLE_WIDTH }}
            />
            <Image
              src={LOGO_LOSGOTHS_WORDMARK}
              style={{ height: WORDMARK_HEIGHT, width: WORDMARK_WIDTH }}
            />
          </View>
          <Text style={styles.brandRight}>Run of Show</Text>
        </View>

        {/* Event header — render brand artwork in place of plain title text
            when the event title matches a known series wordmark. */}
        {(() => {
          const art = resolveTitleArtwork(event.title)
          if (art) {
            return (
              <View style={{ marginTop: 18, marginBottom: 4 }}>
                <Image
                  src={art.src}
                  style={{
                    height: TITLE_ART_HEIGHT,
                    width: TITLE_ART_HEIGHT * art.aspect,
                  }}
                />
              </View>
            )
          }
          return <Text style={rosStyles.title}>{event.title}</Text>
        })()}
        <Text style={rosStyles.subtitle}>
          {formatDate(event.date)} · {event.city}, {event.state}
        </Text>
        {event.venueName ? (
          <Text style={rosStyles.venueName}>{event.venueName}</Text>
        ) : null}
        {event.venueAddress ? (
          <Text style={rosStyles.subtitle}>{event.venueAddress}</Text>
        ) : null}
        <Text style={[rosStyles.subtitle, { marginBottom: 16 }]}>
          Doors {event.doorsLabel} · End {event.endLabel}
        </Text>

        {/* Per-stage schedules */}
        {stages.length === 0 ? (
          <Text style={rosStyles.smallMuted}>No stages on this event.</Text>
        ) : (
          stages.map((stage) => (
            <View key={`stage-${stage.stageNumber}`} wrap={false}>
              <Text style={rosStyles.sectionTitle}>
                Stage {stage.stageNumber} · {stage.stageName}
              </Text>
              <View style={styles.sectionRule} />

              {/* Header row */}
              <View style={styles.tableHeadRow}>
                <Text style={[rosStyles.tableHead, { width: TIME_COL_WIDTH }]}>Time</Text>
                <Text style={[rosStyles.tableHead, { flex: 1 }]}>Slot</Text>
              </View>

              {stage.rows.map((row, idx) => {
                const isDoors = row.kind === 'doors'
                if (isDoors) {
                  return (
                    <View
                      key={`row-${stage.stageNumber}-${idx}`}
                      style={styles.doorsRow}
                    >
                      <Text style={[rosStyles.doorsCellTime, { width: TIME_COL_WIDTH }]}>
                        {row.time}
                      </Text>
                      <Text style={[rosStyles.doorsCellLabel, { flex: 1 }]}>
                        {row.label}
                      </Text>
                    </View>
                  )
                }
                return (
                  <View
                    key={`row-${stage.stageNumber}-${idx}`}
                    style={styles.tableRow}
                  >
                    <Text style={[rosStyles.monoCell, { width: TIME_COL_WIDTH }]}>
                      {row.time}
                    </Text>
                    <Text
                      style={[
                        row.kind === 'dj' ? rosStyles.tableCell : rosStyles.tableCellMuted,
                        { flex: 1 },
                      ]}
                    >
                      {row.label}
                    </Text>
                  </View>
                )
              })}
            </View>
          ))
        )}

        {/* Footer */}
        <View style={styles.pageFooter} fixed>
          <Text>
            Generated{' '}
            {new Date(generatedAt).toLocaleString('en-US', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  )
}
