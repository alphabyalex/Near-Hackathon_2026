//! Wardline vault. One contract per business. The spec is docs/VAULT_RULES.md: if this code
//! and that file disagree, it is a bug. The order of checks in `request_payment` and
//! `owner_pay` is part of the spec, because packages/vault-sim must match it.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

pub mod events;
pub mod types;

#[cfg(test)]
mod tests;

pub use types::*;

pub const ROLLING_WINDOW_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
pub const RECONCILE_AFTER_NS: u64 = 60 * 60 * 1_000_000_000;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_CALLBACK: Gas = Gas::from_tgas(25);
/// Transfer, callback, and this receipt's own execution.
const MIN_PREPAID_GAS: Gas = Gas::from_tgas(60);

/// NEAR kept free on the vault account so a callback can always pay for its storage.
const STORAGE_MARGIN: NearToken = NearToken::from_millinear(10);

pub const DEFAULT_CAPACITIES: Capacities = Capacities {
    max_vendors: 64,
    max_payables: 1024,
    max_pending: 32,
    max_rolling: 256,
    max_operations: 2048,
};

pub const HARD_LIMITS: Capacities = Capacities {
    max_vendors: 128,
    max_payables: 4096,
    max_pending: 64,
    max_rolling: 512,
    max_operations: 8192,
};

const MAX_ID_BYTES: usize = 64;
const MAX_TEXT_BYTES: usize = 64;
const MAX_PAGE: u32 = 100;
const MAX_RESULT_BYTES: usize = 64;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Vendors,
    Payables,
    Operations,
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FtCore {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    guardian: Option<AccountId>,
    token_contract: AccountId,
    token_decimals: u8,
    capacities: Capacities,

    policy: StoredPolicy,
    binding: Option<StoredBinding>,
    binding_revision: u64,

    vendors: IterableMap<String, StoredVendor>,
    payables: IterableMap<String, StoredPayable>,
    operations: LookupMap<String, StoredOperation>,
    operation_count: u32,

    // Accounting. See "Accounting" in docs/VAULT_RULES.md.
    available: u128,
    reserved: u128,
    settled: u128,
    owner_reserved: u128,
    owner_paid: u128,
    withdrawn: u128,
    withdrawal: Option<WithdrawalInFlight>,
    rolling: Vec<RollingEntry>,

    /// Operations in RESERVED or OUTCOME_UNCERTAIN, both origins.
    pending_count: u32,
    /// The agent subset of `pending_count`. Each one holds a settlement slot in `rolling`.
    agent_pending_count: u32,
}

enum RequestDecision {
    Reject(VaultRejection),
    Existing(String),
    Reserve { amount: u128, recipient: AccountId },
}

enum TransferOutcome {
    Success,
    Failed,
    Unknown,
}

#[near]
impl Vault {
    /// One time, by the vault account itself. Starts paused with no agent enrolled.
    #[init]
    #[private]
    pub fn new(config: VaultConfig) -> Self {
        let capacities = config.capacities.unwrap_or(DEFAULT_CAPACITIES);
        check_input(
            capacities.max_vendors <= HARD_LIMITS.max_vendors
                && capacities.max_payables <= HARD_LIMITS.max_payables
                && capacities.max_pending <= HARD_LIMITS.max_pending
                && capacities.max_rolling <= HARD_LIMITS.max_rolling
                && capacities.max_operations <= HARD_LIMITS.max_operations,
        );
        Self {
            owner: config.owner,
            guardian: config.guardian,
            token_contract: config.token_contract,
            token_decimals: config.token_decimals,
            capacities,
            policy: StoredPolicy {
                revision: 1,
                weekly_cap: config.policy.weekly_cap_atomic.0,
                lifetime_cap: config.policy.lifetime_cap_atomic.0,
                expires_at_ns: config.policy.expires_at_ns.0,
                paused: true,
            },
            binding: None,
            binding_revision: 0,
            vendors: IterableMap::new(StorageKey::Vendors),
            payables: IterableMap::new(StorageKey::Payables),
            operations: LookupMap::new(StorageKey::Operations),
            operation_count: 0,
            available: 0,
            reserved: 0,
            settled: 0,
            owner_reserved: 0,
            owner_paid: 0,
            withdrawn: 0,
            withdrawal: None,
            rolling: Vec::new(),
            pending_count: 0,
            agent_pending_count: 0,
        }
    }

    // ---------- Owner: configuration ----------

