// All financial calculations for the property comparator.
// Pure functions, no side effects, deterministic given the same inputs.
// Section numbers refer to property-comparator-build-spec.md Section 4.

// --- Mortgage & monthly components ---

// § 4.1 — Effective mortgage rate for a property (adds condo overlay for condo/TH).
export function effectiveMortgageRatePct(type, baseRatePct, condoOverlayPct) {
  const overlay = (type === 'condo' || type === 'townhouse') ? condoOverlayPct : 0;
  return baseRatePct + overlay;
}

// § 4.1 — Standard 30-year fixed-rate amortization.
export function monthlyPI(price, downPayment, ratePct) {
  const loan = Math.max(0, price - downPayment);
  if (loan === 0) return 0;
  const r = ratePct / 100 / 12;
  const n = 360;
  if (r === 0) return loan / n;
  const growth = Math.pow(1 + r, n);
  return loan * r * growth / (growth - 1);
}

// § 4.2
export function monthlyPropertyTax(price, taxRatePct) {
  return price * (taxRatePct / 100) / 12;
}

// § 4.4 — Design rule: always show honest all-in; never split for display.
export function allInMonthly(pi, tax, insurance, hoa) {
  return pi + tax + insurance + hoa;
}

// § 4.5 — State-adjusted monthly net income for a property.
export function netForProperty(state, income) {
  const base = income.monthly_net_va;
  if (state === 'MD') return base - income.md_penalty_monthly;
  if (state === 'DC') return base - income.dc_penalty_monthly;
  return base;
}

// § 4.6 — Returns a proportion (0.42 = 42%).
export function pctNet(allIn, net) {
  if (!net || net <= 0) return null;
  return allIn / net;
}

// --- Growth-rate lookups (per property state + type) ---

// § 4.12 — Appreciation matrix.
export function appreciationRatePct(type, state, appreciation) {
  if (state === 'VA') return type === 'sfh' ? appreciation.nova_sfh : appreciation.nova_condo_th;
  if (state === 'MD') return type === 'sfh' ? appreciation.moco_sfh : appreciation.nova_condo_th;
  if (state === 'DC') return type === 'condo' ? appreciation.dc_condo : appreciation.dc_rowhouse_sfh;
  return appreciation.nova_condo_th;
}

// § 4.11 — Property tax bill growth per state.
export function propertyTaxGrowthPct(state, growth) {
  if (state === 'MD') return growth.montgomery_md;
  if (state === 'DC') return growth.dc;
  return growth.fairfax_va;
}

// § 4.11 — HOA growth per state (DC gets a higher rate).
export function hoaGrowthPct(state, growth) {
  return state === 'DC' ? growth.hoa_dc : growth.hoa_nova_md;
}

// § 4.11 — Maintenance grows at hoa_nova_md (~4%) as a proxy for construction inflation.
export function maintenanceGrowthPct(growth) {
  return growth.hoa_nova_md;
}

// --- 10-year projections ---

// Future-value-of-annuity: sum of a value that grows at rate r per year across N years.
// Used for tax, insurance, HOA, and maintenance 10-yr totals.
export function tenYrSum(yr1Value, growthPct, years = 10) {
  const r = growthPct / 100;
  if (r === 0) return yr1Value * years;
  return yr1Value * (Math.pow(1 + r, years) - 1) / r;
}

// § 4.14
export function homeValueYr10(price, appreciationPct) {
  return price * Math.pow(1 + appreciationPct / 100, 10);
}

// § 4.15 — Remaining balance on a 30-year loan after 120 payments.
export function loanBalanceYr10(loanAmount, ratePct) {
  if (loanAmount <= 0) return 0;
  const r = ratePct / 100 / 12;
  const totalTerm = 360;
  const paidTerm = 120;
  if (r === 0) return loanAmount * (totalTerm - paidTerm) / totalTerm;
  const gTotal = Math.pow(1 + r, totalTerm);
  const gPaid = Math.pow(1 + r, paidTerm);
  return loanAmount * (gTotal - gPaid) / (gTotal - 1);
}

// § 4.16
export function endingEquity(homeVal, loanBal) {
  return homeVal - loanBal;
}

// --- SFH maintenance reserve (§ 4.13) ---

export function maintenanceTier(yearBuilt) {
  if (!yearBuilt) return null;
  if (yearBuilt >= 2010) return 'post_2010';
  if (yearBuilt >= 1990) return '1990_2010';
  return 'pre_1990';
}

export function maintenanceRatePerSqft(yearBuilt, override, tiers) {
  if (override && override > 0) return override;
  const tier = maintenanceTier(yearBuilt);
  return tier ? tiers[tier] : tiers['1990_2010'];
}

export function maintenanceYr1(type, sqft, yearBuilt, override, tiers) {
  if (type !== 'sfh' || !sqft) return 0;
  return sqft * maintenanceRatePerSqft(yearBuilt, override, tiers);
}

