//! Wire types and stored records. Names and JSON shapes match packages/schemas.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId, PublicKey};

/// Same strings as `VaultRejectionSchema`.
#[near(serializers = [json])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VaultRejection {
    UnknownPayable,
    AlreadyPaid,
    AlreadyPending,
    NotYetPayable,
    PayableExpired,
    StaleRevision,
    OverVendorCap,
    OverWeeklyCap,
    OverLifetimeCap,
    InsufficientBalance,
    CapacityFull,
    Paused,
    BindingInactive,
    BadCaller,
}

/// Same shape as `RequestResultSchema`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RequestResult {
    pub ok: bool,
    pub operation_id: Option<String>,
    pub rejection: Option<VaultRejection>,
}

impl RequestResult {
    pub fn accepted(operation_id: String) -> Self {
        Self {
            ok: true,
            operation_id: Some(operation_id),
            rejection: None,
        }
    }

    pub fn rejected(rejection: VaultRejection) -> Self {
        Self {
            ok: false,
            operation_id: None,
            rejection: Some(rejection),
        }
    }
}

/// Same strings as `PayableStatusSchema`. `Expired` is derived in views and never stored.
#[near(serializers = [json, borsh])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayableStatus {
    Open,
    Pending,
    Settled,
    FailedKnown,
    Cancelled,
    Expired,
}

/// Same strings as `OperationStatusSchema`, minus `REQUESTED`, which only the API uses.
#[near(serializers = [json, borsh])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationStatus {
    Reserved,
    Settled,
    FailedKnown,
    OutcomeUncertain,
}

#[near(serializers = [json, borsh])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    Agent,
    Owner,
}

impl Origin {
    pub fn as_str(self) -> &'static str {
        match self {
            Origin::Agent => "AGENT",
            Origin::Owner => "OWNER",
        }
    }
}

// ---------- Inputs ----------

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PolicyInput {
    pub weekly_cap_atomic: U128,
    pub lifetime_cap_atomic: U128,
    pub expires_at_ns: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Capacities {
    pub max_vendors: u32,
    pub max_payables: u32,
    pub max_pending: u32,
    pub max_rolling: u32,
    pub max_operations: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct VaultConfig {
    pub owner: AccountId,
    pub guardian: Option<AccountId>,
    pub token_contract: AccountId,
    pub token_decimals: u8,
    pub policy: PolicyInput,
    pub capacities: Option<Capacities>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct VendorInput {
    pub vendor_id: String,
    pub display_name: String,
    pub account_id: AccountId,
    pub per_payment_cap_atomic: U128,
    pub active: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PayableInput {
    pub payable_ref: String,
    pub vendor_id: String,
    pub vendor_revision: u64,
    pub po_number: String,
    pub invoice_number: Option<String>,
    pub amount_atomic: U128,
    pub not_before_ns: U64,
    pub due_at_ns: U64,
    pub expires_at_ns: U64,
    pub evidence_commitment: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct BindingInput {
    pub agent_account_id: AccountId,
    pub public_key: PublicKey,
    pub manifest_digest: String,
    pub assessment_ref: String,
    pub expires_at_ns: U64,
}

// ---------- Stored records ----------

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct StoredVendor {
    pub display_name: String,
    pub account_id: AccountId,
    pub revision: u64,
    pub per_payment_cap: u128,
    pub active: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct StoredPayable {
    pub vendor_id: String,
    pub vendor_revision: u64,
    pub recipient: AccountId,
    pub po_number: String,
    pub invoice_number: Option<String>,
    pub amount: u128,
    pub not_before_ns: u64,
    pub due_at_ns: u64,
    pub expires_at_ns: u64,
    pub evidence_commitment: String,
    pub status: PayableStatus,
    pub attempts: u32,
    pub operation_id: Option<String>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct StoredPolicy {
    pub revision: u64,
    pub weekly_cap: u128,
    pub lifetime_cap: u128,
    pub expires_at_ns: u64,
    pub paused: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct StoredBinding {
    pub agent_account_id: AccountId,
    pub public_key: PublicKey,
    pub manifest_digest: String,
    pub assessment_ref: String,
    pub expires_at_ns: u64,
    pub enabled: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct StoredOperation {
    pub payable_ref: String,
    pub amount: u128,
    pub recipient: AccountId,
    pub status: OperationStatus,
    pub attempt: u32,
    pub reserved_at_ns: u64,
    pub resolved_at_ns: Option<u64>,
    pub origin: Origin,
    pub request_digest: Option<String>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug)]
pub struct RollingEntry {
    pub amount: u128,
    pub settled_at_ns: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug)]
pub struct WithdrawalInFlight {
    pub amount: u128,
    pub started_at_ns: u64,
    pub uncertain: bool,
}

// ---------- Views ----------

/// `VendorSchema`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct VendorView {
    pub vendor_id: String,
    pub display_name: String,
    pub account_id: AccountId,
    pub revision: u64,
    pub per_payment_cap_atomic: U128,
    pub active: bool,
}

/// `PayableSchema`, plus `recipient` and `operation_id`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PayableView {
    pub payable_ref: String,
    pub vault_id: AccountId,
    pub vendor_id: String,
    pub vendor_revision: u64,
    pub po_number: String,
    pub invoice_number: Option<String>,
    pub amount_atomic: U128,
    pub token_contract_id: AccountId,
    pub not_before_ns: U64,
    pub due_at_ns: U64,
    pub expires_at_ns: U64,
    pub evidence_commitment: String,
    pub status: PayableStatus,
    pub recipient: AccountId,
    pub operation_id: Option<String>,
}

/// `PolicySchema`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PolicyView {
    pub revision: u64,
    pub weekly_cap_atomic: U128,
    pub lifetime_cap_atomic: U128,
    pub expires_at_ns: U64,
    pub paused: bool,
}

/// `AgentBindingSchema`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct BindingView {
    pub agent_account_id: AccountId,
    pub public_key: PublicKey,
    pub manifest_digest: String,
    pub assessment_ref: String,
    pub revision: u64,
    pub expires_at_ns: U64,
    pub enabled: bool,
}

/// `OperationSchema`, plus `origin` and `request_digest`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct OperationView {
    pub operation_id: String,
    pub payable_ref: String,
    pub amount_atomic: U128,
    pub recipient: AccountId,
    pub status: OperationStatus,
    pub attempt: u32,
    pub reserved_at_ns: U64,
    pub resolved_at_ns: Option<U64>,
    pub tx_hash: Option<String>,
    pub origin: Origin,
    pub request_digest: Option<String>,
}

/// `VaultUsageSchema`, plus owner and withdrawal totals.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct UsageView {
    pub weekly_settled_atomic: U128,
    pub weekly_reserved_atomic: U128,
    pub lifetime_settled_atomic: U128,
    pub lifetime_reserved_atomic: U128,
    pub balance_atomic: U128,
    pub owner_paid_atomic: U128,
    pub owner_reserved_atomic: U128,
    pub withdrawn_atomic: U128,
    pub withdrawal_in_flight_atomic: U128,
    pub pending_count: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ConfigView {
    pub owner: AccountId,
    pub guardian: Option<AccountId>,
    pub token_contract: AccountId,
    pub token_decimals: u8,
    pub capacities: Capacities,
    pub contract_version: String,
}