    #[payable]
    pub fn set_vendor(&mut self, vendor: VendorInput, expected_revision: u64) -> u64 {
        assert_one_yocto();
        self.assert_owner();
        check_id(&vendor.vendor_id);
        check_text(&vendor.display_name);
        let current = self.vendors.get(&vendor.vendor_id).map(|v| v.revision);
        if current.unwrap_or(0) != expected_revision {
            fail("E_STALE_REVISION");
        }
        if current.is_none() && self.vendors.len() >= self.capacities.max_vendors {
            fail("E_CAPACITY_FULL");
        }
        let revision = expected_revision + 1;
        events::vendor_set(
            &vendor.vendor_id,
            revision,
            &vendor.account_id,
            vendor.per_payment_cap_atomic.0,
            vendor.active,
        );
        self.vendors.insert(
            vendor.vendor_id,
            StoredVendor {
                display_name: vendor.display_name,
                account_id: vendor.account_id,
                revision,
                per_payment_cap: vendor.per_payment_cap_atomic.0,
                active: vendor.active,
            },
        );
        revision
    }

    #[payable]
    pub fn register_payable(&mut self, payable: PayableInput) {
        assert_one_yocto();
        self.assert_owner();
        check_id(&payable.payable_ref);
        check_text(&payable.po_number);
        if let Some(invoice_number) = &payable.invoice_number {
            check_text(invoice_number);
        }
        check_input(is_digest(&payable.evidence_commitment));
        if self.payables.contains_key(&payable.payable_ref) {
            fail("E_DUPLICATE_PAYABLE");
        }
        let vendor = match self.vendors.get(&payable.vendor_id) {
            Some(vendor) => vendor,
            None => fail("E_UNKNOWN_VENDOR"),
        };
        if !vendor.active {
            fail("E_VENDOR_INACTIVE");
        }
        if vendor.revision != payable.vendor_revision {
            fail("E_VENDOR_REVISION_MISMATCH");
        }
        let (not_before, due, expires) = (
            payable.not_before_ns.0,
            payable.due_at_ns.0,
            payable.expires_at_ns.0,
        );
        check_input(payable.amount_atomic.0 > 0 && not_before <= due && due <= expires && not_before < expires);
        if self.payables.len() >= self.capacities.max_payables {
            fail("E_CAPACITY_FULL");
        }
        let recipient = vendor.account_id.clone();
        events::payable_registered(
            &payable.payable_ref,
            &payable.vendor_id,
            payable.vendor_revision,
            payable.amount_atomic.0,
            &recipient,
            due,
        );
        self.payables.insert(
            payable.payable_ref,
            StoredPayable {
                vendor_id: payable.vendor_id,
                vendor_revision: payable.vendor_revision,
                recipient,
                po_number: payable.po_number,
                invoice_number: payable.invoice_number,
                amount: payable.amount_atomic.0,
                not_before_ns: not_before,
                due_at_ns: due,
                expires_at_ns: expires,
                evidence_commitment: payable.evidence_commitment,
                status: PayableStatus::Open,
                attempts: 0,
                operation_id: None,
            },
        );
    }

    #[payable]
    pub fn cancel_payable(&mut self, payable_ref: String) {
        assert_one_yocto();
        self.assert_owner();
        let payable = match self.payables.get_mut(&payable_ref) {
            Some(payable) => payable,
            None => fail("E_UNKNOWN_PAYABLE"),
        };
        match payable.status {
            PayableStatus::Open | PayableStatus::FailedKnown => {
                payable.status = PayableStatus::Cancelled;
            }
            _ => fail("E_NOT_CANCELLABLE"),
        }
        events::payable_cancelled(&payable_ref);
    }

    #[payable]
    pub fn reopen_failed_payable(&mut self, payable_ref: String) {
        assert_one_yocto();
        self.assert_owner();
        let payable = match self.payables.get_mut(&payable_ref) {
            Some(payable) => payable,
            None => fail("E_UNKNOWN_PAYABLE"),
        };
        if payable.status != PayableStatus::FailedKnown {
            fail("E_NOT_FAILED");
        }
        payable.status = PayableStatus::Open;
        events::payable_reopened(&payable_ref);
    }

