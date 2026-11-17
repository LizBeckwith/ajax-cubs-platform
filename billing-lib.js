// BUILT from tools/billing-lib/ by tools/build-tracker.mjs: edit the pieces there, not this file.
// ===== BILLING-LIB · billing-lib-01 · settings, dates and months, rates and funding, worked-out values =====
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
  upkCap10hrs: 5020.68, upkCap15hrs: 6330.43, upkCap30hrs: 11241.97, upkCapSchoolYear: 2025, coloradoShinesLevel: 4, schoolYearWeeks: 36, upkHoursPerDay: 9.25,
  upkBillingMonths: 9,       // the UPK daily rates are not settings: they are the Daily column of Tuition Rates (section 19)
  // section 18 (Liz, 2026-11-02): amounts the rules use. The staff child discount is a flat amount; the late pickup fees are from the signed agreement
  // (1st / 2nd / 3rd occurrence in the school year: a charge plus so much a minute late, closing at 5:15 pm = minute 1035; no call before 4:15 pm: first / after; police).
  staffDiscountAmount: 7, registrationFee: 0, latePaymentFee: 0,
  latePickup1Base: 10, latePickup1PerMinute: 1, latePickup2Base: 20, latePickup2PerMinute: 2, latePickup3Base: 50, latePickup3PerMinute: 3,
  noCallFirst: 15, noCallAfter: 50, policeFee: 100, closingMinute: 1035,
};
export const PROGRAMS = ['5-Day', '4-Day', '3-Day', '2-Day', 'Drop-in'];
export const BILLING_MODES = ['School Year', 'Summer/Drop-in'];
export const BILLING_STATUSES = ['Not Started', 'Needs Adjustment', 'Ready'];
// Procare is the only billing system: no card or bank numbers anywhere, only how the family pays. Unknown can be invoiced; the next bill asks again.
export const PAYMENT_METHODS = ['Credit Card', 'Debit Card', 'ACH/Bank', 'Unknown'];     // only Credit Card adds the card fee

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
// The plan a county's rates come from for a month: the newest one that started on or before the 1st (the earliest one if the month is before them all).
// Colorado Shines level 4 and 5 both use the plan's Tier 4-5 column; a lower level uses its own rows when there are any.
export function cccapPlanFor(ctx, county, monthKey) {
  const rows = ctx.plans && ctx.plans[county];
  if (!rows || !rows.length) return null;
  const level = num(ctx.settings && ctx.settings.coloradoShinesLevel) || 4, tier = level >= 4 ? 4 : level;
  const mine = rows.filter(p => p.tier === tier), use = mine.length ? mine : rows;
  const first = monthKey + '-01';
  return use.find(p => p.starts <= first) || use[use.length - 1];
}
export function cccapRateFor(ctx, county, dob, monthKey) {
  if (!county || !dob) return 0;
  const plan = cccapPlanFor(ctx, county, monthKey);
  if (plan) return num(plan[cccapCategoryFor(ageInMonthsAsOf(dob, monthKey + '-01'), ctx.settings)]);
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

// ---------- worked out, not typed (platform plan section 19) ----------
// Liz types only each schedule's Daily rate and the 5-Day Average. Everything else is worked out here, live:
//   Average for 4-, 3- and 2-Day = the 5-Day Average x days a week / 5, rounded up;  Monthly = Daily x Average.
// With no 5-Day Average to work from (an older database, a test), the stored Monthly and days are used as they are.
export const SCHEDULE_DAYS = { '5-Day': 5, '4-Day': 4, '3-Day': 3, '2-Day': 2 };
export function workedOutRates(cards) {
  const by = {}; (cards || []).forEach(c => { by[c.program] = c; });
  const avg5 = num(by['5-Day'] && by['5-Day'].default_days);
  if (avg5 <= 0) return null;
  const out = {};
  Object.keys(by).forEach(p => {
    const daily = num(by[p].daily_rate), days = SCHEDULE_DAYS[p];
    if (!days) { out[p] = { program: p, daily, average: 0, monthly: 0, workedOut: false }; return; }
    const average = p === '5-Day' ? avg5 : Math.ceil(avg5 * days / 5 - 1e-9);
    out[p] = { program: p, daily, average, monthly: round2(daily * average), workedOut: p !== '5-Day' };
  });
  return out;
}
// A UPK amount a month = hours a week / hours a day x school-year weeks x the schedule's Daily rate / billing months (HQ's UPK Calculator).
export const upkHours = tier => num(((String(tier || '').match(/(\d+)\s*hrs/)) || [])[1]);
export function upkMonthlyAmount(settings, daily, hours) {
  const hpd = num(settings && settings.upkHoursPerDay), weeks = num(settings && settings.schoolYearWeeks), months = num(settings && settings.upkBillingMonths);
  const amount = (hpd > 0 && months > 0 && num(daily) > 0 && num(hours) > 0) ? round2(num(hours) / hpd * weeks * num(daily) / months) : 0;
  const share = upkCapShare(settings, hours);
  return (share > 0 && amount > share) ? share : amount;       // the state pays at most the yearly cap for a child, so a month never credits more than the cap's share
}
// A month's share of the state's yearly cap for this many hours a week (rounded down to the cent so nine months never pass the cap); 0 = no cap known.
export function upkCapShare(settings, hours) {
  const cap = num(settings && settings['upkCap' + num(hours) + 'hrs']), months = num(settings && settings.upkBillingMonths);
  return (cap > 0 && months > 0) ? Math.floor(cap / months * 100 + 1e-9) / 100 : 0;
}
// Every title on Family bills goes through the site's one Title Case helper (site/time-lib.js, style pass step 5: AM / PM now capitals).
export { titleCase } from './time-lib.js';

// the rates and tables in one lookup-friendly object. rates = the platform's billingRates() answer (database rows).
export function makeContext(rates) {
  const r = rates || {};
  const settings = { ...SETTINGS_DEFAULTS };
  (r.settings || []).forEach(s => { const n = Number(s.value); if (Number.isFinite(n)) settings[s.key] = n; });
  const rateCards = {};
  const worked = workedOutRates(r.rateCards);
  (r.rateCards || []).forEach(c => { const w = worked && worked[c.program]; rateCards[c.program] = w ? { category: c.program, semesterMonthlyRate: w.monthly, summerDailyRate: w.daily, defaultDaysOfAttendance: w.average } : { category: c.program, semesterMonthlyRate: num(c.monthly_rate), summerDailyRate: num(c.daily_rate), defaultDaysOfAttendance: num(c.default_days) }; });
  const cccap = {};
  (r.cccap || []).forEach(c => { cccap[c.county] = { infant: num(c.infant_rate), toddler: num(c.toddler_rate), preschool: num(c.preschool_rate), schoolAge: num(c.school_age_rate) }; });
  // the rules list (section 18): { key: { enabled, months } }; a rule that is not in the list runs (so an older database still works)
  const rules = {};
  (r.rules || []).forEach(x => { rules[x.key] = { enabled: x.enabled !== false, months: x.months || null }; });
  // UPK3 and UPK4 use the same rates (Liz, 2026-11-03): a UPK3 cell is offered exactly when the UPK4 cell is
  const upk4 = {}; (r.upk || []).forEach(u => { if (u.org === 'UPK4') upk4[u.tier + '|' + u.program] = u.offered; });
  const offeredOf = u => (u.org === 'UPK3' && upk4[u.tier + '|' + u.program] !== undefined) ? upk4[u.tier + '|' + u.program] : u.offered;
  // section 19 items 19-20 (migration 042): each county's rates by the date its plan starts, and what each county pays. Without them (an older database) the rates in cccap are used.
  const plans = {};
  (r.cccapPlans || []).forEach(p => { (plans[p.county] = plans[p.county] || []).push({ county: p.county, rateType: p.rate_type || 'Regular', starts: String(p.starts).slice(0, 10), tier: num(p.tier) || 4, planUrl: p.plan_url || '',
    infant: num(p.infant_rate), toddler: num(p.toddler_rate), preschool: num(p.preschool_rate), schoolAge: num(p.school_age_rate) }); });
  Object.keys(plans).forEach(k => plans[k].sort((a, b) => (a.starts < b.starts ? 1 : a.starts > b.starts ? -1 : 0)));        // newest first
  const terms = r.cccapTerms ? {} : null;
  (r.cccapTerms || []).forEach(t => { terms[t.county] = { county: t.county, absences: num(t.absences_per_month), holidays: t.paid_holidays || [], dropIn: t.drop_in_per_month == null ? null : num(t.drop_in_per_month),
    holdSlots: t.hold_slots == null ? null : num(t.hold_slots), registrationFee: t.registration_fee_year == null ? null : num(t.registration_fee_year), activityFee: t.activity_fee_year == null ? null : num(t.activity_fee_year),
    transportation: !!t.transportation, agreementEnds: t.agreement_ends ? String(t.agreement_ends).slice(0, 10) : '' }; });
  return { settings, rateCards, cccap, plans, terms, rules, upk: (r.upk || []).map(u0 => { const u = { ...u0, offered: offeredOf(u0) }; return {  org: u.org, tier: u.tier, program: u.program, offered: u.offered === undefined ? undefined : !!u.offered,
    // worked out from the UPK calculator and the schedule's Daily rate; an older database (no offered flag) keeps its typed amounts
    amount: u.offered === undefined ? num(u.amount) : (u.offered ? upkMonthlyAmount(settings, rateCards[u.program] && rateCards[u.program].summerDailyRate, upkHours(u.tier)) : 0) }; }), closures: (r.closures || []).map(c => String(c).slice(0, 10)) };
}
// a CCCAP child in a county that pays a registration fee (Pitkin, Eagle): the county is asked for it (Home task, migration 043) instead of the family being billed
// the Registration fee is charged to a new child only when Liz chose to ('charge'); '' = not decided yet, 'waive' = not charged. A child without the field (before migration 050) is charged, as before.
export const registrationCharged = child => !!child && (child.registrationChoice === undefined || child.registrationChoice === 'charge');
export const countyPaysRegistration = (ctx, child) => !!(child && child.subsidy1Org === 'CCCAP' && child.cccapCounty && ctx.terms && ctx.terms[child.cccapCounty] && num(ctx.terms[child.cccapCounty].registrationFee) > 0);
export const ruleOn = (ctx, key) => !ctx.rules || !ctx.rules[key] || ctx.rules[key].enabled !== false;
export function rateCardFor(ctx, program) {
  return ctx.rateCards[program] || { category: program, semesterMonthlyRate: 0, summerDailyRate: 0, defaultDaysOfAttendance: 0 };
}

// ===== BILLING-LIB · billing-lib-02 · semester, resupply, withdrawal, counting days, CCCAP-paid days, the bill =====
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
// ---------- CCCAP-paid days (section 19 items 19-20) ----------
// The ten holidays a county may pay for (the keys are what billing_cccap_terms.paid_holidays holds).
export const CCCAP_HOLIDAYS = [['new_years', 'New Year\'s Day'], ['mlk', 'Martin Luther King Jr. Day'], ['presidents', 'Presidents\' Day'], ['cabrini', 'Cabrini Day'], ['memorial', 'Memorial Day'],
  ['independence', 'Independence Day'], ['labor', 'Labor Day'], ['veterans', 'Veterans\' Day'], ['thanksgiving', 'Thanksgiving Day'], ['christmas', 'Christmas Day']];
// the date a holiday is observed in a year: a fixed date on a Saturday is the Friday before, on a Sunday the Monday after
export function cccapHolidayDate(key, year) {
  const nth = (m, dow, n) => {                                  // the nth weekday (1-4), or the last (-1), of month m
    if (n > 0) { const first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay(); return 1 + ((dow - first + 7) % 7) + (n - 1) * 7; }
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate(), ld = new Date(Date.UTC(year, m - 1, last)).getUTCDay(); return last - ((ld - dow + 7) % 7);
  };
  const FIXED = { new_years: [1, 1], independence: [7, 4], veterans: [11, 11], christmas: [12, 25] };
  let m, d;
  if (FIXED[key]) {
    [m, d] = FIXED[key];
    const dow = new Date(Date.UTC(year, m - 1, d)).getUTCDay();
    if (dow === 6) d -= 1; else if (dow === 0) d += 1;
    return new Date(Date.UTC(year, m - 1, d)).toISOString().slice(0, 10);
  }
  const RULE = { mlk: [1, 1, 3], presidents: [2, 1, 3], cabrini: [10, 1, 1], memorial: [5, 1, -1], labor: [9, 1, 1], thanksgiving: [11, 4, 4] };
  if (!RULE[key]) return '';
  const [mm, dw, n] = RULE[key];
  return isoDate(year, mm, nth(mm, dw, n));
}
// the county's paid holidays that fall in a month: [{ key, name, date }]
export function cccapHolidaysInMonth(keys, monthKey) {
  const y = Number(monthKey.slice(0, 4)), out = [];
  CCCAP_HOLIDAYS.forEach(([key, name]) => {
    if (!(keys || []).includes(key)) return;
    [y - 1, y, y + 1].forEach(yy => { const date = cccapHolidayDate(key, yy); if (date && date.slice(0, 7) === monthKey && !out.some(o => o.key === key && o.date === date)) out.push({ key, name, date }); });
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
// Days CCCAP pays for in a month: days attended + absences (up to the county's monthly limit) + the county's paid holidays that Ajax is closed for on a day the child is
// scheduled (an open holiday is a day attended or an absence already), never more than the days authorized on the child's schedule calendar (their scheduled weekdays when there is none).
// null when this is not a CCCAP child or the county's terms are not there (an older database): then days attended are used.
export function cccapPaidDays(ctx, child, monthKey, attended, absences) {
  if (!child || child.subsidy1Org !== 'CCCAP' || !ctx.terms) return null;
  const t = ctx.terms[child.cccapCounty]; if (!t) return null;
  const useCustom = child.dayCountRule === true || child.dayCountRule === 'Custom';
  const pattern = useCustom ? daysList(child.customDays) : programDayPattern(child.daysPerWeek);
  const closed = new Set((ctx.closures || []).map(c => String(c).slice(0, 10)));
  const att = num(attended), absPaid = Math.min(Math.max(0, Math.floor(num(absences))), num(t.absences));
  const hol = cccapHolidaysInMonth(t.holidays, monthKey).filter(h => closed.has(h.date) && pattern.includes(new Date(h.date + 'T00:00:00Z').getUTCDay()));
  const scheduled = pattern.length ? countPatternDaysInMonth(monthKey, pattern, ctx.closures, false) : null;
  const given = child.cccapDays && child.cccapDays[monthKey] != null && child.cccapDays[monthKey] !== '' ? num(child.cccapDays[monthKey]) : null;
  const authorized = given != null ? given : scheduled;
  const raw = att + absPaid + hol.length, days = authorized != null ? Math.min(raw, authorized) : raw;
  const parts = [att + ' attended'];
  if (absPaid) parts.push(absPaid + (absPaid === 1 ? ' absence' : ' absences'));
  hol.forEach(h => parts.push(h.name));
  const note = parts.join(' + ') + (authorized != null && raw > authorized ? ' (held at the ' + authorized + ' days authorized)' : '');
  return { days, note, attended: att, absences: absPaid, holidays: hol.map(h => h.name), authorized, authorizedFromAuthorization: given != null };
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
    // days CCCAP pays for = attended + allowed absences + the county's paid holidays, never more than the days authorized (cccapPaidDays); bills without it (Invoiced, older) count days attended
    const paidDays = (rec.cccapPaidDays === null || rec.cccapPaidDays === undefined || rec.cccapPaidDays === '') ? num(rec.daysOfAttendance) : num(rec.cccapPaidDays);
    baseCharge = round2(num(rec.subsidy1DailyRate) * paidDays);
    subsidy1Total = round2(baseCharge - num(child.cccapParentFee));
  } else {
    baseCharge = useDailyRate ? num(rec.dailyRate) * num(rec.daysOfAttendance) : num(rec.monthlyRate);
    subsidy1Total = round2(num(rec.subsidy1DailyRate) * num(rec.daysSubsidized));
  }
  const totalSubsidy = round2(subsidy1Total + num(rec.subsidy2Amount));
  const dropInDayCount = rec.dropInEnabled ? parseDropInDates(rec.dropInDates).length : 0;
  const dropInCharge = dropInDayCount * num(rec.dropInRate);
  // what the rules added (late pickup, late payment, registration: rec.ruleCharges) is billed like an added fee
  const addedFeesCharge = (rec.addedFeesEnabled ? num(rec.addedFees) : 0) + num(rec.ruleCharges);
  const creditsCharge = rec.creditsEnabled ? num(rec.credits) : 0;
  const resupplyFee = (child && child.resupplyFeeExempt) ? 0 : num(rec.resupplyFeeAmount);
  const subtotal = round2(baseCharge - totalSubsidy + dropInCharge + addedFeesCharge + resupplyFee - creditsCharge);
  const siblingRate = ((settings && settings.siblingDiscountRate) || 0) / 100;
  // the sibling and staff child discounts never combine: with both on, neither is taken (the bill says so)
  const bothDiscounts = !!(rec.siblingDiscountEnabled && rec.staffDiscountEnabled);
  const siblingDiscount = (rec.siblingDiscountEnabled && !bothDiscounts) ? round2(subtotal * siblingRate) : 0;
  const staffAmount = num(rec.staffDiscountAmount) > 0 ? num(rec.staffDiscountAmount) : num(settings && settings.staffDiscountAmount);       // the tag's own amount (migration 059), else the Rates and Settings one
  const staffDiscount = (rec.staffDiscountEnabled && !bothDiscounts) ? round2(Math.min(staffAmount, Math.max(subtotal, 0))) : 0;
  const afterDiscount = round2(subtotal - siblingDiscount - staffDiscount);
  const feeRate = ((settings && settings.creditCardFeeRate) || 0) / 100;
  // the card fee follows how the family pays: Credit Card always adds it, anything else never (there is no tick box; the Card fee rule can be switched off)
  const creditCardFee = (rec.paymentMethod === 'Credit Card' && !rec.cardFeeOff) ? round2(afterDiscount * feeRate) : 0;
  const billForFamilies = round2(afterDiscount + creditCardFee);
  const monthlyRevenue = round2(totalSubsidy + billForFamilies);
  return { totalSubsidy, subsidy1Total, billForFamilies, monthlyRevenue, creditCardFee, siblingDiscount, staffDiscount, dropInDays: dropInDayCount, resupplyFee, withdrawalStatus, bothDiscounts };
}

// ===== BILLING-LIB · billing-lib-03 · tags and rules, the new-child set-up, late pickup fees, credit and fee lines =====
// ---------- tags and rules (platform plan section 18) ----------
// A tag as the page hands it over: { rule, name, scope: 'month' | 'every' | 'until', monthKey, untilDate, color, derived }.
// 'month' tags apply to one month; 'every' tags stay until they are removed; 'until' tags stay through the month the date falls in
// (except Resupply fee starts on, whose date is the day the fee starts, so the tag blocks the fee in every month that begins before it).
export const TAG_NAMES = { aged_up: 'Aged up', cccap_expiring: 'CCCAP expiring', schedule_change: 'Schedule change', new_child: 'New child', asks_credit: 'Prorated', drop_in_last_month: 'Drop-in Last Month' };
export function tagInEffect(t, monthKey) {
  if (t.scope === 'month') return t.monthKey === monthKey;
  if (t.scope === 'until' && t.untilDate) {
    const d = normalizeDate(t.untilDate);
    if (!d) return true;
    return t.rule === 'resupply_starts' ? d > monthKey + '-01' : monthKey <= d.slice(0, 7);
  }
  return true;
}
export const tagsInEffect = (tags, monthKey) => (tags || []).filter(t => tagInEffect(t, monthKey));
export function addDaysIso(dateText, n) {
  const d = normalizeDate(dateText); if (!d) return null;
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
export function shortDate(dateText) {
  const d = normalizeDate(dateText); if (!d) return String(dateText || '');
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+d.slice(5, 7) - 1] + ' ' + (+d.slice(8, 10));
}
// A start date inside the month (not the 1st): the school days before it, first school day of the month to the school day before the start. Closed days and weekends are not school days.
export function prorateRange(ctx, child, monthKey) {
  const start = normalizeDate(child && child.startDate);
  if (!start || start.slice(0, 7) !== monthKey || start.slice(8, 10) === '01') return null;
  const closed = new Set(((ctx && ctx.closures) || []).map(c => String(c).slice(0, 10)));
  let from = null, to = null;
  for (let d = 1; d < +start.slice(8, 10); d++) {
    const iso = monthKey + '-' + String(d).padStart(2, '0'), wd = new Date(iso + 'T00:00:00Z').getUTCDay();
    if (wd >= 1 && wd <= 5 && !closed.has(iso)) { if (!from) from = iso; to = iso; }
  }
  return from ? { from, to, start } : null;
}
// "add the prorate credit for Nov 2–17" (blank when the start is not inside the month)
export function prorateNote(ctx, child, monthKey) {
  const r = prorateRange(ctx, child, monthKey); if (!r) return '';
  return 'add the prorate credit for ' + (r.from === r.to ? shortDate(r.from) : shortDate(r.from) + '–' + (+r.to.slice(8, 10)));
}
// ---- the new-child set-up (section 29 item 4, picture 53): six questions on the Roster card ----
// s = { done: ['days', 'resupply', 'aid', 'tags'], room, regChoice, regReady, hasAid }; classroom and the registration fee are read from the card itself,
// financial aid also counts as answered once a funding is chosen, tags once the child has one
export function setupProgress(s, tagCount) {
  if (!s) return null;
  const done = s.done || [];
  const answered = { classroom: !!String(s.room || '').trim(), days: done.includes('days'), resupply: done.includes('resupply'), aid: done.includes('aid') || !!s.hasAid,
    registration: !s.regReady || String(s.regChoice || '') !== '', tags: done.includes('tags') || num(tagCount) > 0 };
  const n = Object.values(answered).filter(Boolean).length;
  return { answered, n, total: 6, left: 6 - n, complete: n === 6 };
}
export function setupOf(p) {
  return p && p.setup_pending ? { done: Array.isArray(p.setup_done) ? p.setup_done : [], room: p.room, regChoice: p.registration_fee_choice, regReady: 'registration_fee_choice' in p,
    hasAid: !!(p.subsidy1_org || p.subsidy2_org), from: p.added_from || '', by: p.added_by_name || '', on: p.added_on ? String(p.added_on).slice(0, 10) : '' } : null;
}
// a Roster row (billing_profiles) that is still being set up: its progress, or null once every question is answered (or it never was new)
export function newChildSetup(p, tagCount) { const s = setupOf(p), sp = setupProgress(s, tagCount); return sp && !sp.complete ? Object.assign(sp, { info: s }) : null; }
// the schedule a bill for that month uses: a schedule change starts in the month its date falls in; earlier months keep the previous one
export function programForMonth(child, monthKey) {
  const from = normalizeDate(child.programFrom);
  if (child.previousProgram && from && monthKey < from.slice(0, 7)) return child.previousProgram;
  return child.daysPerWeek;
}
// tags nobody types in: the rules add them. ex = { today, isFirstBill, names: { rule: tag name } }
export function derivedTags(ctx, child, monthKey, ex) {
  const out = [], on = k => ruleOn(ctx, k), nm = r => ((ex && ex.names && ex.names[r]) || TAG_NAMES[r]);
  const mk = (rule, scope, color) => out.push({ rule, name: nm(rule), scope: scope || 'month', monthKey, color: color || 'blue', derived: true });
  if (on('aged_up') && child.subsidy1Org === 'CCCAP' && child.dob && child.cccapCounty) {
    const a = cccapCategoryFor(ageInMonthsAsOf(child.dob, monthKey + '-01'), ctx.settings), b = cccapCategoryFor(ageInMonthsAsOf(child.dob, addMonths(monthKey, -1) + '-01'), ctx.settings);
    if (a !== b) mk('aged_up');
  }
  if (on('cccap_expiring') && child.subsidy1Org === 'CCCAP' && child.cccapExpirationDate && ex && ex.today) {
    const e = normalizeDate(child.cccapExpirationDate);
    if (e && e <= addDaysIso(ex.today, 30)) mk('cccap_expiring', 'every');
  }
  if (on('drop_in_days') && ex && ex.dropInFromLast && (ex.dropInDates || []).length) mk('drop_in_last_month');          // last month's drop-in days are on this bill (section 26 item 2)
  const from = normalizeDate(child.programFrom);
  const changed = on('schedule_change') && child.previousProgram && from && from.slice(0, 7) === monthKey;
  if (changed) mk('schedule_change');
  const first = !!(child.newFamily && ex && ex.isFirstBill);
  if (first) mk('new_child');
  const start = normalizeDate(child.startDate);
  const midMonth = !!(ex && ex.isFirstBill) && on('mid_month_start') && start && start.slice(0, 7) === monthKey && start.slice(8, 10) !== '01';
  const heldPart = holdStateFor(child, monthKey) === 'partial';
  if (changed || midMonth || heldPart) mk('asks_credit', 'month', 'orange');
  return out;
}
// Financial Aid is a No / Yes field on the child (section 23 item 12); a funding always means Yes. hasFunding: a funding has been chosen.
export const hasFunding = child => !!(child && (child.subsidy1Org || child.subsidy2Org));
export function activeTags(ctx, child, monthKey, ex) {
  const stored = tagsInEffect(ex && ex.tags, monthKey), derived = derivedTags(ctx, child, monthKey, ex || {});
  const all = stored.concat(derived.filter(d => !stored.some(s => s.rule && s.rule === d.rule)));
  return { stored, derived, all, has: r => all.some(t => t.rule === r) };
}

// ---- late pickup fees (from the signed agreement) ----
export function schoolYearOf(dateText) { const d = normalizeDate(dateText); return d ? (+d.slice(5, 7) >= 9 ? +d.slice(0, 4) : +d.slice(0, 4) - 1) : null; }
function minuteOfDay(t) { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '').trim()); return m ? +m[1] * 60 + +m[2] : null; }
// picks = the child's late pick-ups from September to the end of the month ([{ id, date, time, noCall, police, waived }], any order). The nth in the school
// year pays the 1st / 2nd / 3rd-and-later charge plus so much a minute after closing; no call before 4:15 adds the first / later charge; police adds its fee.
// A late pick-up is billed on the NEXT month's bill, so a bill passes the month before it as monthKey (the page loads that month's pick-ups for it).
export function lateFeesFor(settings, picks, monthKey) {
  const S = settings, list = (picks || []).map(p => ({ ...p, date: normalizeDate(p.date) })).filter(p => p.date && p.date.slice(0, 7) <= monthKey && schoolYearOf(p.date) === schoolYearOf(monthKey + '-01'))
    .sort((a, b) => ((a.date + ' ' + (a.time || '')) < (b.date + ' ' + (b.time || '')) ? -1 : 1));
  let noCalls = 0, total = 0, missingTime = false; const dates = [], details = [];
  list.forEach((p, i) => {
    const tier = Math.min(i + 1, 3);
    if (p.noCall) noCalls++;
    if (p.date.slice(0, 7) !== monthKey) return;
    const at = minuteOfDay(p.time); if (at === null) missingTime = true;
    const minutes = at === null ? 0 : Math.max(0, at - num(S.closingMinute));
    let amount = num(S['latePickup' + tier + 'Base']) + num(S['latePickup' + tier + 'PerMinute']) * minutes;
    if (p.noCall) amount += noCalls === 1 ? num(S.noCallFirst) : num(S.noCallAfter);
    if (p.police) amount += num(S.policeFee);
    amount = round2(amount);
    // a waived fee is not charged, but the pickup still counts toward the school year's number (the next one is the 2nd, 3rd...)
    if (p.waived) { details.push({ id: p.id, date: p.date, time: p.time || '', nth: i + 1, minutes, amount: 0, wouldBe: amount, waived: true }); return; }
    total += amount; dates.push(shortDate(p.date));
    details.push({ id: p.id, date: p.date, time: p.time || '', nth: i + 1, minutes, amount });
  });
  return { amount: round2(total), dates, details, missingTime };
}

// ---- credits and fees, each its own line (older bills hold one credit and one fee: those become one line each) ----
export function creditLinesOf(bill) {
  if (Array.isArray(bill.creditLines) && bill.creditLines.length) return bill.creditLines.map(l => ({ amount: num(l.amount), why: String(l.why || ''), ...(l.correction ? { correction: l.correction } : {}) }));
  return bill.creditsEnabled && num(bill.credits) ? [{ amount: num(bill.credits), why: String(bill.creditsNote || '') }] : [];
}
export function feeLinesOf(bill) {
  if (Array.isArray(bill.feeLines) && bill.feeLines.length) return bill.feeLines.map(l => ({ amount: num(l.amount), why: String(l.why || ''), ...(l.correction ? { correction: l.correction } : {}) }));
  return bill.addedFeesEnabled && num(bill.addedFees) ? [{ amount: num(bill.addedFees), why: String(bill.addedFeesNote || '') }] : [];
}
// writes the lines back into the single credit / added fee numbers the totals use
export function withLines(bill, credits, fees) {
  const c = credits || creditLinesOf(bill), f = fees || feeLinesOf(bill);
  return { ...bill, creditLines: c, feeLines: f,
    credits: round2(c.reduce((t, l) => t + l.amount, 0)), creditsEnabled: c.length > 0, creditsNote: c.map(l => l.why).filter(Boolean).join('; '),
    addedFees: round2(f.reduce((t, l) => t + l.amount, 0)), addedFeesEnabled: f.length > 0, addedFeesNote: f.map(l => l.why).filter(Boolean).join('; ') };
}

// The resupply fee the rule puts on a month: January and September the fall/spring fee, June the summer fee (the months are editable on the rule);
// none while the child's Resupply Fee field says Exempt, or Starts On a date that has not come (section 23 item 12; it replaces the Resupply fee starts on tag).
export function resupplyByRule(ctx, child, tagsStored, monthKey) {
  if (!ruleOn(ctx, 'resupply_fee')) return 0;
  const mm = Number(monthKey.split('-')[1]), months = (ctx.rules && ctx.rules.resupply_fee && ctx.rules.resupply_fee.months) || [1, 6, 9];
  if (!months.map(Number).includes(mm)) return 0;
  if (child.resupplyFeeExempt) return 0;
  const starts = normalizeDate(child.materialsFeeKickIn);
  if (starts && starts > monthKey + '-01') return 0;
  if (tagsStored.some(t => t.rule === 'resupply_starts')) return 0;
  return num(mm === 6 ? ctx.settings.resupplySummerFee : ctx.settings.resupplyFallSpringFee);
}

// ===== BILLING-LIB · billing-lib-04 · an open bill follows the Roster: bill rules, carrying forward, the breakdown, who pays =====
// ---------- an open bill follows the Roster (section 19 item 12) ----------
// What a bill reads from the child, in groups, with the name the bill shows for a group that changed ("updated from the Roster: Pays By, Rates").
export const ROSTER_FIELDS = [['payBy', 'Pays By'], ['schedule', 'Schedule'], ['rates', 'Rates'], ['den', 'Den'], ['funding', 'Funding'], ['days', 'Count Days By'],
  ['resupply', 'Resupply Fee'], ['status', 'Status'], ['start', 'Start Date'], ['birthday', 'Birthday'], ['tags', 'Tags']];
export function rosterFieldsOf(ctx, child, prog, tags) {
  const s = v => String(v ?? ''), rr = rosterRatesFor(ctx, { ...child, daysPerWeek: prog });
  return {
    payBy: s(child.paymentMethod), schedule: [s(prog), s(child.previousProgram), s(child.programFrom)], rates: [s(rr.monthlyRate), s(rr.dailyRate)], den: s(child.room),
    funding: [child.subsidy1Org, child.cccapCounty, child.cccapParentFee, child.cccapExpirationDate, child.subsidy1DailyRate, child.subsidy2Org, child.upkTier, child.emergencyFundingAmount,
      child.emergencyFundingExpires, child.emergencyFundingSource, child.kidsFirstEnds, child.upkEnds, child.cccapStarts, JSON.stringify(child.cccapDays || {})].map(s),
    days: [child.dayCountRule === true || child.dayCountRule === 'Custom' ? 'custom' : 'schedule', daysList(child.customDays).join(','), child.customDaysExcludeClosures ? 'closures' : '', daysList(child.kidsFirstCustomDays).join(','), s(child.subsidy1Org), s(prog)],
    resupply: [s(child.materialsFeeKickIn), child.resupplyFeeExempt ? 'exempt' : ''], status: [s(child.status), s(child.holdFrom), s(child.holdReturn)], start: s(child.startDate), birthday: s(child.dob),
    tags: (tags || []).map(t => s(t.name)).sort(),
  };
}
// A hold by its dates (section 19 item 16): 'off' = on hold the whole month (no bill), 'partial' = the hold starts or ends in the month (the bill stays and asks for a credit),
// '' = not on hold that month. holdFrom blank = from the start (a child put On Hold before dates existed); holdReturn blank = no return date yet. A child who is Active
// again with no return date is not on hold at all (Bring back sets the return date, so the months of the hold stay off).
export function holdStateFor(child, monthKey) {
  if (!child) return '';
  const from = normalizeDate(child.holdFrom), back = normalizeDate(child.holdReturn);
  if (child.status === 'Active' && !back) return '';
  if (child.status !== 'Active' && child.status !== 'On Hold') return '';
  if (!from && !back && child.status !== 'On Hold') return '';
  const first = monthKey + '-01', last = monthKey + '-' + String(daysInMonth(monthKey)).padStart(2, '0');
  if (from && from > last) return '';
  if (back && back <= first) return '';
  const starts = from && from > first, ends = back && back <= last;
  return starts || ends ? 'partial' : 'off';
}
// An On Hold child for the whole month (unless a visiting family with a drop-in) and an Archived child are off Monthly Billing; their open bills stay stored in case they come back.
export function offMonthlyBilling(ctx, child, bill, ex) {
  if (!child) return false;
  if (child.status === 'Archived') return !bill.invoiced;
  if (bill.invoiced || holdStateFor(child, bill.monthKey) !== 'off') return false;
  return !(ruleOn(ctx, 'visiting_family') && activeTags(ctx, child, bill.monthKey, ex || {}).has('visiting_family'));
}

// Puts every rule on an open bill: the schedule's rates, the tags' discounts, the resupply fee, drop-ins and late pickups logged on My kids, the
// late payment and registration fees, the credit and fee lines, then the totals. Never call it for an Invoiced bill (the page does not; the database refuses).
// ex = { tags, today, isFirstBill, names, dropInDates (logged on My kids this month), latePickups (this school year to the end of the month) }
// A bill for a month after the CCCAP authorization ended can say "the family pays": the child is then billed at the full rate with no CCCAP, and the Roster is left alone (section 25 item 8).
export function childForBill(child, bill) {
  if (!child || !bill || bill.cccapEndChoice !== 'family_pays' || child.subsidy1Org !== 'CCCAP') return child;
  return { ...child, subsidy1Org: '', subsidy1DailyRate: 0, cccapCounty: '', cccapParentFee: 0, cccapExpirationDate: '', cccapStarts: '', cccapDays: {}, cccapParentFeeFrom: '' };
}
export function applyBillRules(ctx, child, bill, ex, following) {
  ex = ex || {};
  child = childForBill(child, bill);
  const S = ctx.settings, month = bill.monthKey, on = k => ruleOn(ctx, k);
  const prog = programForMonth(child, month), eff = { ...child, daysPerWeek: prog };
  const T = activeTags(ctx, child, month, ex);
  let next = { ...bill };

  // Section 19 item 12: an open bill follows the Roster. following = an existing open bill being brought up to date (not a new bill).
  // The Roster as it was when this bill last matched it is kept on the bill (rosterSync), so only what changed since is passed on: Pays By, funding, tags,
  // den and status always match the Roster; the rates and the days attended are only reset when the Roster's own schedule, rates or day counting changed,
  // so a rate or a day count typed on one bill for one month is not undone every time the page is opened.
  const cur = rosterFieldsOf(ctx, eff, prog, T.all);
  const was = following && bill.rosterSync && bill.rosterSync.fields ? bill.rosterSync.fields : null;
  const moved = was ? ROSTER_FIELDS.filter(([k]) => JSON.stringify(was[k]) !== JSON.stringify(cur[k])).map(([k]) => k) : [];
  const said = k => { if (!moved.includes(k)) moved.push(k); };
  if (following) {
    const pay = child.paymentMethod || '';
    if (pay && pay !== bill.paymentMethod && !(pay === 'Unknown' && !bill.paymentMethod)) { next.paymentMethod = pay; said('payBy'); }       // "Unknown" last month = still waiting for an answer
    else if (!pay && moved.includes('payBy') && bill.paymentMethod) next.paymentMethod = '';
  }
  const resetRates = was && (moved.includes('rates') || moved.includes('schedule')), resetDays = was && (moved.includes('days') || moved.includes('schedule'));
  if (resetRates) { const rr = rosterRatesFor(ctx, eff); next.monthlyRate = rr.monthlyRate; next.dailyRate = rr.dailyRate; }
  if (resetDays || (bill.program && bill.program !== prog)) {
    const fresh = buildCarriedForwardBill(ctx, eff, month, []);
    next.daysOfAttendance = fresh.daysOfAttendance; next.daysSubsidized = fresh.daysSubsidized;
  }
  if (bill.program && bill.program !== prog) {                      // the schedule changed: the new schedule's rates and days
    const rr = rosterRatesFor(ctx, eff);
    next.monthlyRate = rr.monthlyRate; next.dailyRate = rr.dailyRate; said('schedule');
  }
  next.program = prog;
  next.subsidy1DailyRate = effectiveSubsidy1DailyRate(ctx, child, month);
  next.subsidy2Amount = effectiveSubsidy2Amount(ctx, child);
  if (following && (bill.rosterSync || bill.rosterSyncReady)) {
    const prevNote = bill.rosterSync && bill.rosterSync.updated || [];
    const labels = moved.map(k => ROSTER_FIELDS.find(f => f[0] === k)[1]);
    next.rosterSync = { fields: cur, updated: labels.length ? labels : prevNote, at: labels.length ? (ex.today || '') : (bill.rosterSync && bill.rosterSync.at || '') };
  } else if (!following) next.rosterSync = { fields: cur, updated: [], at: '' };

  next.recurringPayment = T.stored.some(t => /^recurring payment$/i.test(t.name));
  next.siblingDiscountEnabled = on('sibling_discount') && T.has('sibling_discount');
  next.staffDiscountEnabled = on('staff_discount') && T.has('staff_discount');
  const staffTag = T.stored.filter(t => t.rule === 'staff_discount')[0];           // the amount and the staff member the tag was put on with
  if (staffTag && staffTag.ready) next.staffAmountReady = true;
  if (next.staffAmountReady || bill.staffAmountReady) { next.staffDiscountAmount = staffTag ? num(staffTag.amount) : 0; next.staffName = staffTag ? String(staffTag.staffName || '') : ''; }
  next.cardFeeOff = !on('card_fee');

  // a visiting family pays for the drop-in days only: no tuition, no days attended
  if (on('visiting_family') && T.has('visiting_family')) { next.billingMode = 'Summer/Drop-in'; next.daysOfAttendance = 0; next.daysSubsidized = 0; }

  // CCCAP pays for days attended + allowed absences + the county's paid holidays, never more than the days authorized (an Invoiced bill never gets here)
  if (ctx.terms) {
    next.cccapReady = true;
    const paid = (on('visiting_family') && T.has('visiting_family')) ? null : cccapPaidDays(ctx, eff, month, next.daysOfAttendance, next.absenceDays);
    next.cccapPaidDays = paid ? paid.days : null; next.cccapDaysNote = paid ? paid.note : '';
  }

  if (!String(next.resupplyFeeNote || '').trim()) next.resupplyFeeAmount = resupplyByRule(ctx, child, T.stored, month);

  // drop-ins: the days logged on My kids join the days typed on the bill, each at the child's own daily rate
  if (on('drop_in_days')) {
    const was = parseDropInDates(next.dropInLogged), logged = parseDropInDates(ex.dropInDates);
    const typed = parseDropInDates(next.dropInDates).filter(x => !was.includes(x));
    const dates = parseDropInDates([].concat(typed, logged));
    next.dropInLogged = logged; next.dropInDates = dates; next.dropInEnabled = dates.length > 0;
    const own = rosterRatesFor(ctx, eff).dailyRate;
    if (own > 0) next.dropInRate = own;
  }

  // what the rules add, each with its own name
  const ruleLines = [];
  if (on('late_pickup_fee') && (ex.latePickups || []).length) {
    const f = lateFeesFor(S, ex.latePickups, addMonths(month, -1));          // last month's late pick-ups are billed on this month's bill
    if (f.amount > 0) ruleLines.push({ rule: 'late_pickup_fee', label: 'Late pickup fee (' + f.dates.join(', ') + ')', amount: f.amount, missingTime: f.missingTime });
  }
  if (on('late_payment_fee') && T.has('late_payment') && num(S.latePaymentFee) > 0) ruleLines.push({ rule: 'late_payment_fee', label: 'Late payment fee', amount: num(S.latePaymentFee) });
  if (on('registration_fee') && child.newFamily && ex.isFirstBill && registrationCharged(child) && num(S.registrationFee) > 0 && (!countyPaysRegistration(ctx, child) || ex.registrationBillFamily)) ruleLines.push({ rule: 'registration_fee', label: 'Registration fee', amount: num(S.registrationFee) });
  next.ruleLines = ruleLines; next.ruleCharges = round2(ruleLines.reduce((t, l) => t + l.amount, 0));

  next = withLines(next);
  return { ...next, ...computeTotals(next, S, { ...child, ...next }) };
}

// A new month's bill for a child, carrying the slower-changing details (rates, payment method, mode) from the child's latest earlier bill and
// starting everything entered monthly (attendance counted, credits, drop-ins, fees, notes) fresh. priorBills = the child's earlier bills (any order).
// With ex (section 18) the tags and rules are put on it too (applyBillRules).
export function buildCarriedForwardBill(ctx, childIn, monthKey, priorBills, ex) {
  const child = ex ? { ...childIn, daysPerWeek: programForMonth(childIn, monthKey) } : childIn;
  const prev = (priorBills || []).filter(r => r.monthKey < monthKey).sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1))[0];
  const card = rateCardFor(ctx, child.daysPerWeek);
  const billingMode = prev ? prev.billingMode : (semesterForMonthKey(monthKey) === 'Summer' ? 'Summer/Drop-in' : 'School Year');
  const ruleDays = countRuleDays(monthKey, child, ctx.closures);
  const defaultDays = ruleDays != null ? ruleDays : card.defaultDaysOfAttendance;
  const kidsFirstDays = kidsFirstSubsidizedDays(monthKey, child, ctx.closures);
  const has = v => v !== '' && v !== null && v !== undefined;
  // "Unknown" last month means the family is asked again this month: the bill starts with no way of paying until it is chosen
  const carriedPay = prev ? (prev.paymentMethod === 'Unknown' ? '' : prev.paymentMethod) : (child.paymentMethod === 'Unknown' ? '' : (child.paymentMethod || ''));
  const bill = {
    monthKey, childId: child.id, billingMode,
    monthlyRate: prev ? prev.monthlyRate : (has(child.monthlyRate) ? Number(child.monthlyRate) : card.semesterMonthlyRate),
    dailyRate: prev ? prev.dailyRate : (has(child.dailyRate) ? Number(child.dailyRate) : card.summerDailyRate),
    daysOfAttendance: defaultDays,
    subsidy1DailyRate: effectiveSubsidy1DailyRate(ctx, child, monthKey),
    daysSubsidized: kidsFirstDays != null ? kidsFirstDays : defaultDays,
    subsidy2Amount: effectiveSubsidy2Amount(ctx, child), absenceDays: 0, cccapPaidDays: null, cccapDaysNote: '', cccapReady: !!ctx.terms,
    credits: 0, creditsNote: '', creditsEnabled: false, creditLines: [], feeLines: [], ruleLines: [], ruleCharges: 0,
    dropInEnabled: false, dropInDates: [], dropInLogged: [], dropInDays: 0, dropInRate: prev ? prev.dropInRate : card.summerDailyRate,
    addedFees: 0, addedFeesEnabled: false, addedFeesNote: '',
    resupplyFeeAmount: resupplyFeeDue(child, monthKey, ctx.settings), resupplyFeeNote: '',
    recurringPayment: prev ? !!prev.recurringPayment : false,
    paymentMethod: carriedPay,
    creditCardFeeEnabled: (prev && prev.creditCardFeeEnabled !== '' && prev.creditCardFeeEnabled != null) ? !!prev.creditCardFeeEnabled : true,
    siblingDiscountEnabled: prev ? !!prev.siblingDiscountEnabled : false,
    billingStatus: 'Not Started', invoiced: false, invoicedAt: null, notes: '', program: ex ? child.daysPerWeek : '',
  };
  if (ex) return applyBillRules(ctx, child, bill, ex);
  return { ...bill, ...computeTotals(bill, ctx.settings, { ...child, ...bill }) };
}

