use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{
    CurveType, PromiseResult, PublicKey, RuntimeFeesConfig, test_vm_config, testing_env,
};
use std::collections::HashMap;

const DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;

fn account(value: &str) -> AccountId {
    value.parse().expect("valid test account")
}

fn key(byte: u8) -> PublicKey {
    PublicKey::from_parts(CurveType::ED25519, vec![byte; 32]).expect("valid public key")
}

fn context(
    current: &str,
    predecessor: &str,
    signer: &str,
    signer_key: PublicKey,
    now: u64,
    deposit: u128,
) -> near_sdk::VMContext {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(account(current))
        .predecessor_account_id(account(predecessor))
        .signer_account_id(account(signer))
        .signer_account_pk(signer_key)
        .block_timestamp(now)
        .attached_deposit(NearToken::from_yoctonear(deposit));
    builder.build()
}

fn set_context(predecessor: &str, signer: &str, signer_key: PublicKey, now: u64) {
    testing_env!(context(
        "vault.testnet",
        predecessor,
        signer,
        signer_key,
        now,
        0,
    ));
}

fn set_callback(result: PromiseResult, now: u64) {
    testing_env!(
        context(
            "vault.testnet",
            "vault.testnet",
            "vault.testnet",
            key(9),
            now,
            0,
        ),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        HashMap::default(),
        vec![result],
    );
}

fn config() -> VaultConfig {
    VaultConfig {
        owner_id: account("owner.testnet"),
        guardian_id: Some(account("guardian.testnet")),
        token_contract_id: account("sgusd.testnet"),
        token_decimals: 6,
        weekly_cap_atomic: U128(1_000),
        lifetime_ceiling_atomic: U128(3_000),
        capacities: CapacityLimits {
            max_vendors: 8,
            max_payables: 64,
            max_operations: 128,
            max_pending_operations: 8,
            max_rolling_entries: 64,
            max_identifier_length: 96,
            max_digest_length: 128,
        },
    }
}

fn setup() -> Vault {
    set_context("owner.testnet", "owner.testnet", key(1), DAY_NS);
    let mut vault = Vault::new(config());
    vault.set_vendor(
        VendorInput {
            vendor_id: "vendor-a".to_string(),
            recipient: account("vendor-a.testnet"),
            per_payment_cap_atomic: U128(500),
            enabled: true,
        },
        0,
    );
    vault.activate_agent(
        AgentBindingInput {
            account_id: account("agent.testnet"),
            public_key: key(2),
            manifest_digest: "sha256:manifest-v1".to_string(),
            valid_from_ns: U64(1),
            expires_at_ns: U64(100 * DAY_NS),
        },
        0,
    );
    vault.register_payable(PayableInput {
        payable_ref: "payable-1".to_string(),
        vendor_id: "vendor-a".to_string(),
        vendor_revision: 1,
        amount_atomic: U128(400),
        po_number: "PO-1".to_string(),
        not_before_ns: U64(1),
        due_at_ns: U64(20 * DAY_NS),
        expires_at_ns: U64(30 * DAY_NS),
    });
    set_context("sgusd.testnet", "sgusd.testnet", key(3), DAY_NS);
    let unused = vault.ft_on_transfer(account("funder.testnet"), U128(10_000), String::new());
    assert!(matches!(unused, PromiseOrValue::Value(U128(0))));
    set_context("owner.testnet", "owner.testnet", key(1), DAY_NS);
    vault.unpause();
    vault
}

fn payment_request(digest: &str) -> PaymentRequest {
    PaymentRequest {
        payable_ref: "payable-1".to_string(),
        request_digest: digest.to_string(),
        expected_policy_revision: 1,
        expected_vendor_revision: 1,
        expected_binding_revision: 1,
    }
}

fn request_value(vault: &mut Vault, request: PaymentRequest) -> RequestResult {
    match vault.request_payment(request) {
        PromiseOrValue::Value(value) => value,
        PromiseOrValue::Promise(_) => RequestResult {
            accepted: true,
            existing: false,
            operation_id: Some(U64(1)),
            status: Some(PayableStatus::PendingAgent),
            rejection: None,
        },
    }
}

