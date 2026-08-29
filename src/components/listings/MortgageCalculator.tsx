"use client";

import { useMemo, useState } from "react";

import { formatPrice } from "@/lib/format";
import {
  DEFAULT_DOWN_PAYMENT_PERCENT,
  DEFAULT_INTEREST_RATE,
  DEFAULT_TERM_YEARS,
  calculateMortgage,
} from "@/lib/mortgage";

/**
 * Interactive payment estimator on the listing detail page.
 *
 * Shows the TOTAL monthly cost broken into components, not just principal and interest — see
 * src/lib/mortgage.ts for why that distinction matters. Prefilled from the listing's real tax
 * figure and HOA so the first number a buyer sees is already close to accurate.
 */
export function MortgageCalculator({
  homePrice,
  annualTax,
  monthlyHoa,
}: {
  homePrice: number;
  annualTax?: number;
  monthlyHoa?: number;
}) {
  const [downPayment, setDownPayment] = useState(
    Math.round(homePrice * DEFAULT_DOWN_PAYMENT_PERCENT),
  );
  const [interestRate, setInterestRate] = useState(DEFAULT_INTEREST_RATE);
  const [termYears, setTermYears] = useState(DEFAULT_TERM_YEARS);

  const result = useMemo(
    () =>
      calculateMortgage({
        homePrice,
        downPayment,
        interestRate,
        termYears,
        annualTax,
        monthlyHoa,
      }),
    [homePrice, downPayment, interestRate, termYears, annualTax, monthlyHoa],
  );

  const rows: { label: string; value: number; note?: string }[] = [
    { label: "Principal & interest", value: result.principalAndInterest },
    { label: "Property tax", value: result.monthlyTax },
    { label: "Homeowner's insurance", value: result.monthlyInsurance, note: "estimated" },
    ...(result.monthlyHoa > 0 ? [{ label: "HOA dues", value: result.monthlyHoa }] : []),
    ...(result.monthlyPmi > 0
      ? [{ label: "Mortgage insurance", value: result.monthlyPmi, note: "under 20% down" }]
      : []),
  ];

  return (
    <section className="rounded-card border border-sand-200 bg-white p-6">
      <h2 className="font-display text-xl font-semibold text-sand-950">
        Estimated monthly payment
      </h2>

      <p className="mt-4 font-display text-4xl font-semibold text-brand-800">
        {formatPrice(Math.round(result.totalMonthly))}
        <span className="ml-1 text-base font-normal text-sand-600">/mo</span>
      </p>

      <dl className="mt-5 space-y-2 border-t border-sand-100 pt-4 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-sand-700">
              {row.label}
              {row.note && (
                <span className="ml-1.5 text-xs text-sand-500">({row.note})</span>
              )}
            </dt>
            <dd className="font-medium tabular-nums text-sand-900">
              {formatPrice(Math.round(row.value))}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-6 space-y-5 border-t border-sand-100 pt-5">
        <Field
          id="down-payment"
          label="Down payment"
          value={formatPrice(downPayment)}
          hint={`${Math.round(result.downPaymentPercent * 100)}%`}
        >
          <input
            id="down-payment"
            type="range"
            min={0}
            max={homePrice}
            step={Math.max(1000, Math.round(homePrice / 200))}
            value={downPayment}
            onChange={(e) => setDownPayment(Number(e.target.value))}
            className="w-full accent-brand-700"
          />
        </Field>

        <Field id="interest-rate" label="Interest rate" value={`${interestRate.toFixed(2)}%`}>
          <input
            id="interest-rate"
            type="range"
            min={2}
            max={12}
            step={0.125}
            value={interestRate}
            onChange={(e) => setInterestRate(Number(e.target.value))}
            className="w-full accent-brand-700"
          />
        </Field>

        <fieldset>
          <legend className="text-sm font-medium text-sand-800">Loan term</legend>
          <div className="mt-2 flex gap-2">
            {[15, 20, 30].map((years) => (
              <button
                key={years}
                type="button"
                onClick={() => setTermYears(years)}
                aria-pressed={termYears === years}
                className={
                  termYears === years
                    ? "rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white"
                    : "rounded-md border border-sand-300 px-4 py-2 text-sm font-medium text-sand-700 hover:border-sand-400"
                }
              >
                {years} yr
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {/*
       * Not legal boilerplate for its own sake: presenting an estimate as a quote is a real
       * liability, and buyers who anchor on a wrong number get upset at the lender stage.
       */}
      <p className="mt-5 border-t border-sand-100 pt-4 text-xs leading-relaxed text-sand-500">
        Estimate only. Actual payment depends on your credit, loan program, and lender. Insurance
        is approximated; taxes are based on the current assessment and may change after sale.
      </p>
    </section>
  );
}

function Field({
  id,
  label,
  value,
  hint,
  children,
}: {
  id: string;
  label: string;
  value: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium text-sand-800">
          {label}
        </label>
        <span className="text-sm tabular-nums text-sand-700">
          {value}
          {hint && <span className="ml-1 text-xs text-sand-500">{hint}</span>}
        </span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
