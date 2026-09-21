// Scoring functions for the four scorecard axes.
// Section numbers refer to property-comparator-build-spec.md Section 4.

// § 4.7 — Financial score from pctNet (a proportion, e.g. 0.42 = 42%).
export function financialScore(pctNetVal) {
  if (pctNetVal == null || Number.isNaN(pctNetVal)) return null;
  if (pctNetVal < 0.33) return 5;
  if (pctNetVal < 0.42) return 4;
  if (pctNetVal < 0.50) return 3;
  if (pctNetVal < 0.60) return 2;
  return 1;
}

// § 4.8 — Commute score from weekly hours.
// Tysons commute is 4x/wk (round trip); Aspen Hill visit is 2x/wk (round trip).
export function commuteScore(tysonsMinutesOneWay, aspenHillMinutesOneWay) {
  if (tysonsMinutesOneWay == null && aspenHillMinutesOneWay == null) return null;
  const t = ((tysonsMinutesOneWay || 0) * 2 * 4) / 60;
  const a = ((aspenHillMinutesOneWay || 0) * 2 * 2) / 60;
  const total = t + a;
  if (total < 5) return 5;
  if (total < 6.5) return 4;
  if (total < 8) return 3;
  if (total < 10) return 2;
  return 1;
}

// § 4.9 — Fit sub-scores.
const OUTDOOR_SUB_SCORES = {
  large_yard: 5,
  small_yard: 4,
  patio: 4,
  large_balcony: 3,
  small_balcony: 2,
  none: 1,
};

export function outdoorSubScore(outdoorSpace) {
  if (!outdoorSpace) return null;
  return OUTDOOR_SUB_SCORES[outdoorSpace] ?? null;
}

export function sizeSubScore(sqft) {
  if (!sqft || sqft <= 0) return null;
  return Math.min(5, sqft / 240);
}

// Composite Fit score. Any missing sub-score drops out of the average
// rather than penalizing to 0. Returns null when all three are missing.
export function fitScore(outdoorSpace, condition, sqft) {
  const parts = [];
  const o = outdoorSubScore(outdoorSpace);
  if (o != null) parts.push(o);
  if (typeof condition === 'number' && condition >= 1) parts.push(condition);
  const s = sizeSubScore(sqft);
  if (s != null) parts.push(s);
  if (parts.length === 0) return null;
  const avg = parts.reduce((sum, v) => sum + v, 0) / parts.length;
  return Math.round(avg * 10) / 10; // 1 decimal place for the label
}

// § 4.10 — Simple mean of the five gut-check ratings, nulls ignored.
// Field names match property.gut_check keys.
const GUT_CHECK_FIELDS = ['grandson_visits', 'friends_over', 'diy_projects', 'pepper_safe', 'outdoor_life'];

export function gutCheckAverage(gutCheck) {
  if (!gutCheck) return null;
  const rated = GUT_CHECK_FIELDS
    .map((f) => gutCheck[f])
    .filter((v) => typeof v === 'number' && v >= 1 && v <= 5);
  if (rated.length === 0) return null;
  const sum = rated.reduce((a, b) => a + b, 0);
  return sum / rated.length;
}