#[test]
fn reserves_before_dispatch_and_settles_once() {
    let mut vault = setup();
    set_context("agent.testnet", "agent.testnet", key(2), 10 * DAY_NS);
    let result = vault.request_payment(payment_request("digest:one"));
    assert!(matches!(result, PromiseOrValue::Promise(_)));
    let usage = vault.get_usage();
    assert_eq!(usage.reserved_agent_total_atomic, U128(400));
    assert_eq!(usage.available_balance_atomic, U128(9_600));
    assert_eq!(
        vault.get_payable("payable-1".to_string()).unwrap().status,
        PayableStatus::PendingAgent
    );

    set_callback(PromiseResult::Successful(b"null".to_vec()), 10 * DAY_NS + 1);
    let settled = vault.on_payment_result(1);
    assert_eq!(settled.status, Some(PayableStatus::Settled));
    let after = vault.get_usage();
    assert_eq!(after.reserved_agent_total_atomic, U128(0));
    assert_eq!(after.settled_agent_total_atomic, U128(400));
    assert_eq!(after.recorded_balance_atomic, U128(9_600));

    let replay = vault.on_payment_result(1);
    assert!(replay.existing);
    assert_eq!(vault.get_usage(), after);
}

#[test]
fn known_failure_releases_exactly_once_and_requires_reopen() {
    let mut vault = setup();
    set_context("agent.testnet", "agent.testnet", key(2), 10 * DAY_NS);
    assert!(matches!(
        vault.request_payment(payment_request("digest:failure")),
        PromiseOrValue::Promise(_)
    ));
    set_callback(PromiseResult::Failed, 10 * DAY_NS + 1);
    let failed = vault.on_payment_result(1);
    assert_eq!(failed.status, Some(PayableStatus::FailedKnown));
    let usage = vault.get_usage();
    assert_eq!(usage.reserved_agent_total_atomic, U128(0));
    assert_eq!(usage.available_balance_atomic, U128(10_000));
    let replay = vault.on_payment_result(1);
    assert!(replay.existing);
    assert_eq!(vault.get_usage(), usage);

    set_context("owner.testnet", "owner.testnet", key(1), 10 * DAY_NS + 2);
    let reopened = vault.reopen_failed_payable("payable-1".to_string());
    assert_eq!(reopened.status, PayableStatus::Open);
    assert!(reopened.operation_id.is_none());
    assert!(reopened.request_digest.is_none());
}

#[test]
fn normal_policy_failures_are_structured_and_do_not_create_operations() {
    let mut vault = setup();
    set_context("agent.testnet", "agent.testnet", key(2), 10 * DAY_NS);
    let vendor = vault.get_vendors(None, None).pop().unwrap();
    set_context("owner.testnet", "owner.testnet", key(1), 10 * DAY_NS);
    vault.set_vendor(
        VendorInput {
            vendor_id: vendor.vendor_id,
            recipient: vendor.recipient,
            per_payment_cap_atomic: U128(399),
            enabled: true,
        },
        vendor.revision,
    );
    set_context("agent.testnet", "agent.testnet", key(2), 10 * DAY_NS);
    let result = request_value(
        &mut vault,
        PaymentRequest {
            expected_vendor_revision: 2,
            ..payment_request("digest:over-cap")
        },
    );
    assert!(!result.accepted);
    assert_eq!(
        result.rejection.unwrap().code,
        VaultRejectionCode::StaleVendorRevision
    );
    assert!(vault.get_operation(U64(1)).is_none());
}

