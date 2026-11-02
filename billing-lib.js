// The billing rules for Family bills, ported from Ajax Cubs HQ (Code.gs: computeTotals_, buildCarriedForwardRecord_, resupplyFeeDue_,
// withdrawalStatusFor_, the CCCAP age lookup and the day-counting rules). Plain functions with no page code in them, so they can be
// tested on their own (tests/billing-lib.test.mjs) and checked against HQ's stored bills (tools/golden-hq.mjs).
//
// Field names follow HQ (childFirst, daysPerWeek, subsidy1Org, ...) so every rule can be compared with Code.gs line by line.
// Dates are 'YYYY-MM-DD' text, months are 'YYYY-MM' text, money is a plain number rounded to cents the way HQ rounds it.
//
// IMPORTANT: Ajax Cubs HQ is the truth. Where this file does something unexpected, it is because HQ does it.

export const SETTINGS_DEFAULTS = {
  resupplyFallSpringFee: 125, resupplySummerFee: 100, creditCardFeeRate: 2.9, siblingDiscountRate: 5,
  cccapInfantMaxMonths: 18, cccapToddlerMaxMonths: 36, cccapPreschoolMaxMonths: 72,
  upkCap10hrs: 5020.68, upkCap15hrs: 6330.43, upkCap30hrs: 11241.97, schoolYearWeeks: 36, upkHoursPerDay: 9.25,
  upkDailyRate5Day: 95, upkDailyRate3Day: 97, upkDailyRate2Day: 99, upkBillingMonths: 9,
};
export const PROGRAMS = ['5-Day', '4-Day', '3-Day', '2-Day', 'Drop-in'];
export const BILLING_MODES = ['School Year', 'Summer/Drop-in'];
export const BILLING_STATUSES = ['Not Started', 'Needs Adjustment', 'Ready'];
export const PAYMENT_METHODS = ['Credit Card', 'Debit Card', 'ACH/Bank', 'Check', 'Cash'];

export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
const num = v => Number(v) || 0;