    /// Never clears settled or reserved money. Limits only move when the owner signs this.
    #[payable]
    pub fn set_policy(&mut self, change: PolicyInput, expected_revision: u64) -> u64 {
        assert_one_yocto();
        self.assert_owner();
        if self.policy.revision != expected_revision {
            fail("E_STALE_REVISION");
        }
        if change.lifetime_cap_atomic.0 < add(self.settled, self.reserved) {
            fail("E_BELOW_COMMITTED");
        }
        self.policy.revision += 1;
        self.policy.weekly_cap = change.weekly_cap_atomic.0;
        self.policy.lifetime_cap = change.lifetime_cap_atomic.0;
        self.policy.expires_at_ns = change.expires_at_ns.0;
        events::policy_set(
            self.policy.revision,
            self.policy.weekly_cap,
            self.policy.lifetime_cap,
            self.policy.expires_at_ns,
        );
        self.policy.revision
    }

    #[payable]
    pub fn activate_agent(&mut self, binding: BindingInput, expected_revision: u64) -> u64 {
        assert_one_yocto();
        self.assert_owner();
        if self.binding_revision != expected_revision {
            fail("E_STALE_REVISION");
        }
        check_input(is_digest(&binding.manifest_digest));
        check_text(&binding.assessment_ref);
        self.binding_revision += 1;
        events::agent_activated(
            &binding.agent_account_id,
            self.binding_revision,
            &binding.manifest_digest,
            binding.expires_at_ns.0,
        );
        self.binding = Some(StoredBinding {
            agent_account_id: binding.agent_account_id,
            public_key: binding.public_key,
            manifest_digest: binding.manifest_digest,
            assessment_ref: binding.assessment_ref,
            expires_at_ns: binding.expires_at_ns.0,
            enabled: true,
        });
        self.binding_revision
    }

    /// Only reduces authority, so it needs no deposit. Pending payments still resolve.
    pub fn revoke_agent(&mut self, agent_account_id: AccountId) {
        self.assert_owner();
        let binding = match self.binding.as_mut() {
            Some(binding) => binding,
            None => fail("E_NO_BINDING"),
        };
        if binding.agent_account_id != agent_account_id {
            fail("E_AGENT_MISMATCH");
        }
        binding.enabled = false;
        self.binding_revision += 1;
        events::agent_revoked(&agent_account_id, self.binding_revision);
    }

    /// Owner or guardian. Stops `request_payment` only.
    pub fn pause(&mut self) {
        let caller = env::predecessor_account_id();
        if caller != self.owner && Some(&caller) != self.guardian.as_ref() {
            fail("E_NOT_OWNER_OR_GUARDIAN");
        }
        self.policy.paused = true;
        events::vault_paused(&caller);
    }

    #[payable]
    pub fn unpause(&mut self) {
        assert_one_yocto();
        self.assert_owner();
        self.policy.paused = false;
        events::vault_unpaused(&env::predecessor_account_id());
    }

    // ---------- Agent path ----------

    /// Rule failures return a `RequestResult`. Nothing is written unless the payment is reserved.
    pub fn request_payment(
        &mut self,
        payable_ref: String,
        request_digest: String,
        expected_vendor_revision: u64,
        expected_policy_revision: u64,
        expected_binding_revision: u64,
    ) -> PromiseOrValue<RequestResult> {
        let decision = self.decide_request(
            &payable_ref,
            &request_digest,
            expected_vendor_revision,
            expected_policy_revision,
            expected_binding_revision,
        );
        match decision {
            RequestDecision::Reject(rejection) => {
                PromiseOrValue::Value(RequestResult::rejected(rejection))
            }
            RequestDecision::Existing(operation_id) => {
                PromiseOrValue::Value(RequestResult::accepted(operation_id))
            }
            RequestDecision::Reserve { amount, recipient } => {
                if env::prepaid_gas() < MIN_PREPAID_GAS {
                    fail("E_INSUFFICIENT_GAS");
                }
                self.prune_rolling(env::block_timestamp());
                self.available = sub(self.available, amount);
                self.reserved = add(self.reserved, amount);
                self.agent_pending_count += 1;
                let operation_id = self.open_operation(
                    &payable_ref,
                    amount,
                    recipient.clone(),
                    Origin::Agent,
                    Some(request_digest),
                );
                PromiseOrValue::Promise(self.transfer_then_resolve(recipient, amount, operation_id))
            }
        }
    }

    // ---------- Owner path ----------