#[test]
fn same_digest_replay_is_idempotent_and_conflict_is_rejected() {
    let mut vault = setup();
    set_context("agent.testnet", "agent.testnet", key(2), 10 * DAY_NS);
    assert!(matches!(
        vault.request_payment(payment_request("digest:same")),
        PromiseOrValue::Promise(_)
    ));
    let replay = request_value(&mut vault, payment_request("digest:same"));
    assert!(replay.accepted);
    assert!(replay.existing);
    assert_eq!(replay.operation_id, Some(U64(1)));
    let conflict = request_value(&mut vault, payment_request("digest:different"));
    assert!(!conflict.accepted);
    assert_eq!(
        conflict.rejection.unwrap().code,
        VaultRejectionCode::RequestDigestConflict
    );
}

#[test]
fn guardian_is_pause_only() {
    let mut vault = setup();
    set_context("guardian.testnet", "guardian.testnet", key(4), 10 * DAY_NS);
    vault.pause();
    assert!(vault.get_config().guardian_id.is_some());
    set_context("agent.testnet", "agent.testnet", key(2), 10 * DAY_NS);
    let result = request_value(&mut vault, payment_request("digest:paused"));
    assert_eq!(
        result.rejection.unwrap().code,
        VaultRejectionCode::VaultPaused
    );
}

fn register_payable(
    vault: &mut Vault,
    payable_ref: &str,
    amount: u128,
    vendor_revision: u64,
    now: u64,
) {
    set_context("owner.testnet", "owner.testnet", key(1), now);
    vault.register_payable(PayableInput {
        payable_ref: payable_ref.to_string(),
        vendor_id: "vendor-a".to_string(),
        vendor_revision,
        amount_atomic: U128(amount),
        po_number: format!("PO-{payable_ref}"),
        not_before_ns: U64(1),
        due_at_ns: U64(40 * DAY_NS),
        expires_at_ns: U64(50 * DAY_NS),
    });
}

fn request_for(payable_ref: &str, digest: &str, vendor_revision: u64) -> PaymentRequest {
    PaymentRequest {
        payable_ref: payable_ref.to_string(),
        request_digest: digest.to_string(),
        expected_policy_revision: 1,
        expected_vendor_revision: vendor_revision,
        expected_binding_revision: 1,
    }
}

#[test]
fn wrong_key_and_proxy_calls_are_structured_rejections() {
    let mut vault = setup();
    set_context("agent.testnet", "agent.testnet", key(8), 10 * DAY_NS);
    let wrong_key = request_value(&mut vault, payment_request("digest:wrong-key"));
    assert_eq!(
        wrong_key.rejection.unwrap().code,
        VaultRejectionCode::AgentKeyMismatch
    );

    testing_env!(context(
        "vault.testnet",
        "proxy.testnet",
        "agent.testnet",
        key(2),
        10 * DAY_NS,
        0,
    ));
    let proxy = request_value(&mut vault, payment_request("digest:proxy"));
    assert_eq!(
        proxy.rejection.unwrap().code,
        VaultRejectionCode::CallerSignerMismatch
    );
    assert!(vault.get_operation(U64(1)).is_none());
}

#[test]
fn reservations_contain_distinct_payables_competing_for_last_budget() {
    let mut vault = setup();
    set_context("owner.testnet", "owner.testnet", key(1), 10 * DAY_NS);
    vault.set_policy(
        PolicyChange {
            weekly_cap_atomic: U128(700),
            lifetime_ceiling_atomic: U128(3_000),
        },
        1,
    );
    register_payable(&mut vault, "payable-2", 400, 1, 10 * DAY_NS);

    set_context("agent.testnet", "agent.testnet", key(2), 10 * DAY_NS);
    let first = vault.request_payment(PaymentRequest {
        expected_policy_revision: 2,
        ..payment_request("digest:first")
    });
    assert!(matches!(first, PromiseOrValue::Promise(_)));
    let second = request_value(
        &mut vault,
        PaymentRequest {
            expected_policy_revision: 2,
            ..request_for("payable-2", "digest:second", 1)
        },
    );
    assert_eq!(
        second.rejection.unwrap().code,
        VaultRejectionCode::WeeklyCapExceeded
    );
    assert_eq!(vault.get_usage().reserved_agent_total_atomic, U128(400));
    assert!(vault.get_operation(U64(2)).is_none());
}

