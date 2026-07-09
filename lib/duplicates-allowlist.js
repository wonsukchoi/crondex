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
];

export function isAllowedPair(idA, idB) {
  return ALLOWED_DUPLICATE_PAIRS.some(([x, y]) => (x === idA && y === idB) || (x === idB && y === idA));
}
