use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::UnorderedMap;
use near_sdk::json_types::U64;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, env, near, require};

const STANDARD: &str = "spendgym";
const VERSION: &str = "1.0.0";
const MAX_VIEW_PAGE: u32 = 100;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Suites,
    Runs,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EvidenceConfig {
    pub owner_id: AccountId,
    pub max_suites: u32,
    pub max_runs: u32,
    pub max_identifier_length: u32,
    pub max_digest_length: u32,
    pub max_metadata_length: u32,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct SuiteCommitment {
    pub commitment: String,
    pub metadata: String,
    pub committed_by: AccountId,
    pub committed_at_ns: U64,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutionStatus {
    Completed,
    Aborted,
    InfrastructureError,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssessmentOutcome {
    Pass,
    Fail,
    Inconclusive,
    NotAssessed,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunState {
    Registered,
    Published,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct RunRecord {
    pub run_id: String,
    pub manifest_digest: String,
    pub suite_commitment: String,
    pub issuer: AccountId,
    pub registered_at_ns: U64,
    pub state: RunState,
    pub report_digest: Option<String>,
    pub execution_status: Option<ExecutionStatus>,
    pub assessment_outcome: Option<AssessmentOutcome>,
    pub published_at_ns: Option<U64>,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct EvidenceRegistry {
    owner_id: AccountId,
    max_suites: u32,
    max_runs: u32,
    max_identifier_length: u32,
    max_digest_length: u32,
    max_metadata_length: u32,
    suites: UnorderedMap<String, SuiteCommitment>,
    runs: UnorderedMap<String, RunRecord>,
}

#[near]
impl EvidenceRegistry {
    #[init]
    pub fn new(config: EvidenceConfig) -> Self {
        require!(!env::state_exists(), "already initialized");
        require!(config.max_suites > 0, "max_suites must be positive");
        require!(config.max_runs > 0, "max_runs must be positive");
        require!(
            config.max_identifier_length > 0,
            "max_identifier_length must be positive"
        );
        require!(
            config.max_digest_length > 0,
            "max_digest_length must be positive"
        );
        require!(
            config.max_metadata_length > 0,
            "max_metadata_length must be positive"
        );
        let contract = Self {
            owner_id: config.owner_id,
            max_suites: config.max_suites,
            max_runs: config.max_runs,
            max_identifier_length: config.max_identifier_length,
            max_digest_length: config.max_digest_length,
            max_metadata_length: config.max_metadata_length,
            suites: UnorderedMap::new(StorageKey::Suites),
            runs: UnorderedMap::new(StorageKey::Runs),
        };
        contract.emit(
            "evidence_registry_initialized",
            near_sdk::serde_json::json!({
                "owner_id": contract.owner_id.clone(),
                "max_suites": contract.max_suites,
                "max_runs": contract.max_runs,
            }),
        );
        contract
    }

    pub fn commit_suite(&mut self, commitment: String, metadata: String) -> SuiteCommitment {
        self.assert_owner();
        self.assert_digest(&commitment, "suite commitment");
        require!(
            metadata.len() <= self.max_metadata_length as usize,
            "suite metadata is too long"
        );
        require!(
            self.suites.get(&commitment).is_none(),
            "suite already committed"
        );
        require!(
            self.suites.len() < u64::from(self.max_suites),
            "suite capacity exhausted"
        );
        let record = SuiteCommitment {
            commitment: commitment.clone(),
            metadata,
            committed_by: env::predecessor_account_id(),
            committed_at_ns: U64(env::block_timestamp()),
        };
        self.suites.insert(&commitment, &record);
        self.emit(
            "suite_committed",
            near_sdk::serde_json::to_value(&record).expect("suite serializes"),
        );
        record
    }

    pub fn register_run(
        &mut self,
        run_id: String,
        manifest_digest: String,
        suite_commitment: String,
        issuer: AccountId,
    ) -> RunRecord {
        self.assert_owner();
        self.assert_identifier(&run_id, "run id");
        self.assert_digest(&manifest_digest, "manifest digest");
        self.assert_digest(&suite_commitment, "suite commitment");
        require!(
            issuer == env::predecessor_account_id(),
            "issuer must sign registration"
        );
        require!(
            self.suites.get(&suite_commitment).is_some(),
            "suite is not committed"
        );
        require!(self.runs.get(&run_id).is_none(), "run id already exists");
        require!(
            self.runs.len() < u64::from(self.max_runs),
            "run capacity exhausted"
        );
        let record = RunRecord {
            run_id: run_id.clone(),
            manifest_digest,
            suite_commitment,
            issuer,
            registered_at_ns: U64(env::block_timestamp()),
            state: RunState::Registered,
            report_digest: None,
            execution_status: None,
            assessment_outcome: None,
            published_at_ns: None,
        };
        self.runs.insert(&run_id, &record);
        self.emit(
            "run_registered",
            near_sdk::serde_json::to_value(&record).expect("run serializes"),
        );
        record
    }

    pub fn publish_result(
        &mut self,
        run_id: String,
        report_digest: String,
        execution_status: ExecutionStatus,
        assessment_outcome: AssessmentOutcome,
    ) -> RunRecord {
        self.assert_owner();
        self.assert_digest(&report_digest, "report digest");
        let mut run = self
            .runs
            .get(&run_id)
            .unwrap_or_else(|| env::panic_str("unknown run id"));
        require!(
            run.issuer == env::predecessor_account_id(),
            "only issuer may publish result"
        );
        require!(
            run.state == RunState::Registered,
            "run result is already terminal"
        );
        if execution_status != ExecutionStatus::Completed {
            require!(
                assessment_outcome == AssessmentOutcome::NotAssessed
                    || assessment_outcome == AssessmentOutcome::Inconclusive,
                "non-completed execution cannot publish pass or fail"
            );
        }
        run.state = RunState::Published;
        run.report_digest = Some(report_digest);
        run.execution_status = Some(execution_status);
        run.assessment_outcome = Some(assessment_outcome);
        run.published_at_ns = Some(U64(env::block_timestamp()));
        self.runs.insert(&run_id, &run);
        self.emit(
            "result_published",
            near_sdk::serde_json::to_value(&run).expect("run serializes"),
        );
        run
    }

    pub fn get_suite(&self, commitment: String) -> Option<SuiteCommitment> {
        self.suites.get(&commitment)
    }

    pub fn get_run(&self, run_id: String) -> Option<RunRecord> {
        self.runs.get(&run_id)
    }

    pub fn list_runs(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<RunRecord> {
        let from = usize::try_from(from_index.unwrap_or(U64(0)).0).unwrap_or(usize::MAX);
        let count =
            usize::try_from(limit.unwrap_or(50).min(MAX_VIEW_PAGE)).expect("view limit fits usize");
        self.runs
            .iter()
            .skip(from)
            .take(count)
            .map(|(_, run)| run)
            .collect()
    }

    pub fn list_open_runs(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<RunRecord> {
        let from = usize::try_from(from_index.unwrap_or(U64(0)).0).unwrap_or(usize::MAX);
        let count =
            usize::try_from(limit.unwrap_or(50).min(MAX_VIEW_PAGE)).expect("view limit fits usize");
        self.runs
            .iter()
            .filter(|(_, run)| run.state == RunState::Registered)
            .skip(from)
            .take(count)
            .map(|(_, run)| run)
            .collect()
    }

    pub fn get_config(&self) -> EvidenceConfig {
        EvidenceConfig {
            owner_id: self.owner_id.clone(),
            max_suites: self.max_suites,
            max_runs: self.max_runs,
            max_identifier_length: self.max_identifier_length,
            max_digest_length: self.max_digest_length,
            max_metadata_length: self.max_metadata_length,
        }
    }
}

impl EvidenceRegistry {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "owner signature required"
        );
    }

    fn assert_identifier(&self, value: &str, label: &str) {
        require!(
            !value.is_empty() && value.len() <= self.max_identifier_length as usize,
            format!("{label} length is invalid")
        );
    }

    fn assert_digest(&self, value: &str, label: &str) {
        require!(
            !value.is_empty() && value.len() <= self.max_digest_length as usize,
            format!("{label} length is invalid")
        );
    }

    fn emit(&self, event: &str, data: near_sdk::serde_json::Value) {
        let value = near_sdk::serde_json::json!({
            "standard": STANDARD,
            "version": VERSION,
            "event": event,
            "data": [data],
        });
        env::log_str(&format!("EVENT_JSON:{value}"));
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn account(value: &str) -> AccountId {
        value.parse().expect("valid test account")
    }

    fn set_context(predecessor: &str, now: u64) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("evidence.testnet"))
            .predecessor_account_id(account(predecessor))
            .signer_account_id(account(predecessor))
            .block_timestamp(now);
        testing_env!(builder.build());
    }

    fn registry() -> EvidenceRegistry {
        set_context("issuer.testnet", 1);
        EvidenceRegistry::new(EvidenceConfig {
            owner_id: account("issuer.testnet"),
            max_suites: 4,
            max_runs: 8,
            max_identifier_length: 64,
            max_digest_length: 128,
            max_metadata_length: 256,
        })
    }

    #[test]
    fn records_suite_run_and_one_terminal_result() {
        let mut registry = registry();
        registry.commit_suite("sha256:suite".to_string(), "public metadata".to_string());
        registry.register_run(
            "run-1".to_string(),
            "sha256:manifest".to_string(),
            "sha256:suite".to_string(),
            account("issuer.testnet"),
        );
        let result = registry.publish_result(
            "run-1".to_string(),
            "sha256:report".to_string(),
            ExecutionStatus::Completed,
            AssessmentOutcome::Fail,
        );
        assert_eq!(result.state, RunState::Published);
        assert_eq!(registry.list_open_runs(None, None).len(), 0);
    }



    #[test]
    #[should_panic(expected = "non-completed execution cannot publish pass or fail")]
    fn aborted_execution_cannot_claim_pass() {
        let mut registry = registry();
        registry.commit_suite("sha256:suite".to_string(), String::new());
        registry.register_run(
            "run-aborted".to_string(),
            "sha256:manifest".to_string(),
            "sha256:suite".to_string(),
            account("issuer.testnet"),
        );
        registry.publish_result(
            "run-aborted".to_string(),
            "sha256:report".to_string(),
            ExecutionStatus::Aborted,
            AssessmentOutcome::Pass,
        );
    }

    #[test]
    #[should_panic(expected = "owner signature required")]
    fn non_owner_cannot_register_evidence() {
        let mut registry = registry();
        set_context("attacker.testnet", 2);
        registry.commit_suite("sha256:attacker-suite".to_string(), String::new());
    }
    #[test]
    #[should_panic(expected = "run result is already terminal")]
    fn terminal_result_cannot_be_replaced() {
        let mut registry = registry();
        registry.commit_suite("sha256:suite".to_string(), String::new());
        registry.register_run(
            "run-1".to_string(),
            "sha256:manifest".to_string(),
            "sha256:suite".to_string(),
            account("issuer.testnet"),
        );
        registry.publish_result(
            "run-1".to_string(),
            "sha256:report".to_string(),
            ExecutionStatus::Completed,
            AssessmentOutcome::Pass,
        );
        registry.publish_result(
            "run-1".to_string(),
            "sha256:replacement".to_string(),
            ExecutionStatus::Completed,
            AssessmentOutcome::Fail,
        );
    }
}
