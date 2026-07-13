// Job pairs that score above the near-duplicate thresholds but were reviewed and
// confirmed genuinely distinct — recorded here so scripts/check-duplicates.js stops
// re-flagging (and CI stops failing on) the same reviewed pair every run. Order of
// ids within a pair doesn't matter.
//
// Add an entry only after actually comparing the two jobs — this is a record of a
// human decision, not a way to silence the check.
export const ALLOWED_DUPLICATE_PAIRS = [
  [
    "food-cost-percentage-watch",
    "labor-cost-percentage-watch",
    "Same benchmark-against-sales pattern, different cost categories (food vs. labor) — intentionally parallel jobs, not a copy-paste duplicate.",
  ],
  [
    "warranty-claim-deadline-check",
    "warranty-claim-expiry-check",
    "Same deadline-check pattern, different domains — automotive repair-order warranty claims vs. HVAC/appliance manufacturer warranty claims.",
  ],
  [
    "claim-status-check",
    "landlord-insurance-claim-status-check",
    "Same stale-claim-followup goal, different mechanism and scale — generic insurance job is agent-prompt for a single policyholder's claims; realestate job is a zero-token shell scan over a property portfolio's claims CSV.",
  ],
  [
    "competitor-price-watch",
    "competitor-price-monitoring-check",
    "Same competitor-pricing goal, different mechanism — ecommerce job scrapes a competitor's live product page URL per SKU via regex; retail job is an agent-prompt reading a brick-and-mortar competitor's weekly flyer/in-store photos, since there's no comparable URL for a physical shelf price.",
  ],
  [
    "prescription-refill-request-backlog-check",
    "pet-medication-refill-backlog-check",
    "Same stale-refill-request pattern, different domains — healthcare job tracks human patient prescription refills; veterinary job tracks pet medication/food refill requests from clinic clients. Intentionally parallel jobs, not a copy-paste duplicate.",
  ],
  [
    "crew-overtime-hours-check",
    "technician-overtime-hours-check",
    "Same weekly-overtime-total pattern, different labor pools — cleaning-services job tracks cleaning crew members (adds an approaching-limit warning tier); fieldservice job tracks dispatch technicians. Intentionally parallel jobs, not a copy-paste duplicate.",
  ],
  [
    "crew-overtime-hours-check",
    "moving-crew-overtime-hours-check",
    "Same weekly-overtime-total pattern, different labor pools — cleaning-services job tracks cleaning crew members; moving-relocation job tracks moving crew members. Intentionally parallel jobs, not a copy-paste duplicate.",
  ],
  [
    "technician-overtime-hours-check",
    "moving-crew-overtime-hours-check",
    "Same weekly-overtime-total pattern, different labor pools — fieldservice job tracks dispatch technicians; moving-relocation job tracks moving crew members. Intentionally parallel jobs, not a copy-paste duplicate.",
  ],
  [
    "crew-route-schedule-conflict-check",
    "crew-dispatch-schedule-conflict-check",
    "Same same-day double-booking/travel-gap detection pattern, different domains — cleaning-services job scans cleaner job assignments; moving-relocation job scans moving crew/truck assignments. Intentionally parallel jobs, not a copy-paste duplicate.",
  ],
  [
    "creator-sponsor-exclusivity-conflict-check",
    "sponsor-exclusivity-conflict-check",
    "Same category-exclusivity-clause conflict-detection pattern, different domains — creator job scans cross-platform sponsored posts; podcast job scans episode sponsor bookings. Intentionally parallel jobs, not a copy-paste duplicate.",
  ],
];

export function isAllowedPair(idA, idB) {
  return ALLOWED_DUPLICATE_PAIRS.some(([x, y]) => (x === idA && y === idB) || (x === idB && y === idA));
}