// ---------- dates and months ----------
export function monthKeyOf(dateText) { return String(dateText || '').slice(0, 7); }
export function monthLabel(monthKey) {
  const [y, m] = String(monthKey).split('-').map(Number);
  return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] + ' ' + y;
}
export function addMonths(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number), t = y * 12 + (m - 1) + n;
  return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0');
}
export function daysInMonth(monthKey) { const [y, m] = monthKey.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
export function isoDate(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
// 'M/d/yy', 'M/d/yyyy' or 'YYYY-MM-DD' (a leading date is enough) -> 'YYYY-MM-DD', or null
export function normalizeDate(s) {
  const t = String(s ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t);
  if (m) return valid(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return null;
}
function valid(y, m, d) { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? isoDate(y, m, d) : null; }

// a list of weekdays (0 = Sunday ... 6 = Saturday) from an array or HQ's comma text
export function daysList(v) {
  if (Array.isArray(v)) return v.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  return String(v ?? '').split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
}
// Drop-in days: a list of specific dates; the count is however many distinct valid dates are listed.
export function parseDropInDates(v) {
  const list = Array.isArray(v) ? v : String(v ?? '').split(',');
  const seen = new Set();
  list.map(s => String(s).trim()).filter(Boolean).forEach(s => { const d = normalizeDate(s); if (d) seen.add(d); });
  return [...seen].sort();
}

// ---------- rates, funding ----------
// whole months of age on a date (calendar-accurate): born 3/15 is still 17 months on 8/14 and 18 months on 9/15
export function ageInMonthsAsOf(dob, asOf) {
  const a = normalizeDate(dob), b = normalizeDate(asOf);
  if (!a || !b) return null;
  const [dy, dm, dd] = a.split('-').map(Number), [ay, am, ad] = b.split('-').map(Number);
  let months = (ay - dy) * 12 + (am - dm);
  if (ad < dd) months--;
  return months;
}
export function cccapCategoryFor(ageMonths, settings) {
  if (ageMonths == null || ageMonths < 0) return 'schoolAge';
  if (ageMonths < settings.cccapInfantMaxMonths) return 'infant';
  if (ageMonths < settings.cccapToddlerMaxMonths) return 'toddler';
  if (ageMonths < settings.cccapPreschoolMaxMonths) return 'preschool';
  return 'schoolAge';
}
// the child's CCCAP daily rate for a month: their county's rate for the age group they are in on the 1st of the month
export function cccapRateFor(ctx, county, dob, monthKey) {
  if (!county || !dob) return 0;
  const row = ctx.cccap[county];
  if (!row) return 0;
  return num(row[cccapCategoryFor(ageInMonthsAsOf(dob, monthKey + '-01'), ctx.settings)]);
}
export function effectiveSubsidy1DailyRate(ctx, child, monthKey) {
  if (child.subsidy1Org === 'CCCAP') return cccapRateFor(ctx, child.cccapCounty, child.dob, monthKey);
  return num(child.subsidy1DailyRate);
}
// UPK3 / UPK4 come from the UPK table (hours tier + program); Emergency Funding is a flat amount; blank is 0
export function effectiveSubsidy2Amount(ctx, child) {
  if (!child) return 0;
  if (child.subsidy2Org === 'UPK3' || child.subsidy2Org === 'UPK4') {
    if (!child.upkTier) return 0;
    const row = ctx.upk.find(r => r.org === child.subsidy2Org && r.tier === child.upkTier && r.program === child.daysPerWeek);
    return row ? num(row.amount) : 0;
  }
  if (child.subsidy2Org === 'Emergency Funding') return num(child.emergencyFundingAmount);
  return 0;
}

// the rates and tables in one lookup-friendly object. rates = the platform's billingRates() answer (database rows).
export function makeContext(rates) {
  const r = rates || {};
  const settings = { ...SETTINGS_DEFAULTS };
  (r.settings || []).forEach(s => { const n = Number(s.value); if (Number.isFinite(n)) settings[s.key] = n; });
  const rateCards = {};
  (r.rateCards || []).forEach(c => { rateCards[c.program] = { category: c.program, semesterMonthlyRate: num(c.monthly_rate), summerDailyRate: num(c.daily_rate), defaultDaysOfAttendance: num(c.default_days) }; });
  const cccap = {};
  (r.cccap || []).forEach(c => { cccap[c.county] = { infant: num(c.infant_rate), toddler: num(c.toddler_rate), preschool: num(c.preschool_rate), schoolAge: num(c.school_age_rate) }; });
  return { settings, rateCards, cccap, upk: (r.upk || []).map(u => ({ org: u.org, tier: u.tier, program: u.program, amount: num(u.amount) })), closures: (r.closures || []).map(c => String(c).slice(0, 10)) };
}
export function rateCardFor(ctx, program) {
  return ctx.rateCards[program] || { category: program, semesterMonthlyRate: 0, summerDailyRate: 0, defaultDaysOfAttendance: 0 };
}

// ---------- semester, resupply, withdrawal ----------
export function semesterForMonthKey(monthKey) {
  const month = Number(monthKey.split('-')[1]);
  if (month >= 6 && month <= 8) return 'Summer';
  if (month >= 9) return 'Fall';
  return 'Spring';
}
// The resupply fee is billed in the first month of each semester (Sep, Jan, Jun) for children whose "date active" has arrived,
// unless they are exempt (financial-aid cases the agreement forbids it for). A blank date means not yet.
export function resupplyFeeDue(child, monthKey, settings) {
  const month = Number(monthKey.split('-')[1]);
  if (month !== 9 && month !== 1 && month !== 6) return 0;
  if (child.resupplyFeeExempt) return 0;
  const kicksIn = String(child.materialsFeeKickIn || '').trim().toLowerCase();
  if (!kicksIn || kicksIn === 'not allowed') return 0;
  if (kicksIn !== 'now') {
    const kick = normalizeDate(child.materialsFeeKickIn);
    if (!kick || kick > monthKey + '-01') return 0;
  }
  return num(month === 6 ? settings.resupplySummerFee : settings.resupplyFallSpringFee);
}
// the month of the Last Invoice Date is 'final' (billed as usual, flagged); any later month is 'inactive' (the whole bill is $0)
export function withdrawalStatusFor(child, monthKey) {
  if (!child || !child.lastInvoiceDate) return null;
  const d = normalizeDate(child.lastInvoiceDate);
  if (!d) return null;
  const last = d.slice(0, 7);
  if (monthKey === last) return 'final';
  if (monthKey > last) return 'inactive';
  return null;
}

// ---------- counting days ----------
export function programDayPattern(program) {
  if (program === '5-Day') return [1, 2, 3, 4, 5];
  if (program === '4-Day') return [1, 2, 3, 4];
  if (program === '3-Day') return [1, 3, 5];
  if (program === '2-Day') return [2, 4];
  return [];
}
export function countPatternDaysInMonth(monthKey, pattern, closures, excludeClosures) {
  if (!pattern.length) return null;
  const closed = new Set((closures || []).map(c => String(c).slice(0, 10)));
  const [y, m] = monthKey.split('-').map(Number), n = daysInMonth(monthKey);
  let count = 0;
  for (let d = 1; d <= n; d++) {
    if (!pattern.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) continue;
    if (excludeClosures && closed.has(isoDate(y, m, d))) continue;
    count++;
  }
  return count;
}
// The child's own day-count rule: custom days when set; otherwise CCCAP counts the program's usual days minus closures, Kids First
// counts the usual days with closures NOT reducing it. Anyone else: null (fall back to the rate card's usual number of days).
export function countRuleDays(monthKey, child, closures) {
  const useCustom = child.dayCountRule === true || child.dayCountRule === 'Custom';
  let pattern, excludeClosures;
  if (useCustom) { pattern = daysList(child.customDays); excludeClosures = !!child.customDaysExcludeClosures; }
  else if (child.subsidy1Org === 'CCCAP' || child.subsidy1Org === 'Kids First') { pattern = programDayPattern(child.daysPerWeek); excludeClosures = child.subsidy1Org === 'CCCAP'; }
  else return null;
  return countPatternDaysInMonth(monthKey, pattern, closures, excludeClosures);
}
// Kids First may fund fewer weekdays than the child attends; null means "the same as attendance"
export function kidsFirstSubsidizedDays(monthKey, child, closures) {
  if (child.subsidy1Org !== 'Kids First') return null;
  const pattern = daysList(child.kidsFirstCustomDays);
  if (!pattern.length) return null;
  return countPatternDaysInMonth(monthKey, pattern, closures, false);
}

// ---------- the bill ----------
// School Year: the base charge is the flat monthly rate. Summer/Drop-in: daily rate x days attended. CCCAP: its daily rate x days
// attended, and CCCAP pays all of that except the family's Parent Fee. Subsidy never changes total revenue, only who pays it.
// rec = the month's bill fields; settings = ctx.settings; child = the roster fields (for a frozen bill, the frozen copy).
export function computeTotals(rec, settings, child) {
  const withdrawalStatus = withdrawalStatusFor(child, rec.monthKey);
  if (withdrawalStatus === 'inactive') {
    return { totalSubsidy: 0, billForFamilies: 0, monthlyRevenue: 0, creditCardFee: 0, siblingDiscount: 0, dropInDays: 0, resupplyFee: 0, withdrawalStatus: 'inactive' };
  }
  const isCccap = !!(child && child.subsidy1Org === 'CCCAP');
  const useDailyRate = rec.billingMode === 'Summer/Drop-in';
  let baseCharge, subsidy1Total;
  if (isCccap) {
    baseCharge = round2(num(rec.subsidy1DailyRate) * num(rec.daysOfAttendance));
    subsidy1Total = round2(baseCharge - num(child.cccapParentFee));
  } else {
    baseCharge = useDailyRate ? num(rec.dailyRate) * num(rec.daysOfAttendance) : num(rec.monthlyRate);
    subsidy1Total = round2(num(rec.subsidy1DailyRate) * num(rec.daysSubsidized));
  }
  const totalSubsidy = round2(subsidy1Total + num(rec.subsidy2Amount));
  const dropInDayCount = rec.dropInEnabled ? parseDropInDates(rec.dropInDates).length : 0;
  const dropInCharge = dropInDayCount * num(rec.dropInRate);
  const addedFeesCharge = rec.addedFeesEnabled ? num(rec.addedFees) : 0;
  const creditsCharge = rec.creditsEnabled ? num(rec.credits) : 0;
  const resupplyFee = (child && child.resupplyFeeExempt) ? 0 : num(rec.resupplyFeeAmount);
  const subtotal = round2(baseCharge - totalSubsidy + dropInCharge + addedFeesCharge + resupplyFee - creditsCharge);
  const siblingRate = ((settings && settings.siblingDiscountRate) || 0) / 100;
  const siblingDiscount = rec.siblingDiscountEnabled ? round2(subtotal * siblingRate) : 0;
  const afterDiscount = round2(subtotal - siblingDiscount);
  const feeRate = ((settings && settings.creditCardFeeRate) || 0) / 100;
  const creditCardFee = (rec.paymentMethod === 'Credit Card' && rec.creditCardFeeEnabled) ? round2(afterDiscount * feeRate) : 0;
  const billForFamilies = round2(afterDiscount + creditCardFee);
  const monthlyRevenue = round2(totalSubsidy + billForFamilies);
  return { totalSubsidy, billForFamilies, monthlyRevenue, creditCardFee, siblingDiscount, dropInDays: dropInDayCount, resupplyFee, withdrawalStatus };
}

// A new month's bill for a child, carrying the slower-changing details (rates, payment method, mode, sibling toggle) from the child's
// latest earlier bill and starting everything entered monthly (attendance counted, credits, drop-ins, fees, notes) fresh.
// priorBills = the child's earlier bills (any order).
export function buildCarriedForwardBill(ctx, child, monthKey, priorBills) {
  const prev = (priorBills || []).filter(r => r.monthKey < monthKey).sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1))[0];
  const card = rateCardFor(ctx, child.daysPerWeek);
  const billingMode = prev ? prev.billingMode : (semesterForMonthKey(monthKey) === 'Summer' ? 'Summer/Drop-in' : 'School Year');
  const ruleDays = countRuleDays(monthKey, child, ctx.closures);
  const defaultDays = ruleDays != null ? ruleDays : card.defaultDaysOfAttendance;
  const kidsFirstDays = kidsFirstSubsidizedDays(monthKey, child, ctx.closures);
  const has = v => v !== '' && v !== null && v !== undefined;
  const bill = {
    monthKey, childId: child.id, billingMode,
    monthlyRate: prev ? prev.monthlyRate : (has(child.monthlyRate) ? Number(child.monthlyRate) : card.semesterMonthlyRate),
    dailyRate: prev ? prev.dailyRate : (has(child.dailyRate) ? Number(child.dailyRate) : card.summerDailyRate),
    daysOfAttendance: defaultDays,
    subsidy1DailyRate: effectiveSubsidy1DailyRate(ctx, child, monthKey),
    daysSubsidized: kidsFirstDays != null ? kidsFirstDays : defaultDays,
    subsidy2Amount: effectiveSubsidy2Amount(ctx, child),
    credits: 0, creditsNote: '', creditsEnabled: false,
    dropInEnabled: false, dropInDates: [], dropInDays: 0, dropInRate: prev ? prev.dropInRate : card.summerDailyRate,
    addedFees: 0, addedFeesEnabled: false, addedFeesNote: '',
    resupplyFeeAmount: resupplyFeeDue(child, monthKey, ctx.settings), resupplyFeeNote: '',
    recurringPayment: prev ? !!prev.recurringPayment : false,
    paymentMethod: prev ? prev.paymentMethod : (child.paymentMethod || ''),
    creditCardFeeEnabled: (prev && prev.creditCardFeeEnabled !== '' && prev.creditCardFeeEnabled != null) ? !!prev.creditCardFeeEnabled : true,
    siblingDiscountEnabled: prev ? !!prev.siblingDiscountEnabled : false,
    billingStatus: 'Not Started', invoiced: false, invoicedAt: null, notes: '',
  };
  return { ...bill, ...computeTotals(bill, ctx.settings, { ...child, ...bill }) };
}

// An open (not invoiced) bill follows the roster: the funding rates are looked up again from the roster / county / age every time, and the
// totals worked out again. Returns the bill as it should now be stored (a new object). A frozen (invoiced) bill is returned unchanged.
export function refreshOpenBill(ctx, child, bill) {
  if (bill.invoiced) return bill;
  const next = { ...bill };
  next.subsidy1DailyRate = effectiveSubsidy1DailyRate(ctx, child, bill.monthKey);
  next.subsidy2Amount = effectiveSubsidy2Amount(ctx, child);
  if (next.resupplyFeeAmount === '' || next.resupplyFeeAmount == null || !Number.isFinite(Number(next.resupplyFeeAmount))) next.resupplyFeeAmount = resupplyFeeDue(child, bill.monthKey, ctx.settings);
  return { ...next, ...computeTotals(next, ctx.settings, { ...child, ...next }) };
}

// what the family-facing pieces of a bill are, in the order they are added up (for the on-screen breakdown and the export)
export function breakdown(bill, child, settings) {
  const t = computeTotals(bill, settings, { ...child, ...bill });
  if (t.withdrawalStatus === 'inactive') return { lines: [], totals: t, inactive: true };
  const cccap = child.subsidy1Org === 'CCCAP', daily = bill.billingMode === 'Summer/Drop-in';
  const lines = [];
  if (cccap) lines.push(['CCCAP rate × days attended', round2(num(bill.subsidy1DailyRate) * num(bill.daysOfAttendance)), num(bill.daysOfAttendance) + ' days × $' + num(bill.subsidy1DailyRate)]);
  else if (daily) lines.push(['Daily rate × days attended', round2(num(bill.dailyRate) * num(bill.daysOfAttendance)), num(bill.daysOfAttendance) + ' days × $' + num(bill.dailyRate)]);
  else lines.push(['Monthly tuition', num(bill.monthlyRate), 'flat monthly rate']);
  if (t.totalSubsidy) lines.push(['Subsidy and funding', -t.totalSubsidy, cccap ? 'CCCAP pays the rest after the Parent Fee' : 'paid by the program, not the family']);
  if (t.dropInDays) lines.push(['Drop-in days', round2(t.dropInDays * num(bill.dropInRate)), t.dropInDays + ' × $' + num(bill.dropInRate)]);
  if (bill.addedFeesEnabled && num(bill.addedFees)) lines.push(['Added fees', num(bill.addedFees), bill.addedFeesNote || '']);
  if (t.resupplyFee) lines.push(['Resupply fee', t.resupplyFee, bill.resupplyFeeNote || '']);
  if (bill.creditsEnabled && num(bill.credits)) lines.push(['Credits', -num(bill.credits), bill.creditsNote || '']);
  if (t.siblingDiscount) lines.push(['Sibling discount', -t.siblingDiscount, num(settings.siblingDiscountRate) + '%']);
  if (t.creditCardFee) lines.push(['Credit card fee', t.creditCardFee, num(settings.creditCardFeeRate) + '%']);
  return { lines, totals: t, inactive: false };
}

// The rates the roster says this child pays: the child's own rate when one is set, else the rate card for their program.
export function rosterRatesFor(ctx, child) {
  const card = rateCardFor(ctx, child.daysPerWeek), has = v => v !== '' && v !== null && v !== undefined;
  return { monthlyRate: has(child.monthlyRate) ? Number(child.monthlyRate) : card.semesterMonthlyRate, dailyRate: has(child.dailyRate) ? Number(child.dailyRate) : card.summerDailyRate };
}

// Things worth a second look before invoicing (plain sentences). today = 'YYYY-MM-DD' (for expiry dates); optional.
export function billWarnings(ctx, child, bill, today) {
  const w = [];
  if (!child.daysPerWeek) w.push('This child has no program.');
  if ((child.subsidy2Org === 'UPK3' || child.subsidy2Org === 'UPK4')) {
    if (child.daysPerWeek === 'Drop-in') w.push('UPK is switched on but there is no UPK amount for a Drop-in child, so no UPK funding is taken off. (HQ gives $0 here without saying so.)');
    else if (!child.upkTier) w.push('UPK is switched on but no UPK hours are chosen, so no UPK funding is taken off.');
    else if (!ctx.upk.some(r => r.org === child.subsidy2Org && r.tier === child.upkTier && r.program === child.daysPerWeek)) w.push('There is no ' + child.subsidy2Org + ' amount for ' + child.upkTier + ' and ' + child.daysPerWeek + ', so no UPK funding is taken off.');
  }
  if (child.subsidy1Org === 'CCCAP') {
    if (!child.cccapCounty) w.push('CCCAP is switched on but no county is chosen, so the CCCAP rate is $0.');
    else if (!ctx.cccap[child.cccapCounty]) w.push('There is no CCCAP rate for ' + child.cccapCounty + ' county.');
    else if (!child.dob) w.push('CCCAP needs the child\'s birthday to pick the age group.');
    else if (!num(bill.subsidy1DailyRate)) w.push('The CCCAP rate came out as $0.');
    if (today && child.cccapExpirationDate) { const e = normalizeDate(child.cccapExpirationDate); if (e && e < today) w.push('The CCCAP authorization expired on ' + e + '.'); }
  }
  if (child.subsidy1Org === 'Kids First' && !num(bill.subsidy1DailyRate)) w.push('Kids First is switched on but has no daily rate.');
  if (bill.billingMode === 'Summer/Drop-in' && !num(bill.dailyRate)) w.push('Summer/Drop-in billing needs a daily rate.');
  if (bill.billingMode !== 'Summer/Drop-in' && child.subsidy1Org !== 'CCCAP' && !num(bill.monthlyRate)) w.push('The monthly rate is $0.');
  if (child.subsidy1Org !== 'CCCAP' && child.daysPerWeek) {      // a bill made before a program or rate change keeps the old rate (HQ carries rates forward): say so
    const rr = rosterRatesFor(ctx, child), daily = bill.billingMode === 'Summer/Drop-in';
    const have = daily ? num(bill.dailyRate) : num(bill.monthlyRate), want = daily ? rr.dailyRate : rr.monthlyRate;
    if (want > 0 && Math.abs(have - want) >= 0.005) w.push('The ' + (daily ? 'daily' : 'monthly') + ' rate on this bill is ' + fmt(have) + ', but the roster rate for ' + child.daysPerWeek + ' is ' + fmt(want) + '. Use the roster\'s rate, or leave it if this month is meant to be different.');
  }
  if (bill.dropInEnabled && !parseDropInDates(bill.dropInDates).length) w.push('Drop-in days are switched on but no dates are listed.');
  if (!bill.paymentMethod) w.push('No payment method.');
  return w;
}

// ---------- database rows <-> bills / children ----------
// [bill field, column, kind]  kinds: t text, n number, b boolean, d date, da date list, ts timestamp
export const BILL_COLUMNS = [
  ['billingMode', 'billing_mode', 't'], ['monthlyRate', 'monthly_rate', 'n'], ['dailyRate', 'daily_rate', 'n'], ['daysOfAttendance', 'days_of_attendance', 'n'],
  ['subsidy1DailyRate', 'subsidy1_daily_rate', 'n'], ['daysSubsidized', 'days_subsidized', 'n'], ['subsidy2Amount', 'subsidy2_amount', 'n'],
  ['credits', 'credits', 'n'], ['creditsEnabled', 'credits_enabled', 'b'], ['creditsNote', 'credits_note', 't'],
  ['dropInEnabled', 'drop_in_enabled', 'b'], ['dropInDates', 'drop_in_dates', 'da'], ['dropInRate', 'drop_in_rate', 'n'],
  ['addedFees', 'added_fees', 'n'], ['addedFeesEnabled', 'added_fees_enabled', 'b'], ['addedFeesNote', 'added_fees_note', 't'],
  ['resupplyFeeAmount', 'resupply_fee_amount', 'n'], ['resupplyFeeNote', 'resupply_fee_note', 't'],
  ['paymentMethod', 'payment_method', 't'], ['recurringPayment', 'recurring_payment', 'b'], ['creditCardFeeEnabled', 'credit_card_fee_enabled', 'b'],
  ['siblingDiscountEnabled', 'sibling_discount_enabled', 'b'], ['billingStatus', 'billing_status', 't'], ['notes', 'notes', 't'],
  ['totalSubsidy', 'total_subsidy', 'n'], ['billForFamilies', 'bill_for_families', 'n'], ['monthlyRevenue', 'monthly_revenue', 'n'],
  ['creditCardFee', 'credit_card_fee', 'n'], ['siblingDiscount', 'sibling_discount', 'n'], ['resupplyFee', 'resupply_fee', 'n'], ['withdrawalStatus', 'withdrawal_status', 't'],
  ['invoiced', 'invoiced', 'b'], ['invoicedAt', 'invoiced_at', 'ts'],
];
export function billFromRow(row) {
  const b = { id: row.id, childId: row.profile_id, monthKey: row.month_key, rosterSnapshot: row.roster_snapshot || null, updatedAt: row.updated_at };
  BILL_COLUMNS.forEach(([f, c, k]) => {
    const v = row[c];
    b[f] = k === 'n' ? Number(v) || 0 : k === 'b' ? !!v : k === 'da' ? (v || []).map(x => String(x).slice(0, 10)) : k === 'ts' ? (v || null) : (v ?? '');
  });
  b.dropInDays = parseDropInDates(b.dropInDates).length;
  return b;
}
export function billToRow(bill) {
  const row = { profile_id: bill.childId, month_key: bill.monthKey, roster_snapshot: bill.rosterSnapshot || null };
  BILL_COLUMNS.forEach(([f, c, k]) => {
    const v = bill[f];
    row[c] = k === 'n' ? (Number.isFinite(Number(v)) ? Number(v) : 0) : k === 'b' ? !!v : k === 'da' ? parseDropInDates(v) : k === 'ts' ? (v || null) : String(v ?? '');
  });
  return row;
}
// the database's child details as HQ-shaped child fields
export function childFromProfile(p, family) {
  return {
    id: p.id, childFirst: p.child_first || '', childLast: p.child_last || '', dob: p.dob ? String(p.dob).slice(0, 10) : '', room: p.room || '', daysPerWeek: p.program || '',
    parentFirst: family ? family.parent_first : '', parentLast: family ? family.parent_last : '', startDate: p.start_date ? String(p.start_date).slice(0, 10) : '',
    status: p.status === 'on_hold' ? 'On Hold' : p.status === 'archived' ? 'Archived' : 'Active', financialAid: !!p.financial_aid,
    subsidy1Org: p.subsidy1_org || '', subsidy2Org: p.subsidy2_org || '', materialsFeeKickIn: p.resupply_date ? String(p.resupply_date).slice(0, 10) : '', notes: p.notes || '',
    dailyRate: p.daily_rate == null ? '' : Number(p.daily_rate), monthlyRate: p.monthly_rate == null ? '' : Number(p.monthly_rate), paymentMethod: p.payment_method || '',
    dayCountRule: !!p.day_count_custom, customDays: p.custom_days || [], customDaysExcludeClosures: !!p.custom_days_exclude_closures,
    subsidy1DailyRate: p.subsidy1_daily_rate == null ? 0 : Number(p.subsidy1_daily_rate), cccapCounty: p.cccap_county || '', cccapParentFee: p.cccap_parent_fee == null ? 0 : Number(p.cccap_parent_fee),
    cccapExpirationDate: p.cccap_expiration ? String(p.cccap_expiration).slice(0, 10) : '', upkTier: p.upk_tier || '',
    emergencyFundingAmount: p.emergency_amount == null ? 0 : Number(p.emergency_amount), emergencyFundingSource: p.emergency_source || '',
    emergencyFundingExpires: p.emergency_expires ? String(p.emergency_expires).slice(0, 10) : '', resupplyFeeExempt: !!p.resupply_exempt,
    scheduledWithdrawalDate: p.scheduled_withdrawal ? String(p.scheduled_withdrawal).slice(0, 10) : '', lastInvoiceDate: p.last_invoice_date ? String(p.last_invoice_date).slice(0, 10) : '',
    enrollmentType: p.enrollment_type || '', kidsFirstCustomDays: p.kids_first_days || [],
  };
}

// ---------- comparing with Ajax Cubs HQ (step 5e) ----------
// The compare screen takes the rows of HQ's BillingRecords tab (pasted, or a downloaded .csv), works out which platform bill each belongs
// to, and lists every difference. HQ reads that tab by column POSITION (its header row is out of date), so this does the same.
export const HQ_BILL_COLUMNS = ['id', 'monthKey', 'childId', 'billingMode', 'monthlyRate', 'dailyRate', 'daysOfAttendance', 'subsidy1DailyRate', 'daysSubsidized', 'subsidy2Amount',
  'credits', 'dropInDays', 'dropInRate', 'addedFees', 'adjustment', 'adjustmentNote', 'needsAdjustment', 'recurringPayment', 'paymentMethod', 'readyToInvoice', 'invoiced', 'invoicedAt',
  'notes', 'totalSubsidy', 'billForFamilies', 'monthlyRevenue', 'updatedAt', 'creditCardFee', 'creditCardFeeEnabled', 'siblingDiscount', 'siblingDiscountEnabled', 'dropInEnabled',
  'dropInDates', 'addedFeesEnabled', 'billingStatus', 'adjustmentEnabled', 'creditsNote', 'creditsEnabled', 'addedFeesNote', 'resupplyFeeAmount', 'resupplyFeeNote', 'resupplyFee',
  'withdrawalStatus', 'rosterSnapshot'];
const HQ_NUMBERS = ['monthlyRate', 'dailyRate', 'daysOfAttendance', 'subsidy1DailyRate', 'daysSubsidized', 'subsidy2Amount', 'credits', 'dropInDays', 'dropInRate', 'addedFees', 'adjustment',
  'totalSubsidy', 'billForFamilies', 'monthlyRevenue', 'creditCardFee', 'siblingDiscount', 'resupplyFeeAmount', 'resupplyFee'];
const HQ_FLAGS = ['recurringPayment', 'readyToInvoice', 'invoiced', 'creditCardFeeEnabled', 'siblingDiscountEnabled', 'dropInEnabled', 'addedFeesEnabled', 'adjustmentEnabled', 'creditsEnabled'];

// text copied from a Google Sheet (tabs) or a .csv (commas, quotes allowed) -> rows of cells
export function parseDelimited(text) {
  let s = String(text ?? '').replace(/^﻿/, '');
  const head = s.slice(0, 4000), delim = head.indexOf('\t') >= 0 ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { endCell(); if (row.some(c => String(c).trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) endCell();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { /* the \n that follows ends the row */ }
    else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

// 'YYYY-MM-DD', 'M/D/YYYY', 'Sep 2026' or 'September 2026' -> 'YYYY-MM', or ''
export function normalizeMonthKey(v) {
  const t = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?/.exec(t);
  if (m && +m[2] >= 1 && +m[2] <= 12) return m[1] + '-' + String(+m[2]).padStart(2, '0');
  const d = normalizeDate(t);
  if (d) return d.slice(0, 7);
  m = /^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(t);
  if (m) {
    const i = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].slice(0, 3).toLowerCase());
    if (i >= 0) return m[2] + '-' + String(i + 1).padStart(2, '0');
  }
  return '';
}
// '$1,198.31', '(12.00)', '-5', '' (is 0) -> number. A sheet cell that was formatted as a date shows a number as a date in 1899/1900: back to the number.
export function parseMoney(v) {
  if (typeof v === 'number') return v;
  let t = String(v ?? '').trim();
  if (!t) return 0;
  const d = normalizeDate(t);
  if (d && +d.slice(0, 4) <= 1900) return Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000);
  const neg = /^\(.*\)$/.test(t) || /^-/.test(t) || /^\$-/.test(t);
  t = t.replace(/[()$,\s-]/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}
const isFlag = v => v === true || /^(true|yes|y|1|x|✓)$/i.test(String(v ?? '').trim());

// the pasted BillingRecords rows -> HQ bills ({ ...HQ field names, monthKey 'YYYY-MM', numbers as numbers, snapshot }), the months found, and how many rows were not bills
export function parseHqBills(text) {
  const bills = [], months = new Set(); let ignored = 0;
  parseDelimited(text).forEach(r => {
    const mk = normalizeMonthKey(r[1]);
    if (!mk || !String(r[2] ?? '').trim()) { ignored++; return; }                        // the header row, or a stray line
    const b = {};
    HQ_BILL_COLUMNS.forEach((k, i) => {
      const v = r[i] === undefined ? '' : r[i];
      b[k] = HQ_NUMBERS.includes(k) ? parseMoney(v) : HQ_FLAGS.includes(k) ? isFlag(v) : String(v).trim();
    });
    b.monthKey = mk; b.id = String(b.id); b.childId = String(b.childId);
    b.dropInDates = parseDropInDates(b.dropInDates);
    b.snapshot = null;
    if (b.rosterSnapshot) { try { b.snapshot = JSON.parse(b.rosterSnapshot); } catch (e) { b.snapshot = null; } }
    bills.push(b); months.add(mk);
  });
  return { bills, months: [...months].sort(), ignored };
}

const TOTAL_FIELDS = [['billForFamilies', 'Bill for Families'], ['totalSubsidy', 'Total subsidy'], ['monthlyRevenue', 'Monthly revenue']];
const MORE_FIELDS = [['creditCardFee', 'Credit card fee'], ['siblingDiscount', 'Sibling discount'], ['resupplyFee', 'Resupply fee']];
const ENTRY_FIELDS = [['billingMode', 'Billing', 's'], ['monthlyRate', 'Monthly rate', 'n'], ['dailyRate', 'Daily rate', 'n'], ['daysOfAttendance', 'Days attended', 'n'],
  ['subsidy1DailyRate', 'Funding daily rate', 'n'], ['daysSubsidized', 'Days subsidized', 'n'], ['subsidy2Amount', 'UPK / emergency funding', 'n'], ['creditsEff', 'Credits', 'n'],
  ['addedFeesEff', 'Added fees', 'n'], ['dropInDaysEff', 'Drop-in days', 'n'], ['dropInRate', 'Drop-in rate', 'n'], ['resupplyFeeAmount', 'Resupply fee entered', 'n'],
  ['paymentMethod', 'Payment method', 's'], ['creditCardFeeEnabled', 'Card fee switched on', 'b'], ['siblingDiscountEnabled', 'Sibling discount switched on', 'b']];
const near = (a, b) => Math.abs(num(a) - num(b)) < 0.004;
// what counts: a switched-off credit, fee or drop-in day has no effect on the bill, so it is not a difference
const effective = b => ({ ...b, creditsEff: b.creditsEnabled ? num(b.credits) : 0, addedFeesEff: b.addedFeesEnabled ? num(b.addedFees) : 0, dropInDaysEff: b.dropInEnabled ? parseDropInDates(b.dropInDates).length : 0 });

// hqBills = parseHqBills(...).bills for one month; people = [{ profileId, hqId, name, child }] (child = the HQ-shaped child details);
// platformBills = the platform's bills for the month, as billFromRow gives them (an open one should already be worked out with today's rules).
// Result: one row per child, kind 'same' | 'different' | 'onlyHq' | 'onlyPlatform' | 'unknown', with the differences and a plain-language cause.
export function compareWithHq(ctx, monthKey, hqBills, people, platformBills) {
  const byHq = {}, byProfile = {};
  people.forEach(p => { if (p.hqId) byHq[String(p.hqId)] = p; byProfile[p.profileId] = p; });
  const platByProfile = {}; platformBills.forEach(b => { platByProfile[b.childId] = b; });
  const rows = [], seen = new Set();
  const hqByChild = {}; hqBills.filter(b => b.monthKey === monthKey).forEach(b => { hqByChild[b.childId] = b; });   // one bill per child and month: the last one pasted
  Object.values(hqByChild).forEach(hq => {
    const person = byHq[hq.childId];
    if (!person) {
      const snap = hq.snapshot, nm = snap && snap.childFirst ? (snap.childFirst + ' ' + snap.childLast).trim() : '';
      rows.push({ kind: 'unknown', name: nm || '(a child not in the platform)', hqId: hq.childId, hq, plat: null, diffs: [], entryDiffs: [], cause: 'HQ has a bill for a child the platform does not know (HQ id ' + hq.childId + '). Add or match the child first.' });
      return;
    }
    seen.add(person.profileId);
    const plat = platByProfile[person.profileId];
    if (!plat) { rows.push({ kind: 'onlyHq', name: person.name, hqId: hq.childId, hq, plat: null, diffs: [], entryDiffs: [], cause: 'HQ has a bill for ' + person.name + ' and the platform does not yet. Start the month there (Monthly billing) or check the child is active.' }); return; }
    rows.push(compareOne(ctx, monthKey, hq, plat, person));
  });
  platformBills.forEach(b => {
    if (seen.has(b.childId)) return;
    const person = byProfile[b.childId];
    rows.push({ kind: 'onlyPlatform', name: person ? person.name : '(unknown child)', hqId: person ? person.hqId : '', hq: null, plat: b, diffs: [], entryDiffs: [], cause: 'The platform has a bill for ' + (person ? person.name : 'this child') + ' and the pasted HQ rows do not. Paste that child\'s row too, or check whether HQ made one.' });
  });
  const order = { different: 0, unknown: 1, onlyHq: 2, onlyPlatform: 3, same: 4 };
  rows.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
  const sum = (list, k) => round2(list.reduce((t, x) => t + num(x[k]), 0));
  const hqAll = Object.values(hqByChild);
  const counts = { same: 0, different: 0, onlyHq: 0, onlyPlatform: 0, unknown: 0 }; rows.forEach(r => { counts[r.kind]++; });
  return {
    monthKey, rows, counts,
    hqTotals: { billForFamilies: sum(hqAll, 'billForFamilies'), totalSubsidy: sum(hqAll, 'totalSubsidy'), monthlyRevenue: sum(hqAll, 'monthlyRevenue') },
    platformTotals: { billForFamilies: sum(platformBills, 'billForFamilies'), totalSubsidy: sum(platformBills, 'totalSubsidy'), monthlyRevenue: sum(platformBills, 'monthlyRevenue') },
  };
}

function compareOne(ctx, monthKey, hq, plat, person) {
  const diffs = [];
  TOTAL_FIELDS.concat(MORE_FIELDS).forEach(([k, label], i) => {
    if (!near(hq[k], plat[k])) diffs.push({ field: k, label, hq: num(hq[k]), plat: num(plat[k]), main: i < TOTAL_FIELDS.length });
  });
  const hqWs = hq.withdrawalStatus || '', pWs = plat.withdrawalStatus || '';
  if (hqWs !== pWs) diffs.push({ field: 'withdrawalStatus', label: 'Withdrawal', hq: hqWs || 'enrolled', plat: pWs || 'enrolled', main: false, text: true });
  const he = effective(hq), pe = effective(plat), entryDiffs = [];
  ENTRY_FIELDS.forEach(([k, label, kind]) => {
    const a = he[k], b = pe[k];
    const same = kind === 'n' ? near(a, b) : kind === 'b' ? !!a === !!b : String(a ?? '').trim() === String(b ?? '').trim();
    if (!same) entryDiffs.push({ field: k, label, hq: kind === 'n' ? num(a) : kind === 'b' ? (a ? 'yes' : 'no') : String(a ?? ''), plat: kind === 'n' ? num(b) : kind === 'b' ? (b ? 'yes' : 'no') : String(b ?? ''), money: kind === 'n' && !/Days|days/.test(label) });
  });
  const mainDiff = diffs.some(d => d.main);
  // Does the platform's arithmetic, given HQ's own entries, give HQ's own totals? (An open bill is first brought up to date the way HQ does it.)
  const child = person.child || {};
  const hqBill = { ...hq, monthKey };
  let rules;
  if (hq.invoiced) rules = computeTotals(hqBill, ctx.settings, { ...(hq.snapshot || child), ...hqBill });
  else rules = refreshOpenBill(ctx, child, hqBill);
  const rulesAgree = TOTAL_FIELDS.every(([k]) => near(rules[k], hq[k]));
  let cause = '';
  if (mainDiff) {
    if (rulesAgree) cause = 'The platform\'s rules give HQ\'s total from HQ\'s entries, so the two bills were filled in differently. Compare the entries below.';
    else cause = 'Even with HQ\'s own entries the platform works out ' + fmt(rules.billForFamilies) + ', not HQ\'s ' + fmt(hq.billForFamilies) + (hq.invoiced ? ' (HQ invoiced this one)' : '') + '. That is a difference in the rules, or in the child\'s details, and needs a look.';
  }
  return {
    kind: mainDiff ? 'different' : 'same', name: person.name, hqId: hq.childId, hq, plat, diffs, entryDiffs, cause,
    rules: { billForFamilies: rules.billForFamilies, totalSubsidy: rules.totalSubsidy, monthlyRevenue: rules.monthlyRevenue, agrees: rulesAgree },
    invoicedNote: hq.invoiced !== !!plat.invoiced ? (hq.invoiced ? 'HQ has this one Invoiced; the platform does not.' : 'The platform has this one Invoiced; HQ does not.') : '',
  };
}
function fmt(n) { return (n < 0 ? '-$' : '$') + Math.abs(num(n)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
