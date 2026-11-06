mod events;
pub mod model;

use events::{emit, to_value};
use model::{
    AgentBinding, AgentBindingInput, CapacityLimits, Operation, OperationActor, OperationStatus,
    Payable, PayableInput, PayableStatus, PaymentRequest, Policy, PolicyChange, RequestResult,
    RollingEntry, UsageView, VaultConfig, VaultRejection, VaultRejectionCode, Vendor, VendorInput,
};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::UnorderedMap;
use near_sdk::json_types::{U64, U128};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue, env, ext_contract, near, require,
};

const SEVEN_DAYS_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(30);
const GAS_PAYMENT_CALLBACK: Gas = Gas::from_tgas(30);
const MAX_VIEW_PAGE: u32 = 100;
const MAX_PROMISE_RESULT_BYTES: usize = 1_024;

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Vendors,
    Payables,
    Operations,
    RollingEntries,
}

#[ext_contract(ext_ft)]
trait ExtFungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct Vault {
    owner_id: AccountId,
    guardian_id: Option<AccountId>,
    token_contract_id: AccountId,
    token_decimals: u8,
    paused: bool,
    capacities: CapacityLimits,
    policy: Policy,
    binding: Option<AgentBinding>,
    vendors: UnorderedMap<String, Vendor>,
    payables: UnorderedMap<String, Payable>,
    operations: UnorderedMap<u64, Operation>,
    rolling_entries: UnorderedMap<u64, RollingEntry>,
    rolling_head: u64,
    rolling_tail: u64,
    next_operation_id: u64,
    settled_agent_total: u128,
    reserved_agent_total: u128,
    owner_paid_total: u128,
    recorded_balance: u128,
    available_balance: u128,
    pending_operations: u32,
    pending_agent_operations: u32,
    withdrawal_operation_id: Option<u64>,
}

#[near]
impl Vault {
    #[init]
    pub fn new(config: VaultConfig) -> Self {
        require!(!env::state_exists(), "already initialized");
        require!(config.token_decimals <= 24, "token decimals exceed 24");
        Self::assert_capacities(&config.capacities);

        let contract = Self {
            owner_id: config.owner_id,
            guardian_id: config.guardian_id,
            token_contract_id: config.token_contract_id,
            token_decimals: config.token_decimals,
            paused: true,
            capacities: config.capacities,
            policy: Policy {
                weekly_cap_atomic: config.weekly_cap_atomic,
                lifetime_ceiling_atomic: config.lifetime_ceiling_atomic,
                revision: 1,
            },
            binding: None,
            vendors: UnorderedMap::new(StorageKey::Vendors),
            payables: UnorderedMap::new(StorageKey::Payables),
            operations: UnorderedMap::new(StorageKey::Operations),
            rolling_entries: UnorderedMap::new(StorageKey::RollingEntries),
            rolling_head: 0,
            rolling_tail: 0,
            next_operation_id: 1,
            settled_agent_total: 0,
            reserved_agent_total: 0,
            owner_paid_total: 0,
            recorded_balance: 0,
            available_balance: 0,
            pending_operations: 0,
            pending_agent_operations: 0,
            withdrawal_operation_id: None,
        };
        emit(
            "vault_initialized",
            near_sdk::serde_json::json!({
                "owner_id": contract.owner_id.clone(),
                "token_contract_id": contract.token_contract_id.clone(),
                "token_decimals": contract.token_decimals,
                "paused": true,
                "weekly_cap_atomic": contract.policy.weekly_cap_atomic,
                "lifetime_ceiling_atomic": contract.policy.lifetime_ceiling_atomic,
            }),
        );
        contract
    }