    /// The escalation path. Pays the locked amount to the locked recipient. Ignores pause,
    /// the payable time window and all agent caps. Still single-payment locked.
    #[payable]
    pub fn owner_pay(&mut self, payable_ref: String) -> PromiseOrValue<RequestResult> {
        assert_one_yocto();
        match self.decide_owner_pay(&payable_ref) {
            Err(rejection) => PromiseOrValue::Value(RequestResult::rejected(rejection)),
            Ok((amount, recipient)) => {
                if env::prepaid_gas() < MIN_PREPAID_GAS {
                    fail("E_INSUFFICIENT_GAS");
                }
                self.available = sub(self.available, amount);
                self.owner_reserved = add(self.owner_reserved, amount);
                let operation_id = self.open_operation(
                    &payable_ref,
                    amount,
                    recipient.clone(),
                    Origin::Owner,
                    None,
                );
                PromiseOrValue::Promise(self.transfer_then_resolve(recipient, amount, operation_id))
            }
        }
    }

    // ---------- Callbacks ----------

    /// Private. Acts only on a RESERVED operation, so a repeat changes nothing.
    #[private]
    pub fn on_payment_result(&mut self, operation_id: String) -> RequestResult {
        let operation = match self.operations.get(&operation_id) {
            Some(operation) => operation.clone(),
            None => fail("E_UNKNOWN_OPERATION"),
        };
        if operation.status == OperationStatus::Reserved {
            match read_transfer_outcome() {
                TransferOutcome::Success => self.apply_settled(&operation_id, operation),
                TransferOutcome::Failed => self.apply_failed(&operation_id, operation),
                TransferOutcome::Unknown => self.apply_uncertain(&operation_id, operation),
            }
        }
        RequestResult::accepted(operation_id)
    }

    /// The owner states the outcome of a payment the vault could not read.
    #[payable]
    pub fn reconcile_operation(&mut self, operation_id: String, settled: bool) {
        assert_one_yocto();
        self.assert_owner();
        let operation = match self.operations.get(&operation_id) {
            Some(operation) => operation.clone(),
            None => fail("E_UNKNOWN_OPERATION"),
        };
        let now = env::block_timestamp();
        let reconcilable = match operation.status {
            OperationStatus::OutcomeUncertain => true,
            OperationStatus::Reserved => {
                now >= operation.reserved_at_ns.saturating_add(RECONCILE_AFTER_NS)
            }
            _ => false,
        };
        if !reconcilable {
            fail("E_NOT_RECONCILABLE");
        }
        events::operation_reconciled(&operation_id, &operation.payable_ref, settled);
        if settled {
            self.apply_settled(&operation_id, operation);
        } else {
            self.apply_failed(&operation_id, operation);
        }
    }

    // ---------- Funding and withdrawal ----------