// --- Closing costs (§ 4.19) ---

export function closingCostRatePct(state, isFirstTimeDcBuyer, closingCosts) {
  if (state === 'MD') return closingCosts.montgomery_md;
  if (state === 'DC') return isFirstTimeDcBuyer ? closingCosts.dc_first_time_reduced : closingCosts.dc_standard;
  return closingCosts.fairfax_va;
}

// --- Deal-breaker filter (§ 4.20) ---

// "unknown" and "n/a" never reject. Derived, not persisted.
export function evaluateHardFilters(property) {
  const hf = property.hard_filters || {};
  const type = property.type;
  const reasons = [];
  if (hf.covered_assigned_parking === 'no') reasons.push('No covered/assigned parking');
  if (type === 'condo' || type === 'townhouse') {
    if (hf.elevator === 'no') reasons.push('No elevator');
    if (hf.not_ground_floor === 'no') reasons.push('Ground floor');
  }
  if (hf.pet_friendly === 'no') reasons.push('Not pet-friendly');
  return { rejected: reasons.length > 0, reasons };
}

// --- Aggregate: every derived value the UI needs, computed in one pass ---

export function computeAll(property, assumptions) {
  const fin = property.financial || {};
  const phys = property.physical || {};
  const type = property.type;
  const state = property.state;

  const price = fin.price || 0;
  const downPayment = fin.down_payment || 0;
  const loanAmount = Math.max(0, price - downPayment);

  // Rate: property-stored base rate + condo overlay (or fall back to global base rate).
  const baseRate = fin.mortgage_rate_pct != null
    ? fin.mortgage_rate_pct
    : assumptions.financing.mortgage_rate_pct;
  const effectiveRate = effectiveMortgageRatePct(type, baseRate, assumptions.financing.condo_rate_overlay_pct);
  const pi = monthlyPI(price, downPayment, effectiveRate);

  const taxRate = fin.property_tax_rate_pct || 0;
  const tax = monthlyPropertyTax(price, taxRate);
  const insurance = fin.insurance_monthly || 0;
  const hoa = fin.hoa_monthly || 0;
  const allIn = allInMonthly(pi, tax, insurance, hoa);

  const net = netForProperty(state, assumptions.income);
  const pct = pctNet(allIn, net);

  const taxGrowth = propertyTaxGrowthPct(state, assumptions.property_tax_growth_pct);
  const hoaGrowth = hoaGrowthPct(state, assumptions.operating_cost_growth_pct);
  const insGrowth = assumptions.operating_cost_growth_pct.insurance;
  const maintGrowth = maintenanceGrowthPct(assumptions.operating_cost_growth_pct);
  const apprPct = appreciationRatePct(type, state, assumptions.appreciation_pct);

  const piTotal = pi * 120;
  const taxTotal = tenYrSum(tax * 12, taxGrowth);
  const insuranceTotal = tenYrSum(insurance * 12, insGrowth);
  const hoaTotal = tenYrSum(hoa * 12, hoaGrowth);

  const maintYr1 = maintenanceYr1(
    type, phys.sqft, phys.year_built,
    fin.maintenance_sqft_override,
    assumptions.maintenance_sqft_yr,
  );
  const maintenanceTotal = maintYr1 > 0 ? tenYrSum(maintYr1, maintGrowth) : 0;

  const closingRate = closingCostRatePct(state, !!fin.first_time_dc_buyer, assumptions.closing_costs_pct);
  const closingCosts = price * (closingRate / 100);

  const totalOutOfPocket = piTotal + taxTotal + insuranceTotal + hoaTotal
    + maintenanceTotal + downPayment + closingCosts;

  const homeVal10 = homeValueYr10(price, apprPct);
  const loanBal10 = loanBalanceYr10(loanAmount, effectiveRate);
  const equity10 = endingEquity(homeVal10, loanBal10);
  const netCost = totalOutOfPocket - equity10;

  const filter = evaluateHardFilters(property);

  return {
    loanAmount,
    effectiveRatePct: effectiveRate,
    monthlyPI: pi,
    monthlyPropertyTax: tax,
    monthlyInsurance: insurance,
    monthlyHoa: hoa,
    allInMonthly: allIn,
    netIncomeMonthly: net,
    pctNet: pct,
    appreciationRatePct: apprPct,
    piTotal,
    taxTotal,
    insuranceTotal,
    hoaTotal,
    maintenanceYr1: maintYr1,
    maintenanceTotal,
    closingCosts,
    totalOutOfPocket,
    homeValueYr10: homeVal10,
    loanBalanceYr10: loanBal10,
    endingEquity: equity10,
    net10YrCost: netCost,
    isRejected: filter.rejected,
    rejectionReasons: filter.reasons,
  };
}