    pub fn pause(&mut self) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner_id || self.guardian_id.as_ref() == Some(&caller),
            "only owner or guardian may pause"
        );
        self.paused = true;
        emit(
            "vault_paused",
            near_sdk::serde_json::json!({ "caller": caller }),
        );
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        emit(
            "vault_unpaused",
            near_sdk::serde_json::json!({ "caller": env::predecessor_account_id() }),
        );
    }

    pub fn set_vendor(&mut self, input: VendorInput, expected_revision: u64) -> Vendor {
        self.assert_owner();
        self.assert_identifier(&input.vendor_id, "vendor id");
        let existing = self.vendors.get(&input.vendor_id);
        let revision = match existing {
            None => {
                require!(expected_revision == 0, "new vendor expects revision 0");
                require!(
                    self.vendors.len() < u64::from(self.capacities.max_vendors),
                    "vendor capacity exhausted"
                );
                1
            }
            Some(ref vendor) => {
                require!(
                    vendor.revision == expected_revision,
                    "stale vendor revision"
                );
                vendor
                    .revision
                    .checked_add(1)
                    .expect("vendor revision overflow")
            }
        };
        let vendor = Vendor {
            vendor_id: input.vendor_id.clone(),
            recipient: input.recipient,
            per_payment_cap_atomic: input.per_payment_cap_atomic,
            enabled: input.enabled,
            revision,
        };
        self.vendors.insert(&input.vendor_id, &vendor);
        emit("vendor_set", to_value(&vendor));
        vendor
    }

    pub fn register_payable(&mut self, input: PayableInput) -> Payable {
        self.assert_owner();
        self.assert_identifier(&input.payable_ref, "payable reference");
        self.assert_identifier(&input.po_number, "purchase order number");
        require!(input.amount_atomic.0 > 0, "payable amount must be positive");
        require!(
            input.not_before_ns.0 <= input.due_at_ns.0
                && input.due_at_ns.0 <= input.expires_at_ns.0,
            "invalid payable time window"
        );
        require!(
            self.payables.get(&input.payable_ref).is_none(),
            "duplicate payable reference"
        );
        require!(
            self.payables.len() < u64::from(self.capacities.max_payables),
            "payable capacity exhausted"
        );
        let vendor = self
            .vendors
            .get(&input.vendor_id)
            .unwrap_or_else(|| env::panic_str("unknown vendor"));
        require!(
            vendor.revision == input.vendor_revision,
            "stale vendor revision"
        );
        let payable = Payable {
            payable_ref: input.payable_ref.clone(),
            vendor_id: input.vendor_id,
            vendor_revision: input.vendor_revision,
            recipient: vendor.recipient,
            amount_atomic: input.amount_atomic,
            po_number: input.po_number,
            not_before_ns: input.not_before_ns,
            due_at_ns: input.due_at_ns,
            expires_at_ns: input.expires_at_ns,
            status: PayableStatus::Open,
            operation_id: None,
            request_digest: None,
        };
        self.payables.insert(&input.payable_ref, &payable);
        emit("payable_registered", to_value(&payable));
        payable
    }

    pub fn set_policy(&mut self, change: PolicyChange, expected_revision: u64) -> Policy {
        self.assert_owner();
        require!(
            self.policy.revision == expected_revision,
            "stale policy revision"
        );
        let lifetime_committed = self
            .settled_agent_total
            .checked_add(self.reserved_agent_total)
            .expect("lifetime accounting overflow");
        require!(
            change.lifetime_ceiling_atomic.0 >= lifetime_committed,
            "lifetime ceiling below settled plus reserved"
        );
        let weekly_committed = self
            .rolling_total_at(env::block_timestamp())
            .checked_add(self.reserved_agent_total)
            .expect("weekly accounting overflow");
        require!(
            change.weekly_cap_atomic.0 >= weekly_committed,
            "weekly cap below rolling settled plus reserved"
        );
        self.policy = Policy {
            weekly_cap_atomic: change.weekly_cap_atomic,
            lifetime_ceiling_atomic: change.lifetime_ceiling_atomic,
            revision: self
                .policy
                .revision
                .checked_add(1)
                .expect("policy revision overflow"),
        };
        emit("policy_set", to_value(&self.policy));
        self.policy.clone()
    }

    pub fn activate_agent(
        &mut self,
        input: AgentBindingInput,
        expected_revision: u64,
    ) -> AgentBinding {
        self.assert_owner();
        self.assert_digest(&input.manifest_digest, "manifest digest");
        require!(
            input.valid_from_ns.0 <= input.expires_at_ns.0,
            "invalid binding time window"
        );
        let current_revision = self.binding.as_ref().map_or(0, |binding| binding.revision);
        require!(
            current_revision == expected_revision,
            "stale binding revision"
        );
        let binding = AgentBinding {
            account_id: input.account_id,
            public_key: input.public_key,
            manifest_digest: input.manifest_digest,
            valid_from_ns: input.valid_from_ns,
            expires_at_ns: input.expires_at_ns,
            enabled: true,
            revision: current_revision
                .checked_add(1)
                .expect("binding revision overflow"),
        };
        self.binding = Some(binding.clone());
        emit("agent_activated", to_value(&binding));
        binding
    }

    pub fn revoke_agent(&mut self, expected_revision: u64) -> AgentBinding {
        self.assert_owner();
        let mut binding = self
            .binding
            .clone()
            .unwrap_or_else(|| env::panic_str("agent binding does not exist"));
        require!(
            binding.revision == expected_revision,
            "stale binding revision"
        );
        binding.enabled = false;
        binding.revision = binding
            .revision
            .checked_add(1)
            .expect("binding revision overflow");
        self.binding = Some(binding.clone());
        emit("agent_revoked", to_value(&binding));
        binding
    }

    #[payable]
    pub fn request_payment(&mut self, request: PaymentRequest) -> PromiseOrValue<RequestResult> {
        let now = env::block_timestamp();
        if self.paused {
            return self.reject(
                VaultRejectionCode::VaultPaused,
                now,
                Some(request.payable_ref),
                None,
                None,
            );
        }
        if env::attached_deposit() != NearToken::from_yoctonear(0) {
            return self.reject(
                VaultRejectionCode::NonZeroAttachedDeposit,
                now,
                Some(request.payable_ref),
                None,
                None,
            );
        }
        if env::predecessor_account_id() != env::signer_account_id() {
            return self.reject(
                VaultRejectionCode::CallerSignerMismatch,
                now,
                Some(request.payable_ref),
                None,
                None,
            );
        }
        let binding = match self.binding.clone() {
            Some(binding) => binding,
            None => {
                return self.reject(
                    VaultRejectionCode::AgentAccountMismatch,
                    now,
                    Some(request.payable_ref),
                    None,
                    None,
                );
            }
        };
        if env::predecessor_account_id() != binding.account_id {
            return self.reject(
                VaultRejectionCode::AgentAccountMismatch,
                now,
                Some(request.payable_ref),
                None,
                None,
            );
        }
        if env::signer_account_pk() != binding.public_key {
            return self.reject(
                VaultRejectionCode::AgentKeyMismatch,
                now,
                Some(request.payable_ref),
                None,
                None,
            );
        }
        if !binding.enabled {
            return self.reject(
                VaultRejectionCode::AgentBindingDisabled,
                now,
                Some(request.payable_ref),
                None,
                None,
            );
        }
        if now < binding.valid_from_ns.0 {
            return self.reject(
                VaultRejectionCode::AgentBindingNotYetValid,
                now,
                Some(request.payable_ref),
                None,
                None,
            );
        }
        if now > binding.expires_at_ns.0 {
            return self.reject(
                VaultRejectionCode::AgentBindingExpired,
                now,
                Some(request.payable_ref),
                None,
                None,
            );
        }
        if request.expected_binding_revision != binding.revision {
            return self.reject(
                VaultRejectionCode::StaleBindingRevision,
                now,
                Some(request.payable_ref),
                None,
                None,
            );
        }
        let mut payable = match self.payables.get(&request.payable_ref) {
            Some(payable) => payable,
            None => {
                return self.reject(
                    VaultRejectionCode::UnknownPayable,
                    now,
                    Some(request.payable_ref),
                    None,
                    None,
                );
            }
        };
        if request.request_digest.is_empty()
            || request.request_digest.len() > self.capacities.max_digest_length as usize
        {
            return self.reject(
                VaultRejectionCode::InvalidRequestDigest,
                now,
                Some(request.payable_ref),
                Some(payable.vendor_revision),
                Some(payable.amount_atomic),
            );
        }
        if matches!(
            payable.status,
            PayableStatus::PendingAgent | PayableStatus::Settled
        ) && payable.request_digest.as_ref() == Some(&request.request_digest)
            && payable.operation_id.is_some()
        {
            return PromiseOrValue::Value(RequestResult::accepted(
                payable.operation_id.expect("checked operation id").0,
                payable.status,
                true,
            ));
        }
        if payable.request_digest.is_some()
            && payable.request_digest.as_ref() != Some(&request.request_digest)
        {
            return self.reject(
                VaultRejectionCode::RequestDigestConflict,
                now,
                Some(request.payable_ref),
                Some(payable.vendor_revision),
                Some(payable.amount_atomic),
            );
        }
        if payable.status != PayableStatus::Open {
            return self.reject(
                VaultRejectionCode::PayableNotOpen,
                now,
                Some(request.payable_ref),
                Some(payable.vendor_revision),
                Some(payable.amount_atomic),
            );
        }
        if now < payable.not_before_ns.0 {
            return self.reject(
                VaultRejectionCode::PayableTooEarly,
                now,
                Some(request.payable_ref),
                Some(payable.vendor_revision),
                Some(payable.amount_atomic),
            );
        }
        if now > payable.expires_at_ns.0 {
            return self.reject(
                VaultRejectionCode::PayableExpired,
                now,
                Some(request.payable_ref),
                Some(payable.vendor_revision),
                Some(payable.amount_atomic),
            );
        }
        let vendor = match self.vendors.get(&payable.vendor_id) {
            Some(vendor) => vendor,
            None => {
                return self.reject(
                    VaultRejectionCode::UnknownVendor,
                    now,
                    Some(request.payable_ref),
                    None,
                    Some(payable.amount_atomic),
                );
            }
        };
        if !vendor.enabled {
            return self.reject(
                VaultRejectionCode::VendorDisabled,
                now,
                Some(request.payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }
        if request.expected_vendor_revision != vendor.revision
            || payable.vendor_revision != vendor.revision
        {
            return self.reject(
                VaultRejectionCode::StaleVendorRevision,
                now,
                Some(request.payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }
        if request.expected_policy_revision != self.policy.revision {
            return self.reject(
                VaultRejectionCode::StalePolicyRevision,
                now,
                Some(request.payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }
        if payable.amount_atomic.0 > vendor.per_payment_cap_atomic.0 {
            return self.reject(
                VaultRejectionCode::AmountOverVendorCap,
                now,
                Some(request.payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }
        self.prune_rolling(now);
        let rolling = self.rolling_total_at(now);
        let weekly_committed = rolling
            .checked_add(self.reserved_agent_total)
            .expect("weekly accounting overflow");
        if weekly_committed > self.policy.weekly_cap_atomic.0
            || payable.amount_atomic.0 > self.policy.weekly_cap_atomic.0 - weekly_committed
        {
            return self.reject(
                VaultRejectionCode::WeeklyCapExceeded,
                now,
                Some(request.payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }
        let lifetime_committed = self
            .settled_agent_total
            .checked_add(self.reserved_agent_total)
            .expect("lifetime accounting overflow");
        if lifetime_committed > self.policy.lifetime_ceiling_atomic.0
            || payable.amount_atomic.0 > self.policy.lifetime_ceiling_atomic.0 - lifetime_committed
        {
            return self.reject(
                VaultRejectionCode::LifetimeCeilingExceeded,
                now,
                Some(request.payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }
        if self.available_balance < payable.amount_atomic.0 {
            return self.reject(
                VaultRejectionCode::InsufficientRecordedBalance,
                now,
                Some(request.payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }
        if let Some(code) = self.capacity_rejection(true) {
            return self.reject(
                code,
                now,
                Some(request.payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }

        let operation_id = self.allocate_operation_id();
        let operation = Operation {
            operation_id: U64(operation_id),
            actor: OperationActor::Agent,
            payable_ref: Some(payable.payable_ref.clone()),
            request_digest: Some(request.request_digest.clone()),
            amount_atomic: payable.amount_atomic,
            recipient: payable.recipient.clone(),
            created_at_ns: U64(now),
            status: OperationStatus::Dispatched,
            settled_at_ns: None,
            failure_category: None,
        };
        payable.status = PayableStatus::PendingAgent;
        payable.operation_id = Some(U64(operation_id));
        payable.request_digest = Some(request.request_digest);
        self.available_balance = self
            .available_balance
            .checked_sub(payable.amount_atomic.0)
            .expect("available balance underflow");
        self.reserved_agent_total = self
            .reserved_agent_total
            .checked_add(payable.amount_atomic.0)
            .expect("reserved agent total overflow");
        self.pending_operations = self
            .pending_operations
            .checked_add(1)
            .expect("pending operation count overflow");
        self.pending_agent_operations = self
            .pending_agent_operations
            .checked_add(1)
            .expect("pending agent count overflow");
        self.operations.insert(&operation_id, &operation);
        self.payables.insert(&payable.payable_ref, &payable);
        emit("payment_reserved", to_value(&operation));

        let transfer_recipient = payable.recipient.clone();
        let transfer_amount = payable.amount_atomic;
        let transfer_memo = Some(format!("spendgym:{}", payable.payable_ref));
        let promise = ext_ft::ext(self.token_contract_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(transfer_recipient, transfer_amount, transfer_memo)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_PAYMENT_CALLBACK)
                    .on_payment_result(operation_id),
            );
        PromiseOrValue::Promise(promise)
    }

    pub fn owner_pay(&mut self, payable_ref: String) -> PromiseOrValue<RequestResult> {
        self.assert_owner();
        let now = env::block_timestamp();
        if self.paused {
            return self.reject(
                VaultRejectionCode::VaultPaused,
                now,
                Some(payable_ref),
                None,
                None,
            );
        }
        let mut payable = match self.payables.get(&payable_ref) {
            Some(payable) => payable,
            None => {
                return self.reject(
                    VaultRejectionCode::UnknownPayable,
                    now,
                    Some(payable_ref),
                    None,
                    None,
                );
            }
        };
        if payable.status != PayableStatus::Open {
            return self.reject(
                VaultRejectionCode::PayableNotOpen,
                now,
                Some(payable_ref),
                Some(payable.vendor_revision),
                Some(payable.amount_atomic),
            );
        }
        if now < payable.not_before_ns.0 {
            return self.reject(
                VaultRejectionCode::PayableTooEarly,
                now,
                Some(payable_ref),
                Some(payable.vendor_revision),
                Some(payable.amount_atomic),
            );
        }
        if now > payable.expires_at_ns.0 {
            return self.reject(
                VaultRejectionCode::PayableExpired,
                now,
                Some(payable_ref),
                Some(payable.vendor_revision),
                Some(payable.amount_atomic),
            );
        }
        let vendor = match self.vendors.get(&payable.vendor_id) {
            Some(vendor) => vendor,
            None => {
                return self.reject(
                    VaultRejectionCode::UnknownVendor,
                    now,
                    Some(payable_ref),
                    None,
                    Some(payable.amount_atomic),
                );
            }
        };
        if !vendor.enabled {
            return self.reject(
                VaultRejectionCode::VendorDisabled,
                now,
                Some(payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }
        if vendor.revision != payable.vendor_revision {
            return self.reject(
                VaultRejectionCode::StaleVendorRevision,
                now,
                Some(payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }
        if self.available_balance < payable.amount_atomic.0 {
            return self.reject(
                VaultRejectionCode::InsufficientRecordedBalance,
                now,
                Some(payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }
        if let Some(code) = self.capacity_rejection(false) {
            return self.reject(
                code,
                now,
                Some(payable_ref),
                Some(vendor.revision),
                Some(payable.amount_atomic),
            );
        }

        let operation_id = self.allocate_operation_id();
        let operation = Operation {
            operation_id: U64(operation_id),
            actor: OperationActor::Owner,
            payable_ref: Some(payable.payable_ref.clone()),
            request_digest: None,
            amount_atomic: payable.amount_atomic,
            recipient: payable.recipient.clone(),
            created_at_ns: U64(now),
            status: OperationStatus::Dispatched,
            settled_at_ns: None,
            failure_category: None,
        };
        payable.status = PayableStatus::PendingOwner;
        payable.operation_id = Some(U64(operation_id));
        self.available_balance = self
            .available_balance
            .checked_sub(payable.amount_atomic.0)
            .expect("available balance underflow");
        self.pending_operations = self
            .pending_operations
            .checked_add(1)
            .expect("pending operation count overflow");
        self.operations.insert(&operation_id, &operation);
        self.payables.insert(&payable.payable_ref, &payable);
        emit("payment_reserved", to_value(&operation));

        let transfer_recipient = payable.recipient.clone();
        let transfer_amount = payable.amount_atomic;
        let transfer_memo = Some(format!("spendgym-owner:{}", payable.payable_ref));
        let promise = ext_ft::ext(self.token_contract_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(transfer_recipient, transfer_amount, transfer_memo)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_PAYMENT_CALLBACK)
                    .on_payment_result(operation_id),
            );
        PromiseOrValue::Promise(promise)
    }

    #[private]
    pub fn on_payment_result(&mut self, operation_id: u64) -> RequestResult {
        let mut operation = self
            .operations
            .get(&operation_id)
            .unwrap_or_else(|| env::panic_str("unknown payment operation"));
        require!(
            operation.actor != OperationActor::Withdrawal,
            "operation is not a payment"
        );
        if operation.status != OperationStatus::Dispatched {
            let payable_ref = operation
                .payable_ref
                .clone()
                .unwrap_or_else(|| env::panic_str("payment operation missing payable"));
            let payable = self
                .payables
                .get(&payable_ref)
                .unwrap_or_else(|| env::panic_str("linked payable missing"));
            return RequestResult::accepted(operation_id, payable.status, true);
        }
        let payable_ref = operation
            .payable_ref
            .clone()
            .unwrap_or_else(|| env::panic_str("payment operation missing payable"));
        let mut payable = self
            .payables
            .get(&payable_ref)
            .unwrap_or_else(|| env::panic_str("linked payable missing"));
        require!(
            payable.operation_id == Some(U64(operation_id)),
            "operation and payable link mismatch"
        );

        if env::promise_results_count() != 1 {
            operation.status = OperationStatus::Reconciliation;
            operation.failure_category = Some("AMBIGUOUS_RESULT".to_string());
            payable.status = PayableStatus::Reconciliation;
            self.operations.insert(&operation_id, &operation);
            self.payables.insert(&payable_ref, &payable);
            emit("payment_reconciliation_required", to_value(&operation));
            return RequestResult::accepted(operation_id, payable.status, false);
        }

        match env::promise_result_checked(0, MAX_PROMISE_RESULT_BYTES) {
            Ok(_) => {
                operation.status = OperationStatus::Settled;
                operation.settled_at_ns = Some(U64(env::block_timestamp()));
                payable.status = PayableStatus::Settled;
                self.pending_operations = self
                    .pending_operations
                    .checked_sub(1)
                    .expect("pending operation count underflow");
                self.recorded_balance = self
                    .recorded_balance
                    .checked_sub(operation.amount_atomic.0)
                    .expect("recorded balance underflow");
                match operation.actor {
                    OperationActor::Agent => {
                        self.reserved_agent_total = self
                            .reserved_agent_total
                            .checked_sub(operation.amount_atomic.0)
                            .expect("reserved agent total underflow");
                        self.settled_agent_total = self
                            .settled_agent_total
                            .checked_add(operation.amount_atomic.0)
                            .expect("settled agent total overflow");
                        self.pending_agent_operations = self
                            .pending_agent_operations
                            .checked_sub(1)
                            .expect("pending agent count underflow");
                        let rolling_index = self.rolling_tail;
                        self.rolling_entries.insert(
                            &rolling_index,
                            &RollingEntry {
                                operation_id,
                                amount_atomic: operation.amount_atomic.0,
                                settled_at_ns: env::block_timestamp(),
                            },
                        );
                        self.rolling_tail = self
                            .rolling_tail
                            .checked_add(1)
                            .expect("rolling index overflow");
                    }
                    OperationActor::Owner => {
                        self.owner_paid_total = self
                            .owner_paid_total
                            .checked_add(operation.amount_atomic.0)
                            .expect("owner paid total overflow");
                    }
                    OperationActor::Withdrawal => unreachable!(),
                }
                self.operations.insert(&operation_id, &operation);
                self.payables.insert(&payable_ref, &payable);
                emit("payment_settled", to_value(&operation));
                RequestResult::accepted(operation_id, payable.status, false)
            }
            Err(PromiseError::Failed) => {
                operation.status = OperationStatus::FailedKnown;
                operation.settled_at_ns = Some(U64(env::block_timestamp()));
                operation.failure_category = Some("TOKEN_TRANSFER_FAILED".to_string());
                payable.status = PayableStatus::FailedKnown;
                self.pending_operations = self
                    .pending_operations
                    .checked_sub(1)
                    .expect("pending operation count underflow");
                self.available_balance = self
                    .available_balance
                    .checked_add(operation.amount_atomic.0)
                    .expect("available balance overflow");
                if operation.actor == OperationActor::Agent {
                    self.reserved_agent_total = self
                        .reserved_agent_total
                        .checked_sub(operation.amount_atomic.0)
                        .expect("reserved agent total underflow");
                    self.pending_agent_operations = self
                        .pending_agent_operations
                        .checked_sub(1)
                        .expect("pending agent count underflow");
                }
                self.operations.insert(&operation_id, &operation);
                self.payables.insert(&payable_ref, &payable);
                emit("payment_failed_known", to_value(&operation));
                RequestResult::accepted(operation_id, payable.status, false)
            }
            Err(_) => {
                operation.status = OperationStatus::Reconciliation;
                operation.failure_category = Some("PROMISE_RESULT_TOO_LARGE".to_string());
                payable.status = PayableStatus::Reconciliation;
                self.operations.insert(&operation_id, &operation);
                self.payables.insert(&payable_ref, &payable);
                emit("payment_reconciliation_required", to_value(&operation));
                RequestResult::accepted(operation_id, payable.status, false)
            }
        }
    }

    pub fn reopen_failed_payable(&mut self, payable_ref: String) -> Payable {
        self.assert_owner();
        let mut payable = self
            .payables
            .get(&payable_ref)
            .unwrap_or_else(|| env::panic_str("unknown payable"));
        require!(
            payable.status == PayableStatus::FailedKnown,
            "payable is not a known failure"
        );
        payable.status = PayableStatus::Open;
        payable.operation_id = None;
        payable.request_digest = None;
        self.payables.insert(&payable_ref, &payable);
        emit("payable_reopened", to_value(&payable));
        payable
    }

    pub fn withdraw_available(&mut self, recipient: AccountId, amount_atomic: U128) -> Promise {
        self.assert_owner();
        require!(self.paused, "withdrawal requires paused vault");
        require!(
            self.pending_operations == 0,
            "payment operation remains unresolved"
        );
        require!(
            self.withdrawal_operation_id.is_none(),
            "withdrawal operation remains unresolved"
        );
        require!(amount_atomic.0 > 0, "withdrawal amount must be positive");
        require!(
            amount_atomic.0 <= self.available_balance,
            "withdrawal exceeds available recorded balance"
        );
        require!(
            self.operations.len() < u64::from(self.capacities.max_operations),
            "operation capacity exhausted"
        );

        let operation_id = self.allocate_operation_id();
        let operation = Operation {
            operation_id: U64(operation_id),
            actor: OperationActor::Withdrawal,
            payable_ref: None,
            request_digest: None,
            amount_atomic,
            recipient: recipient.clone(),
            created_at_ns: U64(env::block_timestamp()),
            status: OperationStatus::Dispatched,
            settled_at_ns: None,
            failure_category: None,
        };
        self.available_balance = self
            .available_balance
            .checked_sub(amount_atomic.0)
            .expect("available balance underflow");
        self.withdrawal_operation_id = Some(operation_id);
        self.operations.insert(&operation_id, &operation);
        emit("withdrawal_reserved", to_value(&operation));

        ext_ft::ext(self.token_contract_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(
                recipient,
                amount_atomic,
                Some("spendgym-withdrawal".to_string()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_PAYMENT_CALLBACK)
                    .on_withdraw_result(operation_id),
            )
    }

    #[private]
    pub fn on_withdraw_result(&mut self, operation_id: u64) -> Operation {
        let mut operation = self
            .operations
            .get(&operation_id)
            .unwrap_or_else(|| env::panic_str("unknown withdrawal operation"));
        require!(
            operation.actor == OperationActor::Withdrawal,
            "operation is not a withdrawal"
        );
        if operation.status != OperationStatus::Dispatched {
            return operation;
        }
        require!(
            self.withdrawal_operation_id == Some(operation_id),
            "withdrawal pointer mismatch"
        );
        if env::promise_results_count() != 1 {
            operation.status = OperationStatus::Reconciliation;
            operation.failure_category = Some("AMBIGUOUS_RESULT".to_string());
            self.operations.insert(&operation_id, &operation);
            emit("withdrawal_reconciliation_required", to_value(&operation));
            return operation;
        }
        match env::promise_result_checked(0, MAX_PROMISE_RESULT_BYTES) {
            Ok(_) => {
                operation.status = OperationStatus::Settled;
                operation.settled_at_ns = Some(U64(env::block_timestamp()));
                self.recorded_balance = self
                    .recorded_balance
                    .checked_sub(operation.amount_atomic.0)
                    .expect("recorded balance underflow");
                self.withdrawal_operation_id = None;
                self.operations.insert(&operation_id, &operation);
                emit("withdrawal_settled", to_value(&operation));
            }
            Err(PromiseError::Failed) => {
                operation.status = OperationStatus::FailedKnown;
                operation.settled_at_ns = Some(U64(env::block_timestamp()));
                operation.failure_category = Some("TOKEN_TRANSFER_FAILED".to_string());
                self.available_balance = self
                    .available_balance
                    .checked_add(operation.amount_atomic.0)
                    .expect("available balance overflow");
                self.withdrawal_operation_id = None;
                self.operations.insert(&operation_id, &operation);
                emit("withdrawal_failed_known", to_value(&operation));
            }
            Err(_) => {
                operation.status = OperationStatus::Reconciliation;
                operation.failure_category = Some("PROMISE_RESULT_TOO_LARGE".to_string());
                self.operations.insert(&operation_id, &operation);
                emit("withdrawal_reconciliation_required", to_value(&operation));
            }
        }
        operation
    }

    pub fn get_policy(&self) -> Policy {
        self.policy.clone()
    }

    pub fn get_usage(&self) -> UsageView {
        self.usage_at(env::block_timestamp())
    }

    pub fn get_payable(&self, payable_ref: String) -> Option<Payable> {
        self.payables.get(&payable_ref)
    }

    pub fn get_operation(&self, operation_id: U64) -> Option<Operation> {
        self.operations.get(&operation_id.0)
    }

    pub fn get_binding(&self) -> Option<AgentBinding> {
        self.binding.clone()
    }

    pub fn get_vendors(&self, from_index: Option<U64>, limit: Option<u32>) -> Vec<Vendor> {
        let from = usize::try_from(from_index.unwrap_or(U64(0)).0).unwrap_or(usize::MAX);
        let count =
            usize::try_from(limit.unwrap_or(50).min(MAX_VIEW_PAGE)).expect("view limit fits usize");
        self.vendors
            .iter()
            .skip(from)
            .take(count)
            .map(|(_, vendor)| vendor)
            .collect()
    }

    pub fn get_config(&self) -> VaultConfig {
        VaultConfig {
            owner_id: self.owner_id.clone(),
            guardian_id: self.guardian_id.clone(),
            token_contract_id: self.token_contract_id.clone(),
            token_decimals: self.token_decimals,
            weekly_cap_atomic: self.policy.weekly_cap_atomic,
            lifetime_ceiling_atomic: self.policy.lifetime_ceiling_atomic,
            capacities: self.capacities.clone(),
        }
    }
}

#[near]
impl FungibleTokenReceiver for Vault {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        _msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.token_contract_id,
            "only the fixed token contract may fund this vault"
        );
        require!(amount.0 > 0, "funding amount must be positive");
        self.recorded_balance = self
            .recorded_balance
            .checked_add(amount.0)
            .expect("recorded balance overflow");
        self.available_balance = self
            .available_balance
            .checked_add(amount.0)
            .expect("available balance overflow");
        emit(
            "vault_funded",
            near_sdk::serde_json::json!({
                "sender_id": sender_id,
                "amount_atomic": amount,
                "recorded_balance_atomic": U128(self.recorded_balance),
            }),
        );
        PromiseOrValue::Value(U128(0))
    }
}

impl Vault {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "owner signature required"
        );
    }

    fn assert_capacities(capacities: &CapacityLimits) {
        require!(capacities.max_vendors > 0, "max_vendors must be positive");
        require!(capacities.max_payables > 0, "max_payables must be positive");
        require!(
            capacities.max_operations > 0,
            "max_operations must be positive"
        );
        require!(
            capacities.max_pending_operations > 0,
            "max_pending_operations must be positive"
        );
        require!(
            capacities.max_rolling_entries > 0,
            "max_rolling_entries must be positive"
        );
        require!(
            capacities.max_identifier_length > 0,
            "max_identifier_length must be positive"
        );
        require!(
            capacities.max_digest_length > 0,
            "max_digest_length must be positive"
        );
    }

    fn assert_identifier(&self, value: &str, label: &str) {
        require!(
            !value.is_empty() && value.len() <= self.capacities.max_identifier_length as usize,
            format!("{label} length is invalid")
        );
    }

    fn assert_digest(&self, value: &str, label: &str) {
        require!(
            !value.is_empty() && value.len() <= self.capacities.max_digest_length as usize,
            format!("{label} length is invalid")
        );
    }

    fn allocate_operation_id(&mut self) -> u64 {
        let current = self.next_operation_id;
        self.next_operation_id = self
            .next_operation_id
            .checked_add(1)
            .expect("operation id overflow");
        current
    }

    fn capacity_rejection(&self, agent: bool) -> Option<VaultRejectionCode> {
        if self.operations.len() >= u64::from(self.capacities.max_operations) {
            return Some(VaultRejectionCode::OperationCapacityExhausted);
        }
        if self.pending_operations >= self.capacities.max_pending_operations {
            return Some(VaultRejectionCode::PendingCapacityExhausted);
        }
        if agent {
            let active_rolling = self.rolling_tail.saturating_sub(self.rolling_head);
            let committed_slots = active_rolling
                .checked_add(u64::from(self.pending_agent_operations))
                .expect("rolling slot count overflow");
            if committed_slots >= u64::from(self.capacities.max_rolling_entries) {
                return Some(VaultRejectionCode::RollingCapacityExhausted);
            }
        }
        None
    }

    fn prune_rolling(&mut self, now: u64) {
        if now < SEVEN_DAYS_NS {
            return;
        }
        let threshold = now - SEVEN_DAYS_NS;
        while self.rolling_head < self.rolling_tail {
            let entry = self
                .rolling_entries
                .get(&self.rolling_head)
                .unwrap_or_else(|| env::panic_str("rolling entry missing"));
            if entry.settled_at_ns > threshold {
                break;
            }
            self.rolling_entries.remove(&self.rolling_head);
            self.rolling_head = self
                .rolling_head
                .checked_add(1)
                .expect("rolling head overflow");
        }
    }

    fn rolling_total_at(&self, now: u64) -> u128 {
        let threshold = now.checked_sub(SEVEN_DAYS_NS);
        let mut total = 0u128;
        let mut index = self.rolling_head;
        while index < self.rolling_tail {
            let entry = self
                .rolling_entries
                .get(&index)
                .unwrap_or_else(|| env::panic_str("rolling entry missing"));
            if threshold.is_none_or(|value| entry.settled_at_ns > value) {
                total = total
                    .checked_add(entry.amount_atomic)
                    .expect("rolling total overflow");
            }
            index = index.checked_add(1).expect("rolling index overflow");
        }
        total
    }

    fn usage_at(&self, now: u64) -> UsageView {
        UsageView {
            settled_agent_total_atomic: U128(self.settled_agent_total),
            reserved_agent_total_atomic: U128(self.reserved_agent_total),
            owner_paid_total_atomic: U128(self.owner_paid_total),
            rolling_settled_atomic: U128(self.rolling_total_at(now)),
            weekly_cap_atomic: self.policy.weekly_cap_atomic,
            lifetime_ceiling_atomic: self.policy.lifetime_ceiling_atomic,
            recorded_balance_atomic: U128(self.recorded_balance),
            available_balance_atomic: U128(self.available_balance),
            pending_operations: self.pending_operations,
            pending_agent_operations: self.pending_agent_operations,
        }
    }

    fn reject(
        &self,
        code: VaultRejectionCode,
        now: u64,
        payable_ref: Option<String>,
        vendor_revision: Option<u64>,
        requested_amount_atomic: Option<U128>,
    ) -> PromiseOrValue<RequestResult> {
        PromiseOrValue::Value(RequestResult::rejected(VaultRejection {
            code,
            human_review: true,
            payable_ref,
            requested_amount_atomic,
            policy_revision: self.policy.revision,
            vendor_revision,
            binding_revision: self.binding.as_ref().map(|binding| binding.revision),
            usage: self.usage_at(now),
        }))
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests;
