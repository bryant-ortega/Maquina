/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> is not an HTML <img>; the rule does not apply. */
/**
 * BudgetPDF — Phase 12 export of the event budget.
 *
 * Mirrors the on-screen budget page but flattened to a print layout:
 *   - Brand band + "Budget — Estimated" or "— Final"
 *   - Event meta
 *   - Income breakdown (tiers, bar, merch, sponsor, vendor, walkout)
 *   - Expenses by category (rows + category subtotals + grand total)
 *   - Bottom summary (income, expenses, profit) + partner split line
 *
 * The route handler does the math — this component only takes a fully
 * computed BudgetSummary and the raw expense / tier rows. Keeps the
 * template pure (no @/lib/budget import here).
 */

import { Document, Page, View, Text, Image } from '@react-pdf/renderer'
import { styles } from './styles'
import {
  LOGO_LOSGOTHS_TRIANGLE,
  LOGO_LOSGOTHS_WORDMARK,
  resolveTitleArtwork,
} from './branding'
import {
  EXPENSE_CATEGORY_ORDER,
  EXPENSE_CATEGORY_LABELS,
  formatUSD,
  formatUSDCents,
  type BudgetSummary,
  type ExpenseCategory,
} from '@/lib/budget'

// Brand band sizing (kept in sync with run-of-show-pdf.tsx).
const TRIANGLE_HEIGHT = 32
const TRIANGLE_WIDTH = TRIANGLE_HEIGHT * (2820 / 2661)
const WORDMARK_HEIGHT = 22
const WORDMARK_WIDTH = WORDMARK_HEIGHT * (2732 / 690)
const TITLE_ART_HEIGHT = 60

export type BudgetPDFExpenseRow = {
  category: string
  item: string
  qty: number
  price: number
}

export type BudgetPDFTierRow = {
  tier_number: number
  price: number
  sold: number
}

export type BudgetPDFProps = {
  event: {
    title: string
    date: string // 'YYYY-MM-DD'
    city: string
    state: string
    splitPct: number
    barIncluded: boolean
  }
  budgetType: 'estimated' | 'final'
  summary: BudgetSummary
  expenses: BudgetPDFExpenseRow[]
  tiers: BudgetPDFTierRow[]
  generatedAt: string
}

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Group expense rows by category, preserving EXPENSE_CATEGORY_ORDER. */
function groupExpenses(rows: BudgetPDFExpenseRow[]) {
  const groups = new Map<string, BudgetPDFExpenseRow[]>()
  for (const r of rows) {
    const list = groups.get(r.category) ?? []
    list.push(r)
    groups.set(r.category, list)
  }
  // Order known categories first, then anything unexpected at the end.
  const ordered: Array<{ category: string; rows: BudgetPDFExpenseRow[] }> = []
  for (const cat of EXPENSE_CATEGORY_ORDER) {
    const rs = groups.get(cat)
    if (rs && rs.length) ordered.push({ category: cat, rows: rs })
    groups.delete(cat)
  }
  for (const [cat, rs] of groups) {
    ordered.push({ category: cat, rows: rs })
  }
  return ordered
}

