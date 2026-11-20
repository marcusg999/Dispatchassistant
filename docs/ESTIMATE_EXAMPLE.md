# Worked example: one fully traced estimate

Generated from the shared pricing engine (`src/shared/estimate`) with the **SAMPLE** rate card. These are placeholder rates, not real prices. Regenerate after rate or engine changes; the same scenario is the `long_haul_crate` golden fixture, so a test fails if any number here drifts.

**Scenario:** deliver one large painting (oil on canvas, 60 × 48 × 3 in, 45 lb, declared value $120,000) 380.5 miles in an air-ride climate truck. Custom crate chosen. 9 hours of labor and vehicle time, 2 flights of stairs at delivery, placement of 1 item. No client discount, tax off.

| # | Category | Line | Qty | Unit price | Amount | How it was calculated |
|---|---|---|---:|---:|---:|---|
| 1 | Transport | Weight handling (200 lb billable) | 2 cwt | $18.00 | $36.00 | Dimensional weight = packed L×W×H ÷ 250. 1× Large painting: max(actual 45 lb, dimensional 200 lb) = 200 lb. Total 200 lb = 2 cwt × $18.00/cwt. |
| 2 | Transport | Air-ride climate truck: time | 9 hour | $95.00 | $855.00 | 9 h (rounded up to 0.25 h) × $95.00/h. |
| 3 | Transport | Air-ride climate truck: mileage (Long-haul) | 380.5 mile | $3.60 | $1,369.80 | 380.5 mi total → Long-haul tier (up to 100000 mi): $4.50/mi × 80% = $3.60/mi. |
| 4 | Packing & crating | Custom crate: Large painting (outer 69.5 × 57.5 × 12.5 in) | 1 crate | $1,843.50 | $1,843.50 | Per piece: plywood 3 sheet(s) = $285.00; lumber 93 lf = $325.50; foam 144 bf = $648.00; hardware kit = $45.00; paint / stencil = $30.00; shop labor 6 h (Large) = $510.00 → $1,843.50 × 1. |
| 5 | Labor | Labor: driver × 1 | 8 person-hour | $85.00 | $680.00 | 9 h job, minimum 4 h, rounded to 0.25 h → 9 h. 1 × 8 regular h × $85.00/h = $85.00/h. |
| 6 | Labor | Overtime: driver × 1 | 1 person-hour | $127.50 | $127.50 | Hours over 8/day: 1 × 1 h × $85.00 × 150% = $127.50/h. |
| 7 | Labor | Labor: lead × 1 | 8 person-hour | $95.00 | $760.00 | 9 h job, minimum 4 h, rounded to 0.25 h → 9 h. 1 × 8 regular h × $95.00/h = $95.00/h. |
| 8 | Labor | Overtime: lead × 1 | 1 person-hour | $142.50 | $142.50 | Hours over 8/day: 1 × 1 h × $95.00 × 150% = $142.50/h. |
| 9 | Labor | Labor: art handler × 1 | 8 person-hour | $80.00 | $640.00 | 9 h job, minimum 4 h, rounded to 0.25 h → 9 h. 1 × 8 regular h × $80.00/h = $80.00/h. |
| 10 | Labor | Overtime: art handler × 1 | 1 person-hour | $120.00 | $120.00 | Hours over 8/day: 1 × 1 h × $80.00 × 150% = $120.00/h. |
| 11 | Access surcharges | Stairs (per flight) | 2 flight | $75.00 | $150.00 | 2 flight × $75.00. |
| 12 | Add-ons | Placement / installation (per item) | 1 item | $75.00 | $75.00 | 1 item × $75.00. |
| 13 | Insurance / valuation | Valuation coverage (declared $120,000.00) | 1 each | $1,200.00 | $1,200.00 | 1% of $120,000.00 = $1,200.00; minimum $50.00 → $1,200.00. Cost 0.60% = $720.00. |
| 14 | Transport | Fuel surcharge (8%) | 1 each | $180.86 | $180.86 | 8% of transport $2,260.80 = $180.86. |

| | |
|---|---:|
| Subtotal | $8,180.16 |
| Discount | $0.00 |
| Tax | $0.00 |
| **Total** | **$8,180.16** |
| Internal cost | $4,007.31 |
| Margin | $4,172.85 (51.01%; target 35%) |

**Crew:** 3 (Every move starts with two people (2); +1 for stairs) → 1 driver, 1 lead, 1 art handler.

**Crate takeoff (build sheet, no prices):** outer 69.5 × 57.5 × 12.5 in (Large), 3 plywood sheet(s), 93 lf lumber, 144 bf foam, 1 hardware kit, 6 shop hours.

**Approval:** not needed (no discount; margin above target).

**Hand checks:** dimensional weight = (60+2×4.75) × (48+2×4.75) × (3+2×4.75) ÷ 250 = 69.5 × 57.5 × 12.5 ÷ 250 = 199.8 → 200 lb. Mileage $4.50 × 80% (long-haul tier) = $3.60/mi × 380.5 = $1,369.80. Fuel 8% of transport. Insurance 1% of $120,000 = $1,200.00. Every line is qty × unit price rounded half-up to the cent once; the total is the sum of the lines.
