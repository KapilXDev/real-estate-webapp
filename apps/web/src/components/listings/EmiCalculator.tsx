"use client";

import { useMemo, useState } from "react";

import { formatPrice, formatPriceExact } from "@/lib/format";
import {
  DEFAULT_DOWN_PAYMENT_PERCENT,
  DEFAULT_INTEREST_RATE,
  DEFAULT_TERM_YEARS,
  MAX_TYPICAL_LTV,
  calculateHomeLoan,
} from "@/lib/home-loan";

/**
 * Interactive EMI estimator on the listing detail page.
 *
 * Two panels, deliberately: the monthly EMI, and the **upfront cash required**. Stamp duty and
 * registration run to roughly 8% in Punjab and are not financeable, so a calculator that shows
 * only EMI lets a buyer plan around a number that is lakhs short of what they need at registry.
 * See src/lib/home-loan.ts for the full reasoning.
 *
 * Prefilled from the listing's real maintenance and tax figures so the first number is already
 * close to accurate.
 */
export function EmiCalculator({
  propertyPrice,
  monthlyMaintenance,
  annualPropertyTax,
  state,
}: {
  propertyPrice: number;
  monthlyMaintenance?: number;
  annualPropertyTax?: number;
  /** Drives the stamp duty rate — Punjab, Chandigarh and Haryana differ. */
  state?: string;
}) {
  const [downPayment, setDownPayment] = useState(
    Math.round(propertyPrice * DEFAULT_DOWN_PAYMENT_PERCENT),
  );
  const [interestRate, setInterestRate] = useState(DEFAULT_INTEREST_RATE);
  const [termYears, setTermYears] = useState(DEFAULT_TERM_YEARS);
  const [femaleBuyer, setFemaleBuyer] = useState(false);

  const result = useMemo(
    () =>
      calculateHomeLoan({
        propertyPrice,
        downPayment,
        interestRate,
        termYears,
        monthlyMaintenance,
        annualPropertyTax,
        state,
        femaleBuyer,
      }),
    [
      propertyPrice,
      downPayment,
      interestRate,
      termYears,
      monthlyMaintenance,
      annualPropertyTax,
      state,
      femaleBuyer,
    ],
  );

  // Banks will not normally fund above ~90% of value, so warn rather than quietly modelling a
  // loan no lender would actually write.
  const ltvTooHigh = result.loanAmount / propertyPrice > MAX_TYPICAL_LTV;

  const monthlyRows: { label: string; value: number; note?: string }[] = [
    { label: "Loan EMI", value: result.emi },
    ...(result.monthlyMaintenance > 0
      ? [{ label: "Society maintenance", value: result.monthlyMaintenance }]
      : []),
    ...(result.monthlyPropertyTax > 0
      ? [{ label: "Property tax", value: result.monthlyPropertyTax, note: "monthly share" }]
      : []),
  ];

  const upfrontRows: { label: string; value: number; note?: string }[] = [
    { label: "Down payment", value: downPayment },
    {
      label: "Stamp duty",
      value: result.stampDuty,
      note: femaleBuyer ? "female buyer rate" : undefined,
    },
    { label: "Registration", value: result.registrationFee },
    { label: "Loan processing fee", value: result.processingFee, note: "typical" },
  ];

  return (
    <section className="rounded-card border border-sand-200 bg-white p-6">
      <h2 className="font-display text-xl font-semibold text-sand-950">
        EMI &amp; cost estimate
      </h2>

      <p className="mt-4 font-display text-4xl font-semibold text-brand-800">
        {formatPrice(Math.round(result.totalMonthly))}
        <span className="ml-1 text-base font-normal text-sand-600">/month</span>
      </p>

      <dl className="mt-5 space-y-2 border-t border-sand-100 pt-4 text-sm">
        {monthlyRows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="text-sand-700">
              {row.label}
              {row.note && (
                <span className="ml-1.5 text-xs text-sand-500">({row.note})</span>
              )}
            </dt>
            <dd className="font-medium tabular-nums text-sand-900">
              {formatPriceExact(Math.round(row.value))}
            </dd>
          </div>
        ))}
      </dl>

      {/*
       * The panel that distinguishes this from every other EMI calculator. Stamp duty and
       * registration are not financeable and are routinely left out of buyers' planning.
       */}
      <div className="mt-6 rounded-md bg-clay-50 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold text-clay-800">Cash needed upfront</h3>
          <p className="font-display text-xl font-semibold tabular-nums text-clay-800">
            {formatPrice(Math.round(result.upfrontCashRequired))}
          </p>
        </div>
        <dl className="mt-3 space-y-1.5 text-sm">
          {upfrontRows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4">
              <dt className="text-clay-700">
                {row.label}
                {row.note && (
                  <span className="ml-1.5 text-xs text-clay-600">({row.note})</span>
                )}
              </dt>
              <dd className="font-medium tabular-nums text-clay-900">
                {formatPriceExact(Math.round(row.value))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-clay-700">
          Stamp duty and registration cannot be included in a home loan — banks lend against the
          property value only. This amount must be arranged separately.
        </p>
      </div>

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
            max={propertyPrice}
            step={Math.max(50_000, Math.round(propertyPrice / 200))}
            value={downPayment}
            onChange={(e) => setDownPayment(Number(e.target.value))}
            className="w-full accent-brand-700"
          />
        </Field>

        {ltvTooHigh && (
          <p className="rounded-md bg-clay-100 px-3 py-2 text-xs leading-relaxed text-clay-700">
            Most lenders finance up to about {Math.round(MAX_TYPICAL_LTV * 100)}% of property
            value. At this down payment you would likely need to arrange more of the purchase
            yourself.
          </p>
        )}

        <Field id="interest-rate" label="Interest rate" value={`${interestRate.toFixed(2)}%`}>
          <input
            id="interest-rate"
            type="range"
            min={6}
            max={14}
            step={0.05}
            value={interestRate}
            onChange={(e) => setInterestRate(Number(e.target.value))}
            className="w-full accent-brand-700"
          />
        </Field>

        <fieldset>
          <legend className="text-sm font-medium text-sand-800">Loan tenure</legend>
          <div className="mt-2 flex gap-2">
            {[10, 15, 20, 30].map((years) => (
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

        {/*
         * Registering in a woman's name carries a lower stamp duty rate in Punjab, Chandigarh and
         * Haryana. It is a widely used and entirely legitimate saving worth surfacing — on a
         * ₹1 crore purchase the difference is around ₹2 lakh.
         */}
        <label className="flex items-start gap-2.5 text-sm text-sand-800">
          <input
            type="checkbox"
            checked={femaleBuyer}
            onChange={(e) => setFemaleBuyer(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-700"
          />
          <span>
            Registering in a woman&rsquo;s name
            <span className="block text-xs text-sand-500">
              Lower stamp duty rate applies in Punjab, Chandigarh and Haryana
            </span>
          </span>
        </label>
      </div>

      <div className="mt-5 space-y-2 border-t border-sand-100 pt-4 text-xs leading-relaxed text-sand-500">
        <p>
          Total interest over {termYears} years:{" "}
          <span className="font-medium text-sand-700">
            {formatPrice(Math.round(result.totalInterestOverTerm))}
          </span>
        </p>
        {/*
         * Not boilerplate for its own sake: presenting an estimate as a quote is a real
         * liability, and stamp duty rates in particular change in state budgets.
         */}
        <p>
          Estimate only. Actual EMI depends on your lender, credit profile and loan scheme. Stamp
          duty and registration rates are indicative and change periodically — confirm the current
          rates with the sub-registrar before budgeting.
        </p>
      </div>
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