#[test]
fn owner_pay_bypasses_agent_caps_but_preserves_exact_locked_payment() {
    let mut vault = setup();
    set_context("owner.testnet", "owner.testnet", key(1), 10 * DAY_NS);
    vault.set_policy(
        PolicyChange {
            weekly_cap_atomic: U128(100),
            lifetime_ceiling_atomic: U128(100),
        },
        1,
    );

    set_context("agent.testnet", "agent.testnet", key(2), 10 * DAY_NS);
    let rejected = request_value(
        &mut vault,
        PaymentRequest {
            expected_policy_revision: 2,
            ..payment_request("digest:agent-over-cap")
        },
    );
    assert_eq!(
        rejected.rejection.unwrap().code,
        VaultRejectionCode::WeeklyCapExceeded
    );

    set_context("owner.testnet", "owner.testnet", key(1), 10 * DAY_NS);
    assert!(matches!(
        vault.owner_pay("payable-1".to_string()),
        PromiseOrValue::Promise(_)
    ));
    let operation = vault.get_operation(U64(1)).expect("owner operation exists");
    assert_eq!(operation.actor, OperationActor::Owner);
    assert_eq!(operation.amount_atomic, U128(400));
    assert_eq!(operation.recipient, account("vendor-a.testnet"));

    set_callback(PromiseResult::Successful(b"null".to_vec()), 10 * DAY_NS + 1);
    let result = vault.on_payment_result(1);
    assert_eq!(result.status, Some(PayableStatus::Settled));
    let usage = vault.get_usage();
    assert_eq!(usage.owner_paid_total_atomic, U128(400));
    assert_eq!(usage.settled_agent_total_atomic, U128(0));
}

#[test]
fn vendor_change_and_pause_while_pending_do_not_redirect_or_release() {
    let mut vault = setup();
    set_context("agent.testnet", "agent.testnet", key(2), 10 * DAY_NS);
    assert!(matches!(
        vault.request_payment(payment_request("digest:locked")),
        PromiseOrValue::Promise(_)
    ));

    set_context("owner.testnet", "owner.testnet", key(1), 10 * DAY_NS + 1);
    vault.set_vendor(
        VendorInput {
            vendor_id: "vendor-a".to_string(),
            recipient: account("new-recipient.testnet"),
            per_payment_cap_atomic: U128(500),
            enabled: true,
        },
        1,
    );
    vault.pause();

    let operation = vault
        .get_operation(U64(1))
        .expect("pending operation exists");
    assert_eq!(operation.recipient, account("vendor-a.testnet"));
    assert_eq!(vault.get_usage().reserved_agent_total_atomic, U128(400));
    assert_eq!(
        vault.get_payable("payable-1".to_string()).unwrap().status,
        PayableStatus::PendingAgent
    );

    set_callback(PromiseResult::Successful(b"null".to_vec()), 10 * DAY_NS + 2);
    let result = vault.on_payment_result(1);
    assert_eq!(result.status, Some(PayableStatus::Settled));
    assert_eq!(vault.get_usage().reserved_agent_total_atomic, U128(0));
}

#[test]
fn ambiguous_callback_preserves_reservation_for_reconciliation() {
    let mut vault = setup();
    set_context("agent.testnet", "agent.testnet", key(2), 10 * DAY_NS);
    assert!(matches!(
        vault.request_payment(payment_request("digest:ambiguous")),
        PromiseOrValue::Promise(_)
    ));

    testing_env!(
        context(
            "vault.testnet",
            "vault.testnet",
            "vault.testnet",
            key(9),
            10 * DAY_NS + 1,
            0,
        ),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        HashMap::default(),
        vec![],
    );
    let result = vault.on_payment_result(1);
    assert_eq!(result.status, Some(PayableStatus::Reconciliation));
    let usage = vault.get_usage();
    assert_eq!(usage.reserved_agent_total_atomic, U128(400));
    assert_eq!(usage.pending_operations, 1);
    assert_eq!(usage.pending_agent_operations, 1);
    assert_eq!(usage.available_balance_atomic, U128(9_600));
}