    /// NEP-141 receiver. Only the fixed token. Credits `available` and nothing else.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let _ = msg;
        if env::predecessor_account_id() != self.token_contract {
            fail("E_WRONG_TOKEN");
        }
        self.available = add(self.available, amount.0);
        events::funding_received(&sender_id, amount.0);
        U128(0)
    }

    #[payable]
    pub fn withdraw_available(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        self.assert_owner();
        if !self.policy.paused {
            fail("E_NOT_PAUSED");
        }
        if self.pending_count > 0 {
            fail("E_PENDING_OPERATIONS");
        }
        if self.withdrawal.is_some() {
            fail("E_WITHDRAWAL_IN_FLIGHT");
        }
        if amount.0 == 0 || amount.0 > self.available {
            fail("E_INSUFFICIENT_BALANCE");
        }
        if env::prepaid_gas() < MIN_PREPAID_GAS {
            fail("E_INSUFFICIENT_GAS");
        }
        self.available = sub(self.available, amount.0);
        self.withdrawal = Some(WithdrawalInFlight {
            amount: amount.0,
            started_at_ns: env::block_timestamp(),
            uncertain: false,
        });
        events::withdrawal("withdrawal_started", amount.0);
        ext_ft::ext(self.token_contract.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(self.owner.clone(), amount, None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_withdraw_result(amount),
            )
    }

    /// Private. Does nothing unless the matching withdrawal is in flight and unresolved.
    #[private]
    pub fn on_withdraw_result(&mut self, amount: U128) {
        let Some(mut withdrawal) = self.withdrawal else {
            return;
        };
        if withdrawal.amount != amount.0 || withdrawal.uncertain {
            return;
        }
        match read_transfer_outcome() {
            TransferOutcome::Success => self.finish_withdrawal(withdrawal.amount, true),
            TransferOutcome::Failed => self.finish_withdrawal(withdrawal.amount, false),
            TransferOutcome::Unknown => {
                withdrawal.uncertain = true;
                self.withdrawal = Some(withdrawal);
                events::withdrawal("withdrawal_uncertain", withdrawal.amount);
            }
        }
    }

    #[payable]
    pub fn reconcile_withdrawal(&mut self, settled: bool) {
        assert_one_yocto();
        self.assert_owner();
        let Some(withdrawal) = self.withdrawal else {
            fail("E_NO_WITHDRAWAL");
        };
        let old_enough = env::block_timestamp()
            >= withdrawal.started_at_ns.saturating_add(RECONCILE_AFTER_NS);
        if !withdrawal.uncertain && !old_enough {
            fail("E_NOT_RECONCILABLE");
        }
        self.finish_withdrawal(withdrawal.amount, settled);
    }

    // ---------- Views ----------

    pub fn get_policy(&self) -> PolicyView {
        PolicyView {
            revision: self.policy.revision,
            weekly_cap_atomic: U128(self.policy.weekly_cap),
            lifetime_cap_atomic: U128(self.policy.lifetime_cap),
            expires_at_ns: U64(self.policy.expires_at_ns),
            paused: self.policy.paused,
        }
    }

    pub fn get_usage(&self) -> UsageView {
        UsageView {
            weekly_settled_atomic: U128(self.rolling_settled(env::block_timestamp())),
            weekly_reserved_atomic: U128(self.reserved),
            lifetime_settled_atomic: U128(self.settled),
            lifetime_reserved_atomic: U128(self.reserved),
            balance_atomic: U128(self.available),
            owner_paid_atomic: U128(self.owner_paid),
            owner_reserved_atomic: U128(self.owner_reserved),
            withdrawn_atomic: U128(self.withdrawn),
            withdrawal_in_flight_atomic: U128(self.withdrawal.map_or(0, |w| w.amount)),
            pending_count: self.pending_count,
        }
    }

    pub fn get_payable(&self, payable_ref: String) -> Option<PayableView> {
        self.payables
            .get(&payable_ref)
            .map(|payable| self.payable_view(&payable_ref, payable))
    }

    pub fn get_payables(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<PayableView> {
        self.payables
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize)
            .map(|(payable_ref, payable)| self.payable_view(payable_ref, payable))
            .collect()
    }

    pub fn get_operation(&self, operation_id: String) -> Option<OperationView> {
        self.operations.get(&operation_id).map(|operation| OperationView {
            operation_id: operation_id.clone(),
            payable_ref: operation.payable_ref.clone(),
            amount_atomic: U128(operation.amount),
            recipient: operation.recipient.clone(),
            status: operation.status,
            attempt: operation.attempt,
            reserved_at_ns: U64(operation.reserved_at_ns),
            resolved_at_ns: operation.resolved_at_ns.map(U64),
            tx_hash: None,
            origin: operation.origin,
            request_digest: operation.request_digest.clone(),
        })
    }

    pub fn get_vendors(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<VendorView> {
        self.vendors
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize)
            .map(|(vendor_id, vendor)| VendorView {
                vendor_id: vendor_id.clone(),
                display_name: vendor.display_name.clone(),
                account_id: vendor.account_id.clone(),
                revision: vendor.revision,
                per_payment_cap_atomic: U128(vendor.per_payment_cap),
                active: vendor.active,
            })
            .collect()
    }

    pub fn get_binding(&self) -> Option<BindingView> {
        self.binding.as_ref().map(|binding| BindingView {
            agent_account_id: binding.agent_account_id.clone(),
            public_key: binding.public_key.clone(),
            manifest_digest: binding.manifest_digest.clone(),
            assessment_ref: binding.assessment_ref.clone(),
            revision: self.binding_revision,
            expires_at_ns: U64(binding.expires_at_ns),
            enabled: binding.enabled,
        })
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            guardian: self.guardian.clone(),
            token_contract: self.token_contract.clone(),
            token_decimals: self.token_decimals,
            capacities: self.capacities,
            contract_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

// ---------- Internals ----------

impl Vault {
    fn assert_owner(&self) {
        if env::predecessor_account_id() != self.owner {
            fail("E_NOT_OWNER");
        }
    }

    /// Read only: checks 1 to 16 of `request_payment`, in spec order.
    fn decide_request(
        &self,
        payable_ref: &str,
        request_digest: &str,
        expected_vendor_revision: u64,
        expected_policy_revision: u64,
        expected_binding_revision: u64,
    ) -> RequestDecision {
        use VaultRejection::*;
        let now = env::block_timestamp();

        // 1. Identity. Proxies fail here: predecessor differs from signer.
        let Some(binding) = self.binding.as_ref() else {
            return RequestDecision::Reject(BadCaller);
        };
        let predecessor = env::predecessor_account_id();
        if predecessor != env::signer_account_id()
            || predecessor != binding.agent_account_id
            || env::signer_account_pk() != binding.public_key
        {
            return RequestDecision::Reject(BadCaller);
        }
        // 2. Request shape.
        if !is_digest(request_digest) {
            return RequestDecision::Reject(BadCaller);
        }
        // 3. Authority still live.
        if !binding.enabled || now >= binding.expires_at_ns || now >= self.policy.expires_at_ns {
            return RequestDecision::Reject(BindingInactive);
        }
        // 4. Kill switch.
        if self.policy.paused {
            return RequestDecision::Reject(Paused);
        }
        // 5. Payable.
        let Some(payable) = self.payables.get(payable_ref) else {
            return RequestDecision::Reject(UnknownPayable);
        };
        // 6 and 7. Single-payment lock and idempotent retries.
        match payable.status {
            PayableStatus::Settled => {
                return self.existing_or(payable, request_digest, AlreadyPaid);
            }
            PayableStatus::Pending => {
                return self.existing_or(payable, request_digest, AlreadyPending);
            }
            PayableStatus::Open => {}
            // 8. CANCELLED, and FAILED_KNOWN awaiting the owner's reopen.
            _ => return RequestDecision::Reject(UnknownPayable),
        }
        // 9 and 10. Time window.
        if now < payable.not_before_ns {
            return RequestDecision::Reject(NotYetPayable);
        }
        if now >= payable.expires_at_ns {
            return RequestDecision::Reject(PayableExpired);
        }
        // 11. Revisions.
        let Some(vendor) = self.vendors.get(&payable.vendor_id) else {
            return RequestDecision::Reject(StaleRevision);
        };
        if expected_policy_revision != self.policy.revision
            || expected_binding_revision != self.binding_revision
            || expected_vendor_revision != vendor.revision
            || payable.vendor_revision != vendor.revision
            || !vendor.active
        {
            return RequestDecision::Reject(StaleRevision);
        }
        // 12 to 14. Caps. Exactly at a cap passes.
        let amount = payable.amount;
        if amount > vendor.per_payment_cap {
            return RequestDecision::Reject(OverVendorCap);
        }
        if !within(self.rolling_settled(now), self.reserved, amount, self.policy.weekly_cap) {
            return RequestDecision::Reject(OverWeeklyCap);
        }
        if !within(self.settled, self.reserved, amount, self.policy.lifetime_cap) {
            return RequestDecision::Reject(OverLifetimeCap);
        }
        // 15. Funds.
        if amount > self.available {
            return RequestDecision::Reject(InsufficientBalance);
        }
        // 16. Capacity. Settling needs a rolling slot, so it is reserved now.
        let live_rolling = self.live_rolling_count(now);
        if self.pending_count >= self.capacities.max_pending
            || live_rolling + self.agent_pending_count >= self.capacities.max_rolling
            || self.operation_count >= self.capacities.max_operations
            || !has_storage_margin()
        {
            return RequestDecision::Reject(CapacityFull);
        }
        RequestDecision::Reserve {
            amount,
            recipient: payable.recipient.clone(),
        }
    }

    fn existing_or(
        &self,
        payable: &StoredPayable,
        request_digest: &str,
        rejection: VaultRejection,
    ) -> RequestDecision {
        let matching = payable.operation_id.as_ref().filter(|operation_id| {
            self.operations
                .get(*operation_id)
                .and_then(|operation| operation.request_digest.as_deref())
                == Some(request_digest)
        });
        match matching {
            Some(operation_id) => RequestDecision::Existing(operation_id.clone()),
            None => RequestDecision::Reject(rejection),
        }
    }

    /// Read only: checks 1 to 8 of `owner_pay`, in spec order.
    fn decide_owner_pay(&self, payable_ref: &str) -> Result<(u128, AccountId), VaultRejection> {
        use VaultRejection::*;
        if env::predecessor_account_id() != self.owner {
            return Err(BadCaller);
        }
        let payable = self.payables.get(payable_ref).ok_or(UnknownPayable)?;
        match payable.status {
            PayableStatus::Settled => return Err(AlreadyPaid),
            PayableStatus::Pending => return Err(AlreadyPending),
            PayableStatus::Open => {}
            _ => return Err(UnknownPayable),
        }
        // A cap-only vendor change does not block this. A recipient change does.
        let vendor = self.vendors.get(&payable.vendor_id).ok_or(StaleRevision)?;
        if !vendor.active || vendor.account_id != payable.recipient {
            return Err(StaleRevision);
        }
        if payable.amount > self.available {
            return Err(InsufficientBalance);
        }
        if self.pending_count >= self.capacities.max_pending
            || self.operation_count >= self.capacities.max_operations
            || !has_storage_margin()
        {
            return Err(CapacityFull);
        }
        Ok((payable.amount, payable.recipient.clone()))
    }

    /// Common part of reservation: payable PENDING, new RESERVED operation, event.
    fn open_operation(
        &mut self,
        payable_ref: &str,
        amount: u128,
        recipient: AccountId,
        origin: Origin,
        request_digest: Option<String>,
    ) -> String {
        self.operation_count += 1;
        self.pending_count += 1;
        let operation_id = format!("op_{}", self.operation_count);
        let payable = self
            .payables
            .get_mut(payable_ref)
            .unwrap_or_else(|| fail("E_UNKNOWN_PAYABLE"));
        payable.status = PayableStatus::Pending;
        payable.attempts += 1;
        payable.operation_id = Some(operation_id.clone());
        let attempt = payable.attempts;
        events::payment_reserved(&operation_id, payable_ref, amount, &recipient, origin, attempt);
        self.operations.insert(
            operation_id.clone(),
            StoredOperation {
                payable_ref: payable_ref.to_string(),
                amount,
                recipient,
                status: OperationStatus::Reserved,
                attempt,
                reserved_at_ns: env::block_timestamp(),
                resolved_at_ns: None,
                origin,
                request_digest,
            },
        );
        operation_id
    }

    fn transfer_then_resolve(&self, recipient: AccountId, amount: u128, operation_id: String) -> Promise {
        ext_ft::ext(self.token_contract.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(recipient, U128(amount), None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_payment_result(operation_id),
            )
    }

    fn release_slots(&mut self, origin: Origin) {
        self.pending_count -= 1;
        if origin == Origin::Agent {
            self.agent_pending_count -= 1;
        }
    }

    fn apply_settled(&mut self, operation_id: &str, mut operation: StoredOperation) {
        let now = env::block_timestamp();
        match operation.origin {
            Origin::Agent => {
                self.reserved = sub(self.reserved, operation.amount);
                self.settled = add(self.settled, operation.amount);
                self.prune_rolling(now);
                self.rolling.push(RollingEntry {
                    amount: operation.amount,
                    settled_at_ns: now,
                });
            }
            Origin::Owner => {
                self.owner_reserved = sub(self.owner_reserved, operation.amount);
                self.owner_paid = add(self.owner_paid, operation.amount);
            }
        }
        self.release_slots(operation.origin);
        self.set_payable_status(&operation.payable_ref, PayableStatus::Settled);
        events::payment_settled(operation_id, &operation.payable_ref, operation.amount, operation.origin);
        operation.status = OperationStatus::Settled;
        operation.resolved_at_ns = Some(now);
        self.operations.insert(operation_id.to_string(), operation);
    }

    fn apply_failed(&mut self, operation_id: &str, mut operation: StoredOperation) {
        match operation.origin {
            Origin::Agent => self.reserved = sub(self.reserved, operation.amount),
            Origin::Owner => self.owner_reserved = sub(self.owner_reserved, operation.amount),
        }
        self.available = add(self.available, operation.amount);
        self.release_slots(operation.origin);
        self.set_payable_status(&operation.payable_ref, PayableStatus::FailedKnown);
        events::payment_failed(operation_id, &operation.payable_ref, operation.amount, operation.origin);
        operation.status = OperationStatus::FailedKnown;
        operation.resolved_at_ns = Some(env::block_timestamp());
        self.operations.insert(operation_id.to_string(), operation);
    }

    fn apply_uncertain(&mut self, operation_id: &str, mut operation: StoredOperation) {
        events::payment_uncertain(operation_id, &operation.payable_ref, operation.amount, operation.origin);
        operation.status = OperationStatus::OutcomeUncertain;
        self.operations.insert(operation_id.to_string(), operation);
    }

    fn set_payable_status(&mut self, payable_ref: &str, status: PayableStatus) {
        if let Some(payable) = self.payables.get_mut(payable_ref) {
            payable.status = status;
        }
    }

    fn finish_withdrawal(&mut self, amount: u128, settled: bool) {
        self.withdrawal = None;
        if settled {
            self.withdrawn = add(self.withdrawn, amount);
            events::withdrawal("withdrawal_settled", amount);
        } else {
            self.available = add(self.available, amount);
            events::withdrawal("withdrawal_failed", amount);
        }
    }

    fn rolling_settled(&self, now: u64) -> u128 {
        self.rolling
            .iter()
            .filter(|entry| is_live(entry, now))
            .fold(0u128, |sum, entry| add(sum, entry.amount))
    }

    fn live_rolling_count(&self, now: u64) -> u32 {
        self.rolling.iter().filter(|entry| is_live(entry, now)).count() as u32
    }

    fn prune_rolling(&mut self, now: u64) {
        self.rolling.retain(|entry| is_live(entry, now));
    }

    fn payable_view(&self, payable_ref: &str, payable: &StoredPayable) -> PayableView {
        let status = if payable.status == PayableStatus::Open
            && env::block_timestamp() >= payable.expires_at_ns
        {
            PayableStatus::Expired
        } else {
            payable.status
        };
        PayableView {
            payable_ref: payable_ref.to_string(),
            vault_id: env::current_account_id(),
            vendor_id: payable.vendor_id.clone(),
            vendor_revision: payable.vendor_revision,
            po_number: payable.po_number.clone(),
            invoice_number: payable.invoice_number.clone(),
            amount_atomic: U128(payable.amount),
            token_contract_id: self.token_contract.clone(),
            not_before_ns: U64(payable.not_before_ns),
            due_at_ns: U64(payable.due_at_ns),
            expires_at_ns: U64(payable.expires_at_ns),
            evidence_commitment: payable.evidence_commitment.clone(),
            status,
            recipient: payable.recipient.clone(),
            operation_id: payable.operation_id.clone(),
        }
    }
}

/// An entry counts while `now < settled_at + 7 days`. At exactly 7 days it no longer counts.
fn is_live(entry: &RollingEntry, now: u64) -> bool {
    now < entry.settled_at_ns.saturating_add(ROLLING_WINDOW_NS)
}

/// `used + reserved + amount <= cap`, where an overflow counts as over the cap.
fn within(used: u128, reserved: u128, amount: u128, cap: u128) -> bool {
    used.checked_add(reserved)
        .and_then(|sum| sum.checked_add(amount))
        .is_some_and(|total| total <= cap)
}

fn has_storage_margin() -> bool {
    let required = env::storage_byte_cost()
        .saturating_mul(env::storage_usage() as u128)
        .saturating_add(STORAGE_MARGIN);
    env::account_balance() >= required
}

/// Exactly one result. Success must be the empty value `ft_transfer` returns. A failure means
/// the token call reverted, so no tokens moved. Anything else is not known.
fn read_transfer_outcome() -> TransferOutcome {
    if env::promise_results_count() != 1 {
        return TransferOutcome::Unknown;
    }
    // Bounded read, so an oversized result cannot run the callback out of gas.
    match env::promise_result_checked(0, MAX_RESULT_BYTES) {
        Ok(value) if value.is_empty() => TransferOutcome::Success,
        Err(PromiseError::Failed) => TransferOutcome::Failed,
        _ => TransferOutcome::Unknown,
    }
}

fn fail(code: &str) -> ! {
    env::panic_str(code)
}

fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b).unwrap_or_else(|| fail("E_OVERFLOW"))
}

fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b).unwrap_or_else(|| fail("E_OVERFLOW"))
}

fn check_input(ok: bool) {
    if !ok {
        fail("E_INVALID_INPUT");
    }
}

fn check_id(value: &str) {
    check_input(!value.is_empty() && value.len() <= MAX_ID_BYTES);
}

fn check_text(value: &str) {
    check_input(!value.is_empty() && value.len() <= MAX_TEXT_BYTES);
}

/// `sha256:` followed by 64 lowercase hex characters, as in `DigestSchema`.
pub fn is_digest(value: &str) -> bool {
    match value.strip_prefix("sha256:") {
        Some(hex) => {
            hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }
        None => false,
    }
}