// An open (not invoiced) bill follows the roster: the funding rates are looked up again from the roster / county / age every time, and the
// totals worked out again. Returns the bill as it should now be stored (a new object). A frozen (invoiced) bill is returned unchanged.
// With ex (section 18) the tags and rules are applied again too, so a tag, rule, schedule or amount you changed shows on every open bill.
export function refreshOpenBill(ctx, child, bill, ex) {
  if (bill.invoiced) return bill;
  if (ex) return applyBillRules(ctx, child, bill, ex, true);
  const next = { ...bill };
  next.subsidy1DailyRate = effectiveSubsidy1DailyRate(ctx, child, bill.monthKey);
  next.subsidy2Amount = effectiveSubsidy2Amount(ctx, child);
  if (next.resupplyFeeAmount === '' || next.resupplyFeeAmount == null || !Number.isFinite(Number(next.resupplyFeeAmount))) next.resupplyFeeAmount = resupplyFeeDue(child, bill.monthKey, ctx.settings);
  return { ...next, ...computeTotals(next, ctx.settings, { ...child, ...next }) };
}

// what the family-facing pieces of a bill are, in the order they are added up (for the on-screen breakdown and the export)
// Each line is [name, amount, detail, kind]; every line a rule added is named with where it came from. Lines with nothing in them are left out.
export function breakdown(bill, child0, settings) {
  const child = childForBill(child0, bill);
  const t = computeTotals(bill, settings, { ...child, ...bill });
  if (t.withdrawalStatus === 'inactive') return { lines: [], totals: t, inactive: true };
  const cccap = child.subsidy1Org === 'CCCAP', daily = bill.billingMode === 'Summer/Drop-in';
  const lines = [], mname = monthLabel(bill.monthKey).split(' ')[0];
  const paidKnown = bill.cccapPaidDays !== null && bill.cccapPaidDays !== undefined && bill.cccapPaidDays !== '';
  if (cccap && paidKnown) lines.push(['CCCAP rate × days CCCAP pays', round2(num(bill.subsidy1DailyRate) * num(bill.cccapPaidDays)), num(bill.cccapPaidDays) + ' days × $' + num(bill.subsidy1DailyRate) + (bill.cccapDaysNote ? ' (' + bill.cccapDaysNote + ')' : ''), 'base']);
  else if (cccap) lines.push(['CCCAP rate × days attended', round2(num(bill.subsidy1DailyRate) * num(bill.daysOfAttendance)), num(bill.daysOfAttendance) + ' days × $' + num(bill.subsidy1DailyRate), 'base']);
  else if (daily) lines.push(['Daily rate × days attended', round2(num(bill.dailyRate) * num(bill.daysOfAttendance)), num(bill.daysOfAttendance) + ' days × $' + num(bill.dailyRate), 'base']);
  else lines.push(['Monthly tuition', num(bill.monthlyRate), 'flat monthly rate', 'base']);
  const f1 = num(t.subsidy1Total), f2 = num(bill.subsidy2Amount);
  if (f1) lines.push([cccap ? 'CCCAP Pays' : (child.subsidy1Org || 'Funding') + ' Pays', -f1, cccap ? 'everything after the Parent Fee' : num(bill.daysSubsidized) + ' days × $' + num(bill.subsidy1DailyRate) + kidsFirstDaysText(child), 'subsidy']);
  if (f2) lines.push([child.subsidy2Org === 'Emergency Funding' ? 'Emergency Funding' : (child.subsidy2Org || 'UPK') + ' Pays', -f2, /^UPK/.test(child.subsidy2Org || '') ? upkHours(child.upkTier) + ' hrs a week · UPK table' + (f2 > 0 && upkCapShare(settings, upkHours(child.upkTier)) === f2 ? ' · held at the state\'s yearly cap' : '') : (child.emergencyFundingSource || 'flat amount'), 'subsidy']);
  if (t.dropInDays) {
    // days from another month (last month's, logged on My kids) are named by their month: "Drop-in days in October: Oct 14, Oct 21"
    const ds = parseDropInDates(bill.dropInDates), byM = {};
    ds.forEach(x => { (byM[x.slice(0, 7)] = byM[x.slice(0, 7)] || []).push(x); });
    const ms = Object.keys(byM).sort(), other = ms.some(m => m !== bill.monthKey);
    const label = other ? 'Drop-in days ' + ms.map(m => (m === bill.monthKey ? 'this month' : 'in ' + monthLabel(m).split(' ')[0]) + ': ' + byM[m].map(shortDate).join(', ')).join('; ') : 'Drop-in days (' + ds.map(shortDate).join(', ') + ')';
    lines.push([label, round2(t.dropInDays * num(bill.dropInRate)), t.dropInDays + ' × $' + num(bill.dropInRate), 'rule']);
  }
  if (t.resupplyFee) lines.push(['Resupply fee (' + mname + ')', t.resupplyFee, bill.resupplyFeeNote || '', 'rule']);
  (Array.isArray(bill.ruleLines) ? bill.ruleLines : []).forEach(l => lines.push([l.label, num(l.amount), '', 'rule']));
  feeLinesOf(bill).forEach(l => lines.push([l.correction ? l.why : 'Added fee' + (l.why ? ' · ' + l.why : ''), l.amount, '', 'fee', l.correction || '']));
  creditLinesOf(bill).forEach(l => lines.push([l.correction ? l.why : 'Credit' + (l.why ? ' · ' + l.why : ''), -l.amount, '', 'credit', l.correction || '']));
  if (t.siblingDiscount) lines.push(['Sibling discount', -t.siblingDiscount, num(settings.siblingDiscountRate) + '%', 'rule']);
  if (t.staffDiscount) lines.push(['Staff child discount', -t.staffDiscount, 'flat amount' + (bill.staffName ? ' · ' + bill.staffName : ''), 'rule']);
  if (t.creditCardFee) lines.push(['Card fee (pays by Credit Card)', t.creditCardFee, num(settings.creditCardFeeRate) + '%', 'rule']);
  return { lines, totals: t, inactive: false };
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function kidsFirstDaysText(child) { const d = daysList(child.kidsFirstCustomDays); return child.subsidy1Org === 'Kids First' && d.length ? ' (' + d.map(n => DAY_SHORT[n]).join(', ') + ')' : ''; }
// Who Pays on a bill (picture 35): what the family pays and what each funding pays, for the bar and the labels under it
export function whoPays(bill, child, totals) {
  const t = totals || computeTotals(bill, {}, { ...child, ...bill });
  const parts = []; const f1 = num(t.subsidy1Total), f2 = num(bill.subsidy2Amount);
  if (f1) parts.push({ label: child.subsidy1Org === 'CCCAP' ? 'CCCAP' : child.subsidy1Org || 'Funding', amount: f1 });
  if (f2) parts.push({ label: /^UPK/.test(child.subsidy2Org || '') ? child.subsidy2Org : 'Emergency Funding', amount: f2 });
  const funding = round2(parts.reduce((a, p) => a + p.amount, 0)), family = round2(num(t.billForFamilies));
  return { family, funding, parts, total: round2(family + funding) };
}
// The rates the roster says this child pays: the child's own rate when one is set, else the rate card for their program.
export function rosterRatesFor(ctx, child) {
  const card = rateCardFor(ctx, child.daysPerWeek), has = v => v !== '' && v !== null && v !== undefined;
  return { monthlyRate: has(child.monthlyRate) ? Number(child.monthlyRate) : card.semesterMonthlyRate, dailyRate: has(child.dailyRate) ? Number(child.dailyRate) : card.summerDailyRate };
}

// ===== BILLING-LIB · billing-lib-05 · what stops a bill being Invoiced, warnings, database rows to bills and children =====
// ---- things that stop a bill being Invoiced (the database refuses these too) ----
export function billBlockers(child, bill) {
  const b = [];
  if (!PAYMENT_METHODS.includes(bill.paymentMethod)) b.push(bill.paymentMethod ? bill.paymentMethod + ' is not one of the ways of paying any more: choose Credit Card, Debit Card, ACH/Bank or Unknown.' : 'Choose how this family pays (Credit Card, Debit Card, ACH/Bank or Unknown).');
  if (child.confirmRoster) b.push('Confirm this new child\'s roster first.');
  return b;
}
// earlier months of a child's that were never invoiced, for "Previous open invoices" on a later bill
export function previousOpenBills(bills, childId, monthKey) {
  return (bills || []).filter(b => b.childId === childId && b.monthKey < monthKey && !b.invoiced && num(b.billForFamilies) > 0 && b.withdrawalStatus !== 'inactive')
    .sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));
}

