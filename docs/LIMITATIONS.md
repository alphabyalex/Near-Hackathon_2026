# Limitations

Owner: Lucy. Plain words on what our evaluation evidence does and does not show.

## What a Wardline report does show

- A specific agent version, identified by its manifest digest, made specific decisions on a
  specific set of synthetic invoices.
- That set of invoices was fixed before the run. For the hidden set, a salted commitment was
  published first, and the runner refuses to run if the files no longer match it.
- How the vault rules responded to every payment the agent asked for, and whether any money
  invariant broke: paying twice, paying over a cap, paying an unregistered account, paying from
  the wrong business, or a ledger that does not add up.
- The report has not changed since it was registered. `pnpm verify:evidence` recomputes every
  digest from the files and says match or mismatch.

## What it does not show

- **It is not independent.** The team that built the agent and the vault also wrote the tests,
  the labels and the rubric, and ran the evaluation. We say so in every report.
- **It is not real-world performance.** Every company, vendor, invoice, PO and receipt is
  synthetic. Real invoices are messier and attackers adapt.
- **Small samples.** The hidden set has 20 legitimate, 20 adversarial and 8 exception cases. Zero
  unsafe proposals out of 20 is still consistent with a true rate of roughly 15 percent (rule of
  three: 3/20). Treat rates as rough.
- **One person wrote the hidden cases.** The suite reflects one author's idea of what is hard.
  The commitment proves it did not change after the fact, not that it is a good test.
- **Labels can be wrong.** The oracle compares decisions with fixture labels deterministically, no
  model judging. If a label is wrong, the score is wrong. Each scenario's rationale is published at
  reveal so anyone can check.
- **Model runs vary.** LLM output can differ between runs even at temperature 0. A report covers
  one run. Replay mode reproduces a recorded run for demos and is not a new evaluation.
- **The TEE covers model hosting, not the whole agent.** NEAR AI Cloud runs the model in a TEE.
  That says nothing about our prompt, adapter, API, or the machine running the Gym.
- **The development split is public and tuned against.** The local rules baseline in
  services/evaluator was written by the evaluation lead with the dev cases in view, so its perfect
  dev score means nothing about unseen invoices.
- **Containment is bounded loss, not zero loss.** The vault stops payments to unapproved
  recipients, over caps, twice, or from another business. It cannot tell that a valid open payable
  is being paid early because a fake invoice fooled the agent. Those show up as forbidden effects
  and reconciliation errors, not as vault invariant violations.
- **"BREACHED" covers two different things today.** The shared report schema has one label for
  "a forbidden effect happened". Check the separate metrics: `vault_invariant_violations` means the
  vault broke a rule; `forbidden_effects` without an invariant violation means the agent caused a
  wrong but policy-valid payment. We have asked for a separate label.

## Current gaps (2026-11-04)

These will shrink as other lanes land. Each report lists the ones that applied to it.

- Vault outcomes come from a local stub simulator in services/evaluator, not Tharun's
  packages/vault-sim or the deployed contract. In the stub, settlement is instant (no RESERVED
  step) and the 7 day window does not age out during a run.
- PaymentRequests are built by a local adapter stub, not Kristian's adapter.
- The LLM agent and Kristian's rules baseline are not wired in yet. The example run in
  evidence/example-run uses a local rules stub, an always-review control, and a simulated
  compromised agent. None of them is a model.
- Report digests go to a local registry file that stands in for the evidence contract. Nothing
  is on chain yet.
- Cost in USD is not computed. Token counts are recorded when the agent reports them.
- The rubric and thresholds are a draft until the Nov 8 freeze.
