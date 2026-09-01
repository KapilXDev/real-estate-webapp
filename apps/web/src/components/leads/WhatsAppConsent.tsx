/**
 * The WhatsApp opt-in.
 *
 * ⚠️ UNTICKED BY DEFAULT, AND IT STAYS THAT WAY. A pre-ticked box is not consent in any regime
 * that takes the word seriously, and here the consequence is concrete rather than theoretical:
 * unsolicited commercial messaging is a regulatory problem in India, and a business number that
 * collects complaints gets removed by WhatsApp. That would cost the agent the single channel this
 * market actually runs on — worth far more than the marginal leads a pre-ticked box would add.
 *
 * ⚠️ IT SAYS WHAT WILL HAPPEN, IN WORDS, BEFORE IT HAPPENS. "You'll get a WhatsApp message
 * confirming this, and {agent} may follow up there." Consent to something unspecified is not
 * consent, and a buyer who receives a message they did not expect reports it — which is precisely
 * the outcome above.
 *
 * ⚠️ THE FORM MUST STILL WORK UNTICKED. This is an enquiry form, not a subscription gate: someone
 * who does not want WhatsApp still gets to reach the agent, and the agent still gets the lead and
 * calls them. Making it required would trade leads for a channel preference.
 */
export function WhatsAppConsent({ agentName }: { agentName: string }) {
  return (
    <label className="flex items-start gap-2.5 text-sm leading-relaxed text-sand-700">
      <input
        type="checkbox"
        name="whatsappOptIn"
        /* No `defaultChecked`. Stated rather than merely omitted, because adding it is a one-word
         * change that somebody will eventually make to "improve conversion". */
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-sand-300 text-brand-700 focus:ring-brand-600"
      />
      <span>
        Message me on WhatsApp. You&rsquo;ll get an instant confirmation, and {agentName} may
        follow up there — usually the fastest way to hear back. Reply STOP any time.
      </span>
    </label>
  );
}