// Things worth a second look before invoicing (plain sentences). today = 'YYYY-MM-DD' (for expiry dates); optional.
// ex (section 18): the same tags and rules input applyBillRules takes, for the warnings that depend on tags.
export function billWarnings(ctx, childIn0, bill, today, ex) {
  const childIn = childForBill(childIn0, bill);
  const w = [], child = ex ? { ...childIn, daysPerWeek: programForMonth(childIn, bill.monthKey) } : childIn;
  if (!child.daysPerWeek) w.push('This child has no program.');
  if ((child.subsidy2Org === 'UPK3' || child.subsidy2Org === 'UPK4')) {
    if (child.daysPerWeek === 'Drop-in') w.push('UPK is switched on but there is no UPK amount for a Drop-in child, so no UPK funding is taken off. (HQ gives $0 here without saying so.)');
    else if (!child.upkTier) w.push('UPK is switched on but no UPK hours are chosen, so no UPK funding is taken off.');
    else {
      const row = ctx.upk.find(r => r.org === child.subsidy2Org && r.tier === child.upkTier && r.program === child.daysPerWeek);
      if (!row || row.offered === false) w.push('There is no ' + child.subsidy2Org + ' amount for ' + child.upkTier + ' and ' + child.daysPerWeek + ', so no UPK funding is taken off.');
    }
  }
  if (child.subsidy1Org === 'CCCAP') {
    if (!child.cccapCounty) w.push('CCCAP is switched on but no county is chosen, so the CCCAP rate is $0.');
    else if (!ctx.cccap[child.cccapCounty] && !(ctx.plans && ctx.plans[child.cccapCounty])) w.push('There is no CCCAP rate for ' + child.cccapCounty + ' county.');
    else if (!child.dob) w.push('CCCAP needs the child\'s birthday to pick the age group.');
    else if (!num(bill.subsidy1DailyRate)) w.push('The CCCAP rate came out as $0.');
    if (today && child.cccapExpirationDate) {
      const e = normalizeDate(child.cccapExpirationDate), ended = bill.cccapEndReady && e && e.slice(0, 7) < bill.monthKey;
      if (ended) { if (!bill.cccapEndChoice) w.push('The CCCAP authorization ended on ' + e + ': choose whether to keep billing CCCAP (renewal pending) or the family pays.'); }
      else if (e && e < today) w.push('The CCCAP authorization expired on ' + e + '.');
    }
  }
  if (child.subsidy1Org === 'Kids First' && !num(bill.subsidy1DailyRate)) w.push('Kids First is switched on but has no daily rate.');
  if (child.subsidy1Org === 'CCCAP' && (child.subsidy2Org === 'UPK3' || child.subsidy2Org === 'UPK4')) w.push('CCCAP and UPK cannot be combined. Choose one on the Roster (UPK can go with Kids First).');
  { const endsOf = (iso, name) => { const e = normalizeDate(iso); if (e && e < bill.monthKey + '-01') w.push(name + ' ended on ' + e + '.'); };
    if (child.subsidy1Org === 'Kids First') endsOf(child.kidsFirstEnds, 'Kids First');
    if (child.subsidy2Org === 'UPK3' || child.subsidy2Org === 'UPK4') endsOf(child.upkEnds, 'UPK'); }
  if (bill.billingMode === 'Summer/Drop-in' && !num(bill.dailyRate)) w.push('Summer/Drop-in billing needs a daily rate.');
  if (bill.billingMode !== 'Summer/Drop-in' && child.subsidy1Org !== 'CCCAP' && !num(bill.monthlyRate)) w.push('The monthly rate is $0.');
  if (child.subsidy1Org !== 'CCCAP' && child.daysPerWeek) {      // a bill made before a program or rate change keeps the old rate (HQ carries rates forward): say so
    const rr = rosterRatesFor(ctx, child), daily = bill.billingMode === 'Summer/Drop-in';
    const have = daily ? num(bill.dailyRate) : num(bill.monthlyRate), want = daily ? rr.dailyRate : rr.monthlyRate;
    if (want > 0 && Math.abs(have - want) >= 0.005) w.push('The ' + (daily ? 'daily' : 'monthly') + ' rate on this bill is ' + fmt(have) + ', but the roster rate for ' + child.daysPerWeek + ' is ' + fmt(want) + '. Use the roster\'s rate, or leave it if this month is meant to be different.');
  }
  if (bill.dropInEnabled && !parseDropInDates(bill.dropInDates).length) w.push('Drop-in days are switched on but no dates are listed.');
  if (!bill.paymentMethod) w.push('No payment method: choose how this family pays (Credit Card, Debit Card, ACH/Bank or Unknown). The bill cannot be invoiced until you do.');
  else if (ex && !PAYMENT_METHODS.includes(bill.paymentMethod)) w.push(bill.paymentMethod + ' is not one of the ways of paying any more: choose Credit Card, Debit Card, ACH/Bank or Unknown. The bill cannot be invoiced until you do.');
  if (ex) {
    const T = activeTags(ctx, child, bill.monthKey, ex);
    if (T.has('sibling_discount') && T.has('staff_discount')) w.push('The sibling and staff child discounts do not combine, so neither is taken off. Remove one of the two tags.');
    if (T.has('asks_credit') && !creditLinesOf(bill).length) {
      const pn = ex.isFirstBill ? prorateNote(ctx, child, bill.monthKey) : '';
      w.push(pn ? 'A credit is needed: ' + pn + ' (' + (child.childFirst || 'the child') + ' starts ' + shortDate(child.startDate) + ').' : 'A credit is needed: this month has a Prorated or Schedule change tag and no credit yet.');
    }
    if (child.confirmRoster) w.push('This is a new child: confirm their roster before the bill can be invoiced.');
    const sup = setupProgress(ex.setup, (ex.tags || []).length);
    if (sup && !sup.complete) w.push('New child: ' + sup.left + (sup.left === 1 ? ' set-up question is' : ' set-up questions are') + ' not answered yet (' + sup.n + ' of ' + sup.total + ' done). Answer them on the Roster card.');
    if (T.has('late_payment') && ruleOn(ctx, 'late_payment_fee') && !num(ctx.settings.latePaymentFee)) w.push('The Late payment fee is $0: set it in Rates and settings.');
    if (child.newFamily && ex.isFirstBill && ruleOn(ctx, 'registration_fee') && child.registrationChoice === '' && !countyPaysRegistration(ctx, child)) w.push('Choose whether to charge the Registration fee: on the child\'s Roster record, or take it off this bill with the × on its line.');
    if (child.newFamily && ex.isFirstBill && ruleOn(ctx, 'registration_fee') && registrationCharged(child) && !num(ctx.settings.registrationFee) && !countyPaysRegistration(ctx, child)) w.push('The Registration fee is $0: set it in Rates and settings.');
    if (parseDropInDates(bill.dropInDates).length && ruleOn(ctx, 'drop_in_days') && !(rosterRatesFor(ctx, child).dailyRate > 0)) w.push('Drop-in days are billed at the child\'s own daily rate and this child has none. Set one on their Roster card.');
    if ((bill.ruleLines || []).some(l => l.missingTime)) w.push('A late pick-up has no time, so no per-minute charge was added. Add the time on My kids.');
  }
  return w;
}