export function BudgetPDF({
  event,
  budgetType,
  summary,
  expenses,
  tiers,
  generatedAt,
}: BudgetPDFProps) {
  const grouped = groupExpenses(expenses)
  const subtitleType = budgetType === 'estimated' ? 'Estimated' : 'Final'

  return (
    <Document
      title={`${subtitleType} Budget — ${event.title}`}
      author="LosGothsCo"
      creator="Maquina"
    >
      <Page size="LETTER" style={styles.page}>
        {/* Brand band — triangle + wordmark on left, page caption on right. */}
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
          <Text style={styles.brandRight}>Budget — {subtitleType}</Text>
        </View>

        {/* Event header — series-aware: render wordmark artwork when the
            event title matches a known series. */}
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
          return <Text style={styles.title}>{event.title}</Text>
        })()}
        <Text style={[styles.subtitle, { marginBottom: 16 }]}>
          {formatDate(event.date)} · {event.city}, {event.state}
        </Text>

        {/* ---------- Income ---------- */}
        <Text style={styles.sectionTitle}>Income</Text>
        <View style={styles.sectionRule} />

        {/* Tier rows */}
        <View style={styles.tableHeadRow}>
          <Text style={[styles.tableHead, { flex: 1 }]}>Item</Text>
          <Text style={[styles.tableHead, { width: 50, textAlign: 'right' }]}>
            Qty
          </Text>
          <Text style={[styles.tableHead, { width: 80, textAlign: 'right' }]}>
            Price
          </Text>
          <Text style={[styles.tableHead, { width: 90, textAlign: 'right' }]}>
            Subtotal
          </Text>
        </View>
        {tiers.length === 0 ? (
          <View style={styles.tableRow}>
            <Text style={[styles.smallMuted, { flex: 1 }]}>
              No tiers configured
            </Text>
          </View>
        ) : (
          tiers.map((t) => (
            <View key={`tier-${t.tier_number}`} style={styles.tableRow}>
              <Text style={[styles.tableCell, { flex: 1 }]}>
                Tier {t.tier_number}
              </Text>
              <Text style={[styles.numCell, { width: 50 }]}>{t.sold}</Text>
              <Text style={[styles.numCell, { width: 80 }]}>
                {formatUSDCents(t.price)}
              </Text>
              <Text style={[styles.numCell, { width: 90 }]}>
                {formatUSDCents(t.price * t.sold)}
              </Text>
            </View>
          ))
        )}
        <View style={styles.totalRow}>
          <Text style={[styles.tableCell, { flex: 1 }]}>Gross ticket sales</Text>
          <Text style={[styles.numCellBold, { width: 220 }]}>
            {formatUSD(summary.gross_tix_total)}
          </Text>
        </View>
        {summary.tix_tax > 0 && (
          <>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCellMuted, { flex: 1 }]}>
                Ticket tax
              </Text>
              <Text style={[styles.numCell, { width: 220 }]}>
                − {formatUSD(summary.tix_tax)}
              </Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCellMuted, { flex: 1 }]}>
                Net ticket sales (after tax)
              </Text>
              <Text style={[styles.numCell, { width: 220 }]}>
                {formatUSD(summary.net_tix_total)}
              </Text>
            </View>
          </>
        )}

        {/* Tickets / attendance summary */}
        <View style={styles.tableRow}>
          <Text style={[styles.tableCellMuted, { flex: 1 }]}>
            Tickets sold
          </Text>
          <Text style={[styles.numCell, { width: 220 }]}>
            {summary.gross_tix_sold}
          </Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={[styles.tableCellMuted, { flex: 1 }]}>
            Paid attendance (sold − drop-off)
          </Text>
          <Text style={[styles.numCell, { width: 220 }]}>
            {summary.paid_attendance}
          </Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={[styles.tableCellMuted, { flex: 1 }]}>
            Total attendance (incl. guests)
          </Text>
          <Text style={[styles.numCell, { width: 220 }]}>
            {summary.total_attendance}
          </Text>
        </View>

        {/* Net split */}
        <View style={styles.tableRow}>
          <Text style={[styles.tableCell, { flex: 1 }]}>
            LosGothsCo ticket net ({event.splitPct}% of net, after tax)
          </Text>
          <Text style={[styles.numCellBold, { width: 220 }]}>
            {formatUSD(summary.losgothsco_tix_net)}
          </Text>
        </View>

        {/* Bar */}
        {event.barIncluded ? (
          <>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCellMuted, { flex: 1 }]}>
                Bar gross (paid attendance × $24)
              </Text>
              <Text style={[styles.numCell, { width: 220 }]}>
                {formatUSD(summary.bar_gross)}
              </Text>
            </View>
            <View style={styles.tableRow}>
              <Text style={[styles.tableCell, { flex: 1 }]}>
                LosGothsCo bar (16%)
              </Text>
              <Text style={[styles.numCellBold, { width: 220 }]}>
                {formatUSD(summary.losgothsco_bar)}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.tableRow}>
            <Text style={[styles.tableCellMuted, { flex: 1 }]}>
              Bar (not included on this event)
            </Text>
            <Text style={[styles.numCell, { width: 220 }]}>—</Text>
          </View>
        )}

        {/* Merch */}
        <View style={styles.tableRow}>
          <Text style={[styles.tableCellMuted, { flex: 1 }]}>Merch gross</Text>
          <Text style={[styles.numCell, { width: 220 }]}>
            {formatUSD(summary.merch_gross)}
          </Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={[styles.tableCellMuted, { flex: 1 }]}>
            Merch net after fees − COGS − seller fee
          </Text>
          <Text style={[styles.numCellBold, { width: 220 }]}>
            {formatUSD(summary.net_merch)}
          </Text>
        </View>

        {/* Walkout = LosGothsCo tix net + LosGothsCo bar − deductions */}
        <View style={styles.totalRow}>
          <Text style={[styles.tableCell, { flex: 1 }]}>Walkout</Text>
          <Text style={[styles.numCellBold, { width: 220 }]}>
            {formatUSD(summary.walkout)}
          </Text>
        </View>

        {/* ---------- Expenses ---------- */}
        <Text style={styles.sectionTitle}>Expenses</Text>
        <View style={styles.sectionRule} />

        <View style={styles.tableHeadRow}>
          <Text style={[styles.tableHead, { flex: 1 }]}>Category / Item</Text>
          <Text style={[styles.tableHead, { width: 50, textAlign: 'right' }]}>
            Qty
          </Text>
          <Text style={[styles.tableHead, { width: 80, textAlign: 'right' }]}>
            Price
          </Text>
          <Text style={[styles.tableHead, { width: 90, textAlign: 'right' }]}>
            Subtotal
          </Text>
        </View>

        {grouped.length === 0 ? (
          <View style={styles.tableRow}>
            <Text style={[styles.smallMuted, { flex: 1 }]}>
              No expenses recorded
            </Text>
          </View>
        ) : (
          grouped.map(({ category, rows }) => {
            const subtotal = rows.reduce((acc, r) => acc + r.qty * r.price, 0)
            const label =
              EXPENSE_CATEGORY_LABELS[category as ExpenseCategory] ?? category
            return (
              <View key={`exp-${category}`} wrap={false}>
                <View
                  style={[
                    styles.tableRow,
                    { backgroundColor: styles.doorsRow.backgroundColor },
                  ]}
                >
                  <Text
                    style={[
                      styles.tableCell,
                      { flex: 1, fontFamily: 'Helvetica-Bold' },
                    ]}
                  >
                    {label}
                  </Text>
                  <Text style={[styles.numCellBold, { width: 220 }]}>
                    {formatUSD(subtotal)}
                  </Text>
                </View>
                {rows.map((r, idx) => (
                  <View key={`exp-${category}-${idx}`} style={styles.tableRow}>
                    <Text
                      style={[
                        styles.tableCellMuted,
                        { flex: 1, paddingLeft: 12 },
                      ]}
                    >
                      {r.item || '—'}
                    </Text>
                    <Text style={[styles.numCell, { width: 50 }]}>{r.qty}</Text>
                    <Text style={[styles.numCell, { width: 80 }]}>
                      {formatUSDCents(r.price)}
                    </Text>
                    <Text style={[styles.numCell, { width: 90 }]}>
                      {formatUSDCents(r.qty * r.price)}
                    </Text>
                  </View>
                ))}
              </View>
            )
          })
        )}

        <View style={styles.totalRow}>
          <Text style={[styles.tableCell, { flex: 1 }]}>Total expenses</Text>
          <Text style={[styles.numCellBold, { width: 220 }]}>
            {formatUSD(summary.est_expenses)}
          </Text>
        </View>

        {/* ---------- Summary ---------- */}
        <Text style={styles.sectionTitle}>Summary</Text>
        <View style={styles.sectionRule} />

        {summary.sponsor_income > 0 && (
          <View style={styles.tableRow}>
            <Text style={[styles.tableCellMuted, { flex: 1 }]}>
              Sponsor income
            </Text>
            <Text style={[styles.numCell, { width: 220 }]}>
              {formatUSD(summary.sponsor_income)}
            </Text>
          </View>
        )}
        {summary.vendor_income > 0 && (
          <View style={styles.tableRow}>
            <Text style={[styles.tableCellMuted, { flex: 1 }]}>
              Vendor income
            </Text>
            <Text style={[styles.numCell, { width: 220 }]}>
              {formatUSD(summary.vendor_income)}
            </Text>
          </View>
        )}
        <View style={styles.tableRow}>
          <Text style={[styles.tableCell, { flex: 1 }]}>Income</Text>
          <Text style={[styles.numCell, { width: 220 }]}>
            {formatUSD(summary.est_income)}
          </Text>
        </View>
        <View style={styles.tableRow}>
          <Text style={[styles.tableCell, { flex: 1 }]}>Expenses</Text>
          <Text style={[styles.numCell, { width: 220 }]}>
            {formatUSD(summary.est_expenses)}
          </Text>
        </View>
        <View style={styles.totalRow}>
          <Text
            style={[
              styles.tableCell,
              { flex: 1, fontFamily: 'Helvetica-Bold' },
            ]}
          >
            Profit
          </Text>
          <Text
            style={[
              styles.numCellBold,
              { width: 220 },
              summary.est_profit < 0 ? styles.bad : styles.good,
            ]}
          >
            {formatUSD(summary.est_profit)}
          </Text>
        </View>

        {/* ---------- Partner split ---------- */}
        <Text style={styles.sectionTitle}>Partner split</Text>
        <View style={styles.sectionRule} />
        <View style={styles.tableRow}>
          <Text style={[styles.tableCellMuted, { flex: 1 }]}>
            LosGothsCo split on net ticket sales{summary.tix_tax > 0 ? ' (after tax)' : ''}
          </Text>
          <Text style={[styles.numCell, { width: 220 }]}>
            {event.splitPct}% × {formatUSD(summary.net_tix_total)} ={' '}
            {formatUSD(summary.losgothsco_tix_net)}
          </Text>
        </View>

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
