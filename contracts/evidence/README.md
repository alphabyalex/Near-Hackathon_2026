# contracts/evidence

Owner: Tharun

Evidence registry. Records which exact agent version was tested, by whom, on which committed suite, with what result. It stores hashes only, and nothing here is ever edited or deleted. It proves a result was not quietly swapped after publication. It does not prove the result is true: the issuer is our team, and we say so.

## Methods

| Method | Who | Rule |
| --- | --- | --- |
| `new(owner, issuers)` | The contract account, once | Starts with a list of issuers. At most 16. |
| `add_issuer(issuer)` | Owner | Issuers can be added and never removed, so past publications stay attributable. |
| `commit_suite(commitment, metadata)` | Issuer | `metadata` is `name`, `version`, `case_count`. A commitment can only be written once. |
| `register_run(run_id, manifest_digest, suite_commitment, issuer)` | Issuer, in its own name | The suite must be committed. A run id can only be used once. |
| `publish_result(run_id, report_digest, execution_status, assessment_outcome)` | That run's issuer, once | `execution_status` is COMPLETED, PARTIAL or FAILED. Anything but COMPLETED must be NOT_ASSESSED. |
| `expire_run(run_id)` | Anyone, 7 days after registration with no result | Closes it as FAILED and NOT_ASSESSED. |

Views: `get_suite`, `get_run`, `get_runs(from_index, limit)`, `get_issuers`.

**Every registered run reaches a terminal state:** the issuer publishes one, or anyone closes it after the deadline. A failed or unflattering run cannot just disappear.

Statuses use the same strings as `EvaluationReportSchema`, plus `REGISTERED` for the one non-terminal state. Bounds: 256 suites, 1024 runs. Events use the NEP-297 standard `wardline`: `suite_committed`, `run_registered`, `result_published`, `run_expired`.

## Testing

`cargo test -p wardline-evidence` and `tests/sandbox/test/evidence.test.ts`.