// ---------- database rows <-> bills / children ----------
// [bill field, column, kind]  kinds: t text, n number, b boolean, d date, da date list, ts timestamp, j list of lines (json)
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
  ['creditLines', 'credit_lines', 'j'], ['feeLines', 'fee_lines', 'j'], ['ruleLines', 'rule_lines', 'j'], ['ruleCharges', 'rule_charges', 'n'],
  ['staffDiscountEnabled', 'staff_discount_enabled', 'b'], ['staffDiscount', 'staff_discount', 'n'], ['program', 'program', 't'],
];
export function billFromRow(row) {
  const b = { id: row.id, childId: row.profile_id, monthKey: row.month_key, rosterSnapshot: row.roster_snapshot || null, updatedAt: row.updated_at,
    rosterSync: row.roster_sync || null, rosterSyncReady: 'roster_sync' in row,
    paysByChecked: !!row.pays_by_checked, paysByReady: 'pays_by_checked' in row,
    dropInLogged: (row.drop_in_logged || []).map(x => String(x).slice(0, 10)), dropInLoggedReady: 'drop_in_logged' in row,
    cccapEndChoice: row.cccap_end_choice || '', cccapEndReady: 'cccap_end_choice' in row,
    staffAmountReady: 'staff_discount_amount' in row, staffDiscountAmount: Number(row.staff_discount_amount) || 0, staffName: row.staff_discount_name || '',       // migration 059
    absenceDays: Number(row.absence_days) || 0, cccapPaidDays: row.cccap_paid_days == null ? null : Number(row.cccap_paid_days), cccapDaysNote: row.cccap_days_note || '', cccapReady: 'absence_days' in row };       // migration 042       // pays_by_checked: migration 041 (Pays By looked at for this month)       // roster_sync: migration 040 (what the Roster said when the bill last matched it)
  BILL_COLUMNS.forEach(([f, c, k]) => {
    const v = row[c];
    b[f] = k === 'n' ? Number(v) || 0 : k === 'b' ? !!v : k === 'da' ? (v || []).map(x => String(x).slice(0, 10)) : k === 'ts' ? (v || null) : k === 'j' ? (Array.isArray(v) ? v : []) : (v ?? '');
  });
  b.dropInDays = parseDropInDates(b.dropInDates).length;
  return b;
}
export function billToRow(bill) {
  const row = { profile_id: bill.childId, month_key: bill.monthKey, roster_snapshot: bill.rosterSnapshot || null };
  if (bill.rosterSyncReady) row.roster_sync = bill.rosterSync || null;
  if (bill.cccapEndReady) row.cccap_end_choice = bill.cccapEndChoice || '';          // migration 054: keep CCCAP (renewal pending) or the family pays
  if (bill.dropInLoggedReady) row.drop_in_logged = parseDropInDates(bill.dropInLogged);          // migration 052: the drop-in days that came from My kids
  if (bill.paysByReady) row.pays_by_checked = !!bill.paysByChecked;
  if (bill.staffAmountReady) { row.staff_discount_amount = Math.max(0, Number(bill.staffDiscountAmount) || 0); row.staff_discount_name = String(bill.staffName || ''); }
  if (bill.cccapReady) { row.absence_days = Math.max(0, Math.round(Number(bill.absenceDays) || 0)); row.cccap_paid_days = (bill.cccapPaidDays === null || bill.cccapPaidDays === undefined || bill.cccapPaidDays === '') ? null : Number(bill.cccapPaidDays); row.cccap_days_note = String(bill.cccapDaysNote || ''); }
  BILL_COLUMNS.forEach(([f, c, k]) => {
    const v = bill[f];
    row[c] = k === 'n' ? (Number.isFinite(Number(v)) ? Number(v) : 0) : k === 'b' ? !!v : k === 'da' ? parseDropInDates(v) : k === 'ts' ? (v || null) : k === 'j' ? (Array.isArray(v) ? v : []) : String(v ?? '');
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
    holdFrom: p.hold_from ? String(p.hold_from).slice(0, 10) : '', holdReturn: p.hold_return ? String(p.hold_return).slice(0, 10) : '',
    kidsFirstEnds: p.kids_first_ends ? String(p.kids_first_ends).slice(0, 10) : '', upkEnds: p.upk_ends ? String(p.upk_ends).slice(0, 10) : '',
    cccapStarts: p.cccap_starts ? String(p.cccap_starts).slice(0, 10) : '', cccapCare: p.cccap_care || '', cccapDays: (p.cccap_days && typeof p.cccap_days === 'object') ? p.cccap_days : {},
    cccapDropInDays: p.cccap_drop_in_days == null ? '' : Number(p.cccap_drop_in_days), cccapArtRegistration: p.cccap_art_registration == null ? '' : Number(p.cccap_art_registration),
    cccapArtActivity: p.cccap_art_activity == null ? '' : Number(p.cccap_art_activity), cccapPdfUrl: p.cccap_pdf_url || '', cccapParentFeeFrom: p.cccap_parent_fee_from ? String(p.cccap_parent_fee_from).slice(0, 10) : '',
    previousProgram: p.previous_program || '', programFrom: p.program_from ? String(p.program_from).slice(0, 10) : '', confirmRoster: !!p.confirm_roster, newFamily: !!p.new_family, registrationChoice: p.registration_fee_choice === undefined || p.registration_fee_choice === null ? undefined : p.registration_fee_choice,
  };
}

// ===== BILLING-LIB · billing-lib-06 · comparing with Ajax Cubs HQ =====
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