#[test]
fn oversized_callback_result_preserves_agent_reservation() {
    let mut vault = setup();
    set_context("agent.testnet", "agent.testnet", key(2), 10 * DAY_NS);
    assert!(matches!(
        vault.request_payment(payment_request("digest:oversized-result")),
        PromiseOrValue::Promise(_)
    ));

    set_callback(
        PromiseResult::Successful(vec![0; MAX_PROMISE_RESULT_BYTES + 1]),
        10 * DAY_NS + 1,
    );
    let result = vault.on_payment_result(1);
    assert_eq!(result.status, Some(PayableStatus::Reconciliation));
    let operation = vault
        .get_operation(U64(1))
        .expect("operation remains recorded");
    assert_eq!(
        operation.failure_category.as_deref(),
        Some("PROMISE_RESULT_TOO_LARGE")
    );
    let usage = vault.get_usage();
    assert_eq!(usage.reserved_agent_total_atomic, U128(400));
    assert_eq!(usage.pending_operations, 1);
    assert_eq!(usage.available_balance_atomic, U128(9_600));
}

#[test]
fn rolling_window_is_active_before_and_expires_at_exactly_seven_days() {
    let mut vault = setup();
    let settled_at = 10 * DAY_NS;
    set_context("agent.testnet", "agent.testnet", key(2), settled_at);
    assert!(matches!(
        vault.request_payment(payment_request("digest:rolling")),
        PromiseOrValue::Promise(_)
    ));
    set_callback(PromiseResult::Successful(b"null".to_vec()), settled_at);
    vault.on_payment_result(1);

    set_context(
        "owner.testnet",
        "owner.testnet",
        key(1),
        settled_at + SEVEN_DAYS_NS - 1,
    );
    assert_eq!(vault.get_usage().rolling_settled_atomic, U128(400));
    set_context(
        "owner.testnet",
        "owner.testnet",
        key(1),
        settled_at + SEVEN_DAYS_NS,
    );
    assert_eq!(vault.get_usage().rolling_settled_atomic, U128(0));
    set_context(
        "owner.testnet",
        "owner.testnet",
        key(1),
        settled_at + SEVEN_DAYS_NS + 1,
    );
    assert_eq!(vault.get_usage().rolling_settled_atomic, U128(0));
}

#[test]
fn withdrawal_success_failure_and_callback_replay_are_idempotent() {
    let mut vault = setup();
    set_context("owner.testnet", "owner.testnet", key(1), 10 * DAY_NS);
    vault.pause();
    let initial = vault.get_usage();
    let _promise = vault.withdraw_available(account("vendor-a.testnet"), U128(100));
    set_callback(PromiseResult::Successful(b"null".to_vec()), 10 * DAY_NS + 1);
    let settled = vault.on_withdraw_result(1);
    assert_eq!(settled.status, OperationStatus::Settled);
    let after_success = vault.get_usage();
    assert_eq!(
        after_success.recorded_balance_atomic,
        U128(initial.recorded_balance_atomic.0 - 100)
    );
    let replay = vault.on_withdraw_result(1);
    assert_eq!(replay, settled);
    assert_eq!(vault.get_usage(), after_success);

    set_context("owner.testnet", "owner.testnet", key(1), 10 * DAY_NS + 2);
    let _promise = vault.withdraw_available(account("vendor-a.testnet"), U128(50));
    set_callback(PromiseResult::Failed, 10 * DAY_NS + 3);
    let failed = vault.on_withdraw_result(2);
    assert_eq!(failed.status, OperationStatus::FailedKnown);
    let after_failure = vault.get_usage();
    assert_eq!(
        after_failure.recorded_balance_atomic,
        after_success.recorded_balance_atomic
    );
    assert_eq!(
        after_failure.available_balance_atomic,
        after_success.available_balance_atomic
    );
    let failure_replay = vault.on_withdraw_result(2);
    assert_eq!(failure_replay, failed);
    assert_eq!(vault.get_usage(), after_failure);
}
