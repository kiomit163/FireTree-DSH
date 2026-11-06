/** Risk-tier vocabulary and pure tier ordering helpers. */

/** Ordered risk tiers from least to most demanding. */
export const TIERS = Object.freeze(['L0', 'L1', 'L2']);

/** Numeric rank used only for comparisons. */
export const TIER_RANK = Object.freeze({
  L0: 0,
  L1: 1,
  L2: 2,
});

/** Human-facing labels for state and report output. */
export const TIER_LABEL = Object.freeze({
  L0: 'L0 light',
  L1: 'L1 standard',
  L2: 'L2 critical',
});

/** Pre-registered per-change token budgets from the scale contract. */
export const TIER_TOKEN_BUDGET = Object.freeze({
  L0: 20000,
  L1: 100000,
  L2: 400000,
});

const TIER_SET = new Set(TIERS);

/**
 * @param {unknown} value - Candidate tier.
 * @returns {boolean} Whether the value is one of L0/L1/L2.
 */
export function isTier(value) {
  return typeof value === 'string' && TIER_SET.has(value);
}

/**
 * @param {unknown} value - Candidate tier.
 * @returns {'L0'|'L1'|'L2'} The validated tier.
 */
export function assertTier(value) {
  if (!isTier(value)) throw new RangeError(`invalid tier: ${String(value)}`);
  return value;
}

/**
 * @param {unknown} tier - Candidate tier.
 * @returns {number} Numeric rank.
 */
export function rankOf(tier) {
  assertTier(tier);
  return TIER_RANK[tier];
}

/**
 * Return the more demanding of two tiers.
 *
 * @param {unknown} left - First tier.
 * @param {unknown} right - Second tier.
 * @returns {'L0'|'L1'|'L2'} The higher tier.
 */
export function higherTier(left, right) {
  return rankOf(left) >= rankOf(right) ? assertTier(left) : assertTier(right);
}

/**
 * @param {unknown} tier - Candidate tier.
 * @param {unknown} minimum - Minimum tier.
 * @returns {boolean} Whether tier is at least minimum.
 */
export function isAtLeast(tier, minimum) {
  return rankOf(tier) >= rankOf(minimum);
}
