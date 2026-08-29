/**
 * Home loan (EMI) math for the Indian market.
 *
 * ⚠️ REWRITTEN FROM THE US MORTGAGE MODEL. The concepts that were dropped and why:
 *   - PMI does not exist here. Indian lenders manage LTV risk by simply capping the loan.
 *   - Escrowed homeowner's insurance is not standard. Property insurance is optional and bought
 *     separately, so folding it into a monthly payment would overstate the number.
 *   - Property tax is a small annual municipal charge, not the 1.5-2% of value the US model
 *     assumed. Rolling it into EMI made it look far more significant than it is.
 *
 * What replaced them is the thing buyers here actually underestimate:
 *
 *   STAMP DUTY AND REGISTRATION. At roughly 7% + 1% in Punjab, a ₹1 crore purchase carries about
 *   ₹8 lakh of transaction cost that is NOT financeable — banks lend against property value, not
 *   against stamp duty. A buyer who has budgeted a 20% down payment and nothing else is short by
 *   a lakh-scale amount at registry. A calculator that shows only EMI hides that entirely, which
 *   is the single most expensive omission this page could make.
 *
 * So this module computes both: the monthly EMI, and the upfront cash actually required.
 */

export interface HomeLoanInput {
  propertyPrice: number;
  /** Down payment in rupees (not percent) — avoids rounding drift between the two forms. */
  downPayment: number;
  /** Annual interest rate as a percentage, e.g. 8.5. */
  interestRate: number;
  termYears: number;
  /** Monthly society maintenance in rupees. A real recurring cost, so it is shown alongside EMI. */
  monthlyMaintenance?: number;
  /** Annual municipal property tax in rupees. */
  annualPropertyTax?: number;
  /**
   * Which state's stamp duty applies. Chandigarh, Punjab and Haryana all differ, and a tricity
   * buyer may be comparing properties across all three in one session.
   */
  state?: string;
  /** Whether the buyer is registering in a woman's name — most states charge a lower rate. */
  femaleBuyer?: boolean;
}

export interface HomeLoanBreakdown {
  loanAmount: number;
  /** The headline monthly figure. */
  emi: number;
  monthlyMaintenance: number;
  monthlyPropertyTax: number;
  /** EMI plus recurring charges — what actually leaves the account each month. */
  totalMonthly: number;
  downPaymentPercent: number;
  totalInterestOverTerm: number;
  /** Total of all EMIs across the full term. */
  totalPayable: number;

  /* ---- Upfront cash, the part buyers routinely miss ---- */
  stampDuty: number;
  registrationFee: number;
  /** Typical bank processing fee, capped as most lenders do. */
  processingFee: number;
  /** Down payment + stamp duty + registration + processing. Cash needed at the table. */
  upfrontCashRequired: number;
}

/**
 * Stamp duty and registration rates by state.
 *
 * ⚠️ VERIFY BEFORE LAUNCH AND RE-VERIFY ANNUALLY. These change in state budgets, and several
 * states periodically run temporary rebates. Quoting a stale rate on a ₹1 crore transaction is
 * a lakh-scale error in the buyer's planning.
 *
 * Most states charge women a lower rate to encourage registration in a woman's name; that is
 * modelled because it is a genuine and commonly-used saving, not an edge case.
 */
export const STAMP_DUTY_RATES: Record<
  string,
  { male: number; female: number; registration: number }
> = {
  Punjab: { male: 0.07, female: 0.05, registration: 0.01 },
  Chandigarh: { male: 0.06, female: 0.04, registration: 0.01 },
  Haryana: { male: 0.07, female: 0.05, registration: 0.01 },
};

const DEFAULT_STATE = "Punjab";

/**
 * Registration fee is charged on the same base as stamp duty but is capped in several states.
 * Punjab's is a percentage without a low cap; keeping the cap generous rather than modelling
 * every state's ceiling avoids understating the figure.
 */
const REGISTRATION_FEE_CAP = 200_000;

/** Processing fee: typically ~0.5% of the loan, capped by most lenders. */
const PROCESSING_FEE_RATE = 0.005;
const PROCESSING_FEE_CAP = 25_000;

export function calculateHomeLoan(input: HomeLoanInput): HomeLoanBreakdown {
  const propertyPrice = Math.max(0, input.propertyPrice);
  const downPayment = Math.min(Math.max(0, input.downPayment), propertyPrice);
  const loanAmount = propertyPrice - downPayment;
  const downPaymentPercent = propertyPrice > 0 ? downPayment / propertyPrice : 0;

  const monthlyRate = input.interestRate / 100 / 12;
  const payments = Math.max(1, Math.round(input.termYears * 12));

  /*
   * Standard EMI formula. The zero-rate branch matters: at 0% the formula divides by zero, and
   * builder subvention schemes advertising "0% interest" are common enough here to model.
   */
  const emi =
    monthlyRate === 0
      ? loanAmount / payments
      : (loanAmount * (monthlyRate * (1 + monthlyRate) ** payments)) /
        ((1 + monthlyRate) ** payments - 1);

  const monthlyMaintenance = input.monthlyMaintenance ?? 0;
  const monthlyPropertyTax = (input.annualPropertyTax ?? 0) / 12;

  const rates = STAMP_DUTY_RATES[input.state ?? DEFAULT_STATE] ?? STAMP_DUTY_RATES[DEFAULT_STATE]!;
  const dutyRate = input.femaleBuyer ? rates.female : rates.male;

  const stampDuty = propertyPrice * dutyRate;
  const registrationFee = Math.min(propertyPrice * rates.registration, REGISTRATION_FEE_CAP);
  const processingFee = Math.min(loanAmount * PROCESSING_FEE_RATE, PROCESSING_FEE_CAP);

  const totalPayable = emi * payments;

  return {
    loanAmount,
    emi,
    monthlyMaintenance,
    monthlyPropertyTax,
    totalMonthly: emi + monthlyMaintenance + monthlyPropertyTax,
    downPaymentPercent,
    totalInterestOverTerm: totalPayable - loanAmount,
    totalPayable,
    stampDuty,
    registrationFee,
    processingFee,
    upfrontCashRequired: downPayment + stampDuty + registrationFee + processingFee,
  };
}

/**
 * Defaults used before the user adjusts anything.
 *
 * TODO: DEFAULT_INTEREST_RATE is a static placeholder. Wire it to a live source (RBI repo rate
 * plus a spread, or a scraped lender average) so the calculator does not quietly go stale — a
 * visibly wrong rate undermines the whole page.
 */
export const DEFAULT_INTEREST_RATE = 8.5;
export const DEFAULT_TERM_YEARS = 20;

/**
 * Indian lenders typically finance up to 80% of value for mid-sized loans (90% below ~₹30 lakh,
 * 75% above ~₹75 lakh). 20% is the safe default to present.
 */
export const DEFAULT_DOWN_PAYMENT_PERCENT = 0.2;

/** Maximum LTV banks will normally lend, used to warn when a down payment is unrealistically low. */
export const MAX_TYPICAL_LTV = 0.9;
