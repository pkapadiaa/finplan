# finPlan — Home Loan Prepayment Planner

A single-page, no-build static website to model how prepaying principal reshapes
your home loan(s). Handles **multiple loans together** and shows portfolio totals.

## Run it

Just open the file — no server or install needed:

```bash
open finPlan/index.html
```

(Or double-click `index.html`.) Data is saved to your browser's localStorage; nothing is uploaded.

## What you enter per loan

| Field | Meaning |
|-------|---------|
| Principal (original) | The amount originally borrowed (informational) |
| Annual ROI (%) | Interest rate per year; compounded monthly at ROI/12 |
| Loan term | Original tenure (informational) |
| Outstanding principal | Balance you still owe today |
| Outstanding tenure | Months/years remaining |
| Prepayment options | One or more lump sums to compare (Opt 1, 2, 3…). Use **+ option** to add more; the **radio** marks the "active" one that feeds portfolio totals |

## What it computes

- **Current EMI** — the monthly payment that amortizes your *outstanding* balance
  over the *outstanding* tenure at the given rate.
- **Two prepayment strategies** (toggle at the top):
  - **Tenure fixed → lower EMI**: keeps the same months left, recomputes a smaller EMI.
    Shows your monthly saving.
  - **EMI fixed → shorter tenure**: keeps the EMI, computes how many months earlier
    the loan clears.
- **Interest saved** — reduction in remaining interest for either strategy.
- **Per-loan comparison table** — one row per prepayment option (plus a
  "No prepayment" baseline) so you can eyeball Option 1 vs 2 vs 3 at a glance.
- **Portfolio summary + table** — totals across every loan plus a per-loan
  breakdown row (using each loan's *active* option) with a totals footer.
- **Assets & monthly depletion** — add savings/investment pools (balance,
  optional annual growth, optional monthly addition) and see a month-by-month
  (or yearly) schedule of how they draw down as EMIs and the upfront
  prepayments are paid. Flags the month your assets run dry, or how much is
  left if they outlast the loans.

- **Balance-curve chart** — an inline SVG of the assets balance over the whole
  schedule, with a dashed "runs dry" marker on the month assets are exhausted.
- **Net position** — a top-of-page overview: Assets − Loan outstanding −
  Liabilities, colored green/red, updating live as you edit anything.
- **Pending liabilities** — track dues outside your loans (credit cards,
  personal debt). Give a monthly payment to spread it out, or leave it blank to
  treat it as due now; both feed the depletion schedule.
- **Auto-save** — every edit is persisted to this browser's `localStorage`, so
  your work is restored on the next visit (no button needed).
- **Named plans** — save several scenarios by name (e.g. "Aggressive" vs
  "Conservative") and switch between them from the dropdown in the plans bar.
- **Backup / restore** — **Export .json** downloads your whole plan as a file
  you can keep or move to another device/browser; **Import .json** loads it
  back. This is the only copy that survives clearing browser data.
- **Export / Print** — generates a clean, light-themed report (loans, option
  comparisons, portfolio totals, assets, balance chart, yearly depletion) in a
  new tab with a **Print / Save as PDF** button. If a pop-up blocker stops the
  tab, it falls back to downloading the report as a standalone `.html` file.
- **Drawdown order** — choose how EMIs pull from multiple assets:
  - **Proportional**: every asset shrinks by the same fraction each month.
  - **Priority order**: assets drain top-to-bottom (use the ▲▼ arrows to rank
    them, e.g. spend Savings before touching an FD). Ranks show as `#1, #2…`.

### Depletion model

Each month: every asset grows by `growth/12`, monthly additions are added,
then the combined EMI (for loans still running) is drawn from the pool —
either proportionally or in priority order. Upfront prepayments are deducted at
"month 0". The simulation runs to the longest active loan tenure (capped at 600
months).

## Formulas

- `EMI = P·r·(1+r)^n / ((1+r)^n − 1)`, where `r = ROI/1200`, `n = months`.
- Months to clear a balance at a fixed EMI:
  `n = ln(EMI / (EMI − P·r)) / ln(1+r)`.
- Future interest = `EMI·n − principal`.
