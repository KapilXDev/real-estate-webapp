/**
 * Mortgage math.
 *
 * Deliberately models TOTAL monthly cost, not just principal and interest. Most agent-site
 * calculators show P&I only, which understates the real number by 25-40% once taxes, insurance,
 * and HOA are included — buyers then tour homes they cannot actually afford, which wastes
 * everyone's time and damages trust when the lender's number arrives.
 */

export interface MortgageInput {
  homePrice: number;
  /** Down payment in dollars (not percent) — avoids rounding drift between the two forms. */
  downPayment: number;
  /** Annual interest rate as a percentage, e.g. 6.75. */
  interestRate: number;
  termYears: number;
  /** Annual property tax in dollars. */
  annualTax?: number;
  /** Annual homeowner's insurance in dollars. */
  annualInsurance?: number;
  /** Monthly HOA/association fee. */
  monthlyHoa?: number;
  /**
   * Annual PMI as a percentage of the loan amount. Conventionally applied when the down payment
   * is under 20%; typically 0.5-1.5%.
   */
  pmiRate?: number;
}

export interface MortgageBreakdown {
  loanAmount: number;
  principalAndInterest: number;
  monthlyTax: number;
  monthlyInsurance: number;
  monthlyHoa: number;
  monthlyPmi: number;
  /** The number that actually matters to a buyer. */
  totalMonthly: number;
  downPaymentPercent: number;
  totalInterestOverTerm: number;
}

/** PMI threshold — below 20% equity, conventional loans carry mortgage insurance. */
const PMI_EQUITY_THRESHOLD = 0.2;

/** Fallback insurance estimate when none is supplied: ~0.35% of home value annually. */
const DEFAULT_INSURANCE_RATE = 0.0035;

/** Fallback PMI rate when applicable. */
const DEFAULT_PMI_RATE = 0.007;

export function calculateMortgage(input: MortgageInput): MortgageBreakdown {
  const homePrice = Math.max(0, input.homePrice);
  const downPayment = Math.min(Math.max(0, input.downPayment), homePrice);
  const loanAmount = homePrice - downPayment;
  const downPaymentPercent = homePrice > 0 ? downPayment / homePrice : 0;

  const monthlyRate = input.interestRate / 100 / 12;
  const payments = Math.max(1, Math.round(input.termYears * 12));

  /*
   * Standard amortization formula. The zero-rate branch matters: at 0% the formula divides by
   * zero, and an all-cash or seller-financed scenario is a real thing buyers model.
   */
  const principalAndInterest =
    monthlyRate === 0
      ? loanAmount / payments
      : (loanAmount * (monthlyRate * (1 + monthlyRate) ** payments)) /
        ((1 + monthlyRate) ** payments - 1);

  const monthlyTax = (input.annualTax ?? 0) / 12;
  const monthlyInsurance =
    (input.annualInsurance ?? homePrice * DEFAULT_INSURANCE_RATE) / 12;
  const monthlyHoa = input.monthlyHoa ?? 0;

  const monthlyPmi =
    downPaymentPercent < PMI_EQUITY_THRESHOLD
      ? (loanAmount * (input.pmiRate ?? DEFAULT_PMI_RATE)) / 12
      : 0;

  return {
    loanAmount,
    principalAndInterest,
    monthlyTax,
    monthlyInsurance,
    monthlyHoa,
    monthlyPmi,
    totalMonthly:
      principalAndInterest + monthlyTax + monthlyInsurance + monthlyHoa + monthlyPmi,
    downPaymentPercent,
    totalInterestOverTerm: principalAndInterest * payments - loanAmount,
  };
}

/**
 * Default rate used before the user adjusts anything.
 *
 * TODO: this is a static placeholder. Wire it to a live rate source (e.g. FRED MORTGAGE30US) so
 * the calculator does not quietly go stale — a visibly wrong rate undermines the whole page.
 */
export const DEFAULT_INTEREST_RATE = 6.75;
export const DEFAULT_TERM_YEARS = 30;
export const DEFAULT_DOWN_PAYMENT_PERCENT = 0.2;
