use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{U64, U128};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{AccountId, PublicKey};

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct CapacityLimits {
    pub max_vendors: u32,
    pub max_payables: u32,
    pub max_operations: u32,
    pub max_pending_operations: u32,
    pub max_rolling_entries: u32,
    pub max_identifier_length: u32,
    pub max_digest_length: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct VaultConfig {
    pub owner_id: AccountId,
    pub guardian_id: Option<AccountId>,
    pub token_contract_id: AccountId,
    pub token_decimals: u8,
    pub weekly_cap_atomic: U128,
    pub lifetime_ceiling_atomic: U128,
    pub capacities: CapacityLimits,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Policy {
    pub weekly_cap_atomic: U128,
    pub lifetime_ceiling_atomic: U128,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PolicyChange {
    pub weekly_cap_atomic: U128,
    pub lifetime_ceiling_atomic: U128,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct VendorInput {
    pub vendor_id: String,
    pub recipient: AccountId,
    pub per_payment_cap_atomic: U128,
    pub enabled: bool,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Vendor {
    pub vendor_id: String,
    pub recipient: AccountId,
    pub per_payment_cap_atomic: U128,
    pub enabled: bool,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PayableInput {
    pub payable_ref: String,
    pub vendor_id: String,
    pub vendor_revision: u64,
    pub amount_atomic: U128,
    pub po_number: String,
    pub not_before_ns: U64,
    pub due_at_ns: U64,
    pub expires_at_ns: U64,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PayableStatus {
    #[default]
    Open,
    PendingAgent,
    PendingOwner,
    Settled,
    FailedKnown,
    Reconciliation,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Payable {
    pub payable_ref: String,
    pub vendor_id: String,
    pub vendor_revision: u64,
    pub recipient: AccountId,
    pub amount_atomic: U128,
    pub po_number: String,
    pub not_before_ns: U64,
    pub due_at_ns: U64,
    pub expires_at_ns: U64,
    pub status: PayableStatus,
    pub operation_id: Option<U64>,
    pub request_digest: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct AgentBindingInput {
    pub account_id: AccountId,
    pub public_key: PublicKey,
    pub manifest_digest: String,
    pub valid_from_ns: U64,
    pub expires_at_ns: U64,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct AgentBinding {
    pub account_id: AccountId,
    pub public_key: PublicKey,
    pub manifest_digest: String,
    pub valid_from_ns: U64,
    pub expires_at_ns: U64,
    pub enabled: bool,
    pub revision: u64,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OperationActor {
    Agent,
    Owner,
    Withdrawal,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OperationStatus {
    #[default]
    Dispatched,
    Settled,
    FailedKnown,
    Reconciliation,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde")]
pub struct Operation {
    pub operation_id: U64,
    pub actor: OperationActor,
    pub payable_ref: Option<String>,
    pub request_digest: Option<String>,
    pub amount_atomic: U128,
    pub recipient: AccountId,
    pub created_at_ns: U64,
    pub status: OperationStatus,
    pub settled_at_ns: Option<U64>,
    pub failure_category: Option<String>,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq)]
#[borsh(crate = "near_sdk::borsh")]
pub struct RollingEntry {
    pub operation_id: u64,
    pub amount_atomic: u128,
    pub settled_at_ns: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PaymentRequest {
    pub payable_ref: String,
    pub request_digest: String,
    pub expected_policy_revision: u64,
    pub expected_vendor_revision: u64,
    pub expected_binding_revision: u64,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum VaultRejectionCode {
    VaultPaused,
    NonZeroAttachedDeposit,
    CallerSignerMismatch,
    AgentAccountMismatch,
    AgentKeyMismatch,
    AgentBindingDisabled,
    AgentBindingNotYetValid,
    AgentBindingExpired,
    StaleBindingRevision,
    UnknownPayable,
    PayableNotOpen,
    PayableTooEarly,
    PayableExpired,
    RequestDigestConflict,
    InvalidRequestDigest,
    UnknownVendor,
    VendorDisabled,
    StaleVendorRevision,
    StalePolicyRevision,
    AmountOverVendorCap,
    WeeklyCapExceeded,
    LifetimeCeilingExceeded,
    InsufficientRecordedBalance,
    PendingCapacityExhausted,
    RollingCapacityExhausted,
    OperationCapacityExhausted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct UsageView {
    pub settled_agent_total_atomic: U128,
    pub reserved_agent_total_atomic: U128,
    pub owner_paid_total_atomic: U128,
    pub rolling_settled_atomic: U128,
    pub weekly_cap_atomic: U128,
    pub lifetime_ceiling_atomic: U128,
    pub recorded_balance_atomic: U128,
    pub available_balance_atomic: U128,
    pub pending_operations: u32,
    pub pending_agent_operations: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct VaultRejection {
    pub code: VaultRejectionCode,
    pub human_review: bool,
    pub payable_ref: Option<String>,
    pub requested_amount_atomic: Option<U128>,
    pub policy_revision: u64,
    pub vendor_revision: Option<u64>,
    pub binding_revision: Option<u64>,
    pub usage: UsageView,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RequestResult {
    pub accepted: bool,
    pub existing: bool,
    pub operation_id: Option<U64>,
    pub status: Option<PayableStatus>,
    pub rejection: Option<VaultRejection>,
}

impl RequestResult {
    pub fn accepted(operation_id: u64, status: PayableStatus, existing: bool) -> Self {
        Self {
            accepted: true,
            existing,
            operation_id: Some(U64(operation_id)),
            status: Some(status),
            rejection: None,
        }
    }

    pub fn rejected(rejection: VaultRejection) -> Self {
        Self {
            accepted: false,
            existing: false,
            operation_id: None,
            status: None,
            rejection: Some(rejection),
        }
    }
}
