//! Redline evidence registry. Records which exact agent version was tested, by whom, on which
//! committed suite, with what result. Hashes only. Nothing here is ever edited or deleted.
//! See contracts/evidence/README.md.

use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, IterableSet};
use near_sdk::{env, near, AccountId, BorshStorageKey, PanicOnDefault};

/// After this long with no result, anyone can close a run as FAILED and NOT_ASSESSED, so every
/// registered run reaches a terminal state.
pub const RUN_DEADLINE_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;

pub const MAX_ISSUERS: u32 = 16;
pub const MAX_SUITES: u32 = 256;
pub const MAX_RUNS: u32 = 1024;
const MAX_TEXT_BYTES: usize = 64;
const MAX_PAGE: u32 = 100;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Issuers,
    Suites,
    Runs,
}

/// Same strings as `EvaluationReportSchema.execution_status`. `Registered` is the only non-terminal state.
#[near(serializers = [json, borsh])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecutionStatus {
    Registered,
    Completed,
    Partial,
    Failed,
}

/// Same strings as `EvaluationReportSchema.assessment_outcome`.
#[near(serializers = [json, borsh])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssessmentOutcome {
    MetThresholds,
    BelowThresholds,
    NotAssessed,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SuiteMetadata {
    pub name: String,
    pub version: String,
    pub case_count: u32,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct StoredSuite {
    metadata: SuiteMetadata,
    issuer: AccountId,
    committed_at_ns: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct StoredRun {
    manifest_digest: String,
    suite_commitment: String,
    issuer: AccountId,
    registered_at_ns: u64,
    execution_status: ExecutionStatus,
    assessment_outcome: Option<AssessmentOutcome>,
    report_digest: Option<String>,
    finished_at_ns: Option<u64>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SuiteView {
    pub commitment: String,
    pub metadata: SuiteMetadata,
    pub issuer: AccountId,
    pub committed_at_ns: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RunView {
    pub run_id: String,
    pub manifest_digest: String,
    pub suite_commitment: String,
    pub issuer: AccountId,
    pub registered_at_ns: U64,
    pub execution_status: ExecutionStatus,
    pub assessment_outcome: Option<AssessmentOutcome>,
    pub report_digest: Option<String>,
    pub finished_at_ns: Option<U64>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Evidence {
    owner: AccountId,
    issuers: IterableSet<AccountId>,
    suites: IterableMap<String, StoredSuite>,
    runs: IterableMap<String, StoredRun>,
}

#[near]
impl Evidence {
    #[init]
    #[private]
    pub fn new(owner: AccountId, issuers: Vec<AccountId>) -> Self {
        let mut contract = Self {
            owner,
            issuers: IterableSet::new(StorageKey::Issuers),
            suites: IterableMap::new(StorageKey::Suites),
            runs: IterableMap::new(StorageKey::Runs),
        };
        if issuers.len() > MAX_ISSUERS as usize {
            fail("E_CAPACITY_FULL");
        }
        for issuer in issuers {
            contract.issuers.insert(issuer);
        }
        contract
    }

    /// Owner only. Issuers can only be added: removing one would rewrite who may have published.
    pub fn add_issuer(&mut self, issuer: AccountId) {
        if env::predecessor_account_id() != self.owner {
            fail("E_NOT_OWNER");
        }
        if self.issuers.len() >= MAX_ISSUERS {
            fail("E_CAPACITY_FULL");
        }
        self.issuers.insert(issuer);
    }

    pub fn commit_suite(&mut self, commitment: String, metadata: SuiteMetadata) {
        let issuer = self.assert_issuer();
        check(is_digest(&commitment));
        check(is_text(&metadata.name) && is_text(&metadata.version));
        if self.suites.contains_key(&commitment) {
            fail("E_DUPLICATE_SUITE");
        }
        if self.suites.len() >= MAX_SUITES {
            fail("E_CAPACITY_FULL");
        }
        emit(
            "suite_committed",
            json!({ "commitment": commitment, "issuer": issuer, "case_count": metadata.case_count }),
        );
        self.suites.insert(
            commitment,
            StoredSuite {
                metadata,
                issuer,
                committed_at_ns: env::block_timestamp(),
            },
        );
    }

    /// `issuer` must be the signer of record, so nobody can register a run in another's name.
    pub fn register_run(
        &mut self,
        run_id: String,
        manifest_digest: String,
        suite_commitment: String,
        issuer: AccountId,
    ) {
        let caller = self.assert_issuer();
        if caller != issuer {
            fail("E_ISSUER_MISMATCH");
        }
        check(is_text(&run_id));
        check(is_digest(&manifest_digest));
        if !self.suites.contains_key(&suite_commitment) {
            fail("E_UNKNOWN_SUITE");
        }
        if self.runs.contains_key(&run_id) {
            fail("E_DUPLICATE_RUN");
        }
        if self.runs.len() >= MAX_RUNS {
            fail("E_CAPACITY_FULL");
        }
        emit(
            "run_registered",
            json!({
                "run_id": run_id,
                "manifest_digest": manifest_digest,
                "suite_commitment": suite_commitment,
                "issuer": issuer,
            }),
        );
        self.runs.insert(
            run_id,
            StoredRun {
                manifest_digest,
                suite_commitment,
                issuer,
                registered_at_ns: env::block_timestamp(),
                execution_status: ExecutionStatus::Registered,
                assessment_outcome: None,
                report_digest: None,
                finished_at_ns: None,
            },
        );
    }

    /// Only the run's issuer, exactly once. A run that did not complete cannot claim an assessment.
    pub fn publish_result(
        &mut self,
        run_id: String,
        report_digest: String,
        execution_status: ExecutionStatus,
        assessment_outcome: AssessmentOutcome,
    ) {
        check(is_digest(&report_digest));
        check(execution_status != ExecutionStatus::Registered);
        check(
            execution_status == ExecutionStatus::Completed
                || assessment_outcome == AssessmentOutcome::NotAssessed,
        );
        let caller = env::predecessor_account_id();
        let run = match self.runs.get_mut(&run_id) {
            Some(run) => run,
            None => fail("E_UNKNOWN_RUN"),
        };
        if run.issuer != caller {
            fail("E_NOT_RUN_ISSUER");
        }
        if run.execution_status != ExecutionStatus::Registered {
            fail("E_RUN_FINISHED");
        }
        run.execution_status = execution_status;
        run.assessment_outcome = Some(assessment_outcome);
        run.report_digest = Some(report_digest.clone());
        run.finished_at_ns = Some(env::block_timestamp());
        emit(
            "result_published",
            json!({
                "run_id": run_id,
                "report_digest": report_digest,
                "execution_status": execution_status,
                "assessment_outcome": assessment_outcome,
            }),
        );
    }

    /// Anyone, once the deadline has passed with no result.
    pub fn expire_run(&mut self, run_id: String) {
        let now = env::block_timestamp();
        let run = match self.runs.get_mut(&run_id) {
            Some(run) => run,
            None => fail("E_UNKNOWN_RUN"),
        };
        if run.execution_status != ExecutionStatus::Registered {
            fail("E_RUN_FINISHED");
        }
        if now < run.registered_at_ns.saturating_add(RUN_DEADLINE_NS) {
            fail("E_DEADLINE_NOT_REACHED");
        }
        run.execution_status = ExecutionStatus::Failed;
        run.assessment_outcome = Some(AssessmentOutcome::NotAssessed);
        run.finished_at_ns = Some(now);
        emit("run_expired", json!({ "run_id": run_id }));
    }

    pub fn get_suite(&self, commitment: String) -> Option<SuiteView> {
        self.suites.get(&commitment).map(|suite| SuiteView {
            commitment: commitment.clone(),
            metadata: suite.metadata.clone(),
            issuer: suite.issuer.clone(),
            committed_at_ns: U64(suite.committed_at_ns),
        })
    }

    pub fn get_run(&self, run_id: String) -> Option<RunView> {
        self.runs.get(&run_id).map(|run| run_view(&run_id, run))
    }

    pub fn get_runs(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<RunView> {
        self.runs
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize)
            .map(|(run_id, run)| run_view(run_id, run))
            .collect()
    }

    pub fn get_issuers(&self) -> Vec<AccountId> {
        self.issuers.iter().cloned().collect()
    }
}

impl Evidence {
    fn assert_issuer(&self) -> AccountId {
        let caller = env::predecessor_account_id();
        if !self.issuers.contains(&caller) {
            fail("E_NOT_ISSUER");
        }
        caller
    }
}

fn run_view(run_id: &str, run: &StoredRun) -> RunView {
    RunView {
        run_id: run_id.to_string(),
        manifest_digest: run.manifest_digest.clone(),
        suite_commitment: run.suite_commitment.clone(),
        issuer: run.issuer.clone(),
        registered_at_ns: U64(run.registered_at_ns),
        execution_status: run.execution_status,
        assessment_outcome: run.assessment_outcome,
        report_digest: run.report_digest.clone(),
        finished_at_ns: run.finished_at_ns.map(U64),
    }
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    let envelope = json!({
        "standard": "redline",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{envelope}"));
}

fn fail(code: &str) -> ! {
    env::panic_str(code)
}

fn check(ok: bool) {
    if !ok {
        fail("E_INVALID_INPUT");
    }
}

fn is_text(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_TEXT_BYTES
}

fn is_digest(value: &str) -> bool {
    match value.strip_prefix("sha256:") {
        Some(hex) => {
            hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const SUITE: &str = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    const MANIFEST: &str = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
    const REPORT: &str = "sha256:3333333333333333333333333333333333333333333333333333333333333333";

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn at(caller: &str, now: u64) {
        let mut context = VMContextBuilder::new();
        context
            .current_account_id(account("evidence.test"))
            .predecessor_account_id(account(caller))
            .signer_account_id(account(caller))
            .block_timestamp(now);
        testing_env!(context.build());
    }

    fn registry_with_run() -> Evidence {
        at("evidence.test", 1);
        let mut evidence = Evidence::new(account("owner.test"), vec![account("lucy.test")]);
        at("lucy.test", 1);
        evidence.commit_suite(
            SUITE.to_string(),
            SuiteMetadata {
                name: "dev".to_string(),
                version: "1".to_string(),
                case_count: 12,
            },
        );
        evidence.register_run(
            "run_1".to_string(),
            MANIFEST.to_string(),
            SUITE.to_string(),
            account("lucy.test"),
        );
        evidence
    }

    #[test]
    fn run_reaches_terminal_state_and_records_issuer() {
        let mut evidence = registry_with_run();
        evidence.publish_result(
            "run_1".to_string(),
            REPORT.to_string(),
            ExecutionStatus::Completed,
            AssessmentOutcome::MetThresholds,
        );
        let run = evidence.get_run("run_1".to_string()).unwrap();
        assert_eq!(run.execution_status, ExecutionStatus::Completed);
        assert_eq!(run.issuer, account("lucy.test"));
        assert_eq!(run.report_digest.as_deref(), Some(REPORT));
    }

    #[test]
    #[should_panic(expected = "E_RUN_FINISHED")]
    fn result_cannot_be_rewritten() {
        let mut evidence = registry_with_run();
        for _ in 0..2 {
            evidence.publish_result(
                "run_1".to_string(),
                REPORT.to_string(),
                ExecutionStatus::Completed,
                AssessmentOutcome::BelowThresholds,
            );
        }
    }

    #[test]
    #[should_panic(expected = "E_DUPLICATE_SUITE")]
    fn suite_cannot_be_overwritten() {
        let mut evidence = registry_with_run();
        evidence.commit_suite(
            SUITE.to_string(),
            SuiteMetadata {
                name: "other".to_string(),
                version: "2".to_string(),
                case_count: 1,
            },
        );
    }

    #[test]
    #[should_panic(expected = "E_DUPLICATE_RUN")]
    fn run_id_cannot_be_reused() {
        let mut evidence = registry_with_run();
        evidence.register_run(
            "run_1".to_string(),
            MANIFEST.to_string(),
            SUITE.to_string(),
            account("lucy.test"),
        );
    }

    #[test]
    #[should_panic(expected = "E_NOT_ISSUER")]
    fn unlisted_account_cannot_commit() {
        let mut evidence = registry_with_run();
        at("mallory.test", 2);
        evidence.commit_suite(
            "sha256:4444444444444444444444444444444444444444444444444444444444444444".to_string(),
            SuiteMetadata {
                name: "x".to_string(),
                version: "1".to_string(),
                case_count: 1,
            },
        );
    }

    #[test]
    #[should_panic(expected = "E_ISSUER_MISMATCH")]
    fn cannot_register_in_another_issuers_name() {
        let mut evidence = registry_with_run();
        evidence.register_run(
            "run_2".to_string(),
            MANIFEST.to_string(),
            SUITE.to_string(),
            account("owner.test"),
        );
    }

    #[test]
    #[should_panic(expected = "E_NOT_RUN_ISSUER")]
    fn only_the_runs_issuer_publishes() {
        let mut evidence = registry_with_run();
        at("owner.test", 2);
        evidence.publish_result(
            "run_1".to_string(),
            REPORT.to_string(),
            ExecutionStatus::Completed,
            AssessmentOutcome::MetThresholds,
        );
    }

    #[test]
    #[should_panic(expected = "E_INVALID_INPUT")]
    fn partial_run_cannot_claim_an_assessment() {
        let mut evidence = registry_with_run();
        evidence.publish_result(
            "run_1".to_string(),
            REPORT.to_string(),
            ExecutionStatus::Partial,
            AssessmentOutcome::MetThresholds,
        );
    }

    #[test]
    #[should_panic(expected = "E_DEADLINE_NOT_REACHED")]
    fn expire_waits_for_deadline() {
        let mut evidence = registry_with_run();
        at("anyone.test", RUN_DEADLINE_NS);
        evidence.expire_run("run_1".to_string());
    }

    #[test]
    fn silent_run_can_be_closed_by_anyone_after_deadline() {
        let mut evidence = registry_with_run();
        at("anyone.test", 1 + RUN_DEADLINE_NS);
        evidence.expire_run("run_1".to_string());
        let run = evidence.get_run("run_1".to_string()).unwrap();
        assert_eq!(run.execution_status, ExecutionStatus::Failed);
        assert_eq!(run.assessment_outcome, Some(AssessmentOutcome::NotAssessed));
        assert_eq!(run.report_digest, None);
    }
}
