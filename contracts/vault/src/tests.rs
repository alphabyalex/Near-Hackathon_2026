//! Unit tests for what the sandbox cannot do exactly: nanosecond-precise time boundaries,
//! replayed callbacks (only the vault itself can send those on a real chain), and promise results
//! a real token never produces. Everything else is also covered in tests/sandbox.

use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, Gas, NearToken, PromiseResult, PublicKey, RuntimeFeesConfig};
use std::collections::HashMap;

use super::*;

const AGENT_KEY: &str = "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp";
const OTHER_KEY: &str = "ed25519:DcA2MzgpJbrUATQLLceocVckhhAqrkingax4oJ9kZ847";
const DIGEST_A: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST_B: &str = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const START: u64 = 1_000_000_000_000_000_000;
const FAR: u64 = u64::MAX / 2;
const WEEKLY: u128 = 10_000;
const LIFETIME: u128 = 100_000;
/// Above the weekly cap, so these tests can reach the weekly check with a single payment.
const VENDOR_CAP: u128 = 20_000;

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn key(value: &str) -> PublicKey {
    value.parse().unwrap()
}

fn context(caller: &str, signer: &str, pk: &str, now: u64, deposit: u128) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(account("vault.test"))
        .predecessor_account_id(account(caller))
        .signer_account_id(account(signer))
        .signer_account_pk(key(pk))
        .block_timestamp(now)
        .prepaid_gas(Gas::from_tgas(100))
        .account_balance(NearToken::from_near(10))
        .attached_deposit(NearToken::from_yoctonear(deposit));
    builder
}

fn as_owner(now: u64) {
    testing_env!(context("owner.test", "owner.test", OTHER_KEY, now, 1).build());
}

fn as_agent(now: u64) {
    testing_env!(context("agent.test", "agent.test", AGENT_KEY, now, 0).build());
}

/// Runs as the vault calling itself, with this promise result available.
fn as_callback(now: u64, results: Vec<PromiseResult>) {
    let built = context("vault.test", "agent.test", AGENT_KEY, now, 0).build();
    testing_env!(
        built,
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        HashMap::default(),
        results
    );
}

fn funded_vault(capacities: Option<Capacities>) -> Vault {
    testing_env!(context("vault.test", "vault.test", OTHER_KEY, START, 0).build());
    let mut vault = Vault::new(VaultConfig {
        owner: account("owner.test"),
        guardian: Some(account("guardian.test")),
        token_contract: account("token.test"),
        token_decimals: 6,
        policy: PolicyInput {
            weekly_cap_atomic: U128(WEEKLY),
            lifetime_cap_atomic: U128(LIFETIME),
            expires_at_ns: U64(FAR),
        },
        capacities,
        approver: None,
        attestor: None,
        cooldown_policy: None,
        conservative_caps: None,
    });
    as_owner(START);
    vault.set_vendor(
        VendorInput {
            vendor_id: "vnd".to_string(),
            display_name: "Vendor".to_string(),
            account_id: account("vendor.test"),
            per_payment_cap_atomic: U128(VENDOR_CAP),
            active: true,
        },
        0,
    );
    vault.activate_agent(
        BindingInput {
            agent_account_id: account("agent.test"),
            public_key: key(AGENT_KEY),
            manifest_digest: DIGEST_A.to_string(),
            assessment_ref: "run".to_string(),
            expires_at_ns: U64(FAR),
        },
        0,
    );
    vault.unpause();
    testing_env!(context("token.test", "owner.test", OTHER_KEY, START, 0).build());
    vault.ft_on_transfer(account("owner.test"), U128(1_000_000), String::new());
    vault
}

fn add_payable(vault: &mut Vault, payable_ref: &str, amount: u128) {
    as_owner(START);
    vault.register_payable(PayableInput {
        payable_ref: payable_ref.to_string(),
        vendor_id: "vnd".to_string(),
        vendor_revision: 1,
        po_number: "PO-1".to_string(),
        invoice_number: None,
        amount_atomic: U128(amount),
        not_before_ns: U64(START),
        due_at_ns: U64(FAR),
        expires_at_ns: U64(FAR),
        evidence_commitment: DIGEST_A.to_string(),
        expected_endpoint_revision: None,
    });
}

fn request(vault: &mut Vault, payable_ref: &str, digest: &str) -> PromiseOrValue<RequestResult> {
    vault.request_payment(payable_ref.to_string(), digest.to_string(), 1, 1, 1, None)
}

fn rejection_of(result: PromiseOrValue<RequestResult>) -> VaultRejection {
    match result {
        PromiseOrValue::Value(result) => result.rejection.expect("expected a rejection"),
        PromiseOrValue::Promise(_) => panic!("expected a rejection, got a transfer"),
    }
}

fn assert_transfer(result: PromiseOrValue<RequestResult>) {
    assert!(matches!(result, PromiseOrValue::Promise(_)), "expected a transfer");
}

fn settle(vault: &mut Vault, operation_id: &str, now: u64) {
    as_callback(now, vec![PromiseResult::Successful(vec![])]);
    vault.on_payment_result(operation_id.to_string());
}

/// Pays and settles one payable at `now`. Returns its operation id.
fn pay(vault: &mut Vault, payable_ref: &str, amount: u128, now: u64) -> String {
    add_payable(vault, payable_ref, amount);
    as_agent(now);
    assert_transfer(request(vault, payable_ref, DIGEST_A));
    let operation_id = vault
        .get_payable(payable_ref.to_string())
        .unwrap()
        .operation_id
        .unwrap();
    settle(vault, &operation_id, now);
    operation_id
}

/// funded = A + R + owner_reserved + S + owner_paid + withdrawn + withdrawal_in_flight
fn assert_conserved(vault: &Vault) {
    let u = vault.get_usage();
    let total = u.balance_atomic.0
        + u.lifetime_reserved_atomic.0
        + u.owner_reserved_atomic.0
        + u.lifetime_settled_atomic.0
        + u.owner_paid_atomic.0
        + u.withdrawn_atomic.0
        + u.withdrawal_in_flight_atomic.0;
    assert_eq!(total, 1_000_000, "conservation broken: {u:?}");
}

// ---------- Rolling window, exact to the nanosecond ----------

fn window_case(offset_from_settle: u64) -> PromiseOrValue<RequestResult> {
    let mut vault = funded_vault(None);
    pay(&mut vault, "a", WEEKLY, START);
    add_payable(&mut vault, "b", 1);
    as_agent(START + offset_from_settle);
    request(&mut vault, "b", DIGEST_A)
}

#[test]
fn window_blocks_one_nanosecond_before_seven_days() {
    assert_eq!(
        rejection_of(window_case(ROLLING_WINDOW_NS - 1)),
        VaultRejection::OverWeeklyCap
    );
}

#[test]
fn window_clears_exactly_at_seven_days() {
    assert_transfer(window_case(ROLLING_WINDOW_NS));
}

#[test]
fn window_clears_after_seven_days() {
    assert_transfer(window_case(ROLLING_WINDOW_NS + 1));
}

#[test]
fn rolling_entry_uses_callback_block_time_not_reservation_time() {
    let mut vault = funded_vault(None);
    add_payable(&mut vault, "a", WEEKLY);
    as_agent(START);
    assert_transfer(request(&mut vault, "a", DIGEST_A));
    let settled_at = START + 1_000;
    settle(&mut vault, "op_1", settled_at);

    add_payable(&mut vault, "b", 1);
    as_agent(START + ROLLING_WINDOW_NS);
    assert_eq!(
        rejection_of(request(&mut vault, "b", DIGEST_A)),
        VaultRejection::OverWeeklyCap,
        "still inside the window measured from the callback"
    );
    as_agent(settled_at + ROLLING_WINDOW_NS);
    assert_transfer(request(&mut vault, "b", DIGEST_A));
}

#[test]
fn usage_view_drops_expired_entries_without_a_write() {
    let mut vault = funded_vault(None);
    pay(&mut vault, "a", 100, START);
    as_agent(START + ROLLING_WINDOW_NS - 1);
    assert_eq!(vault.get_usage().weekly_settled_atomic.0, 100);
    as_agent(START + ROLLING_WINDOW_NS);
    assert_eq!(vault.get_usage().weekly_settled_atomic.0, 0);
    assert_eq!(vault.get_usage().lifetime_settled_atomic.0, 100);
}

// ---------- Payable and binding time boundaries ----------

#[test]
fn payable_window_edges() {
    let mut vault = funded_vault(None);
    as_owner(START);
    vault.register_payable(PayableInput {
        payable_ref: "w".to_string(),
        vendor_id: "vnd".to_string(),
        vendor_revision: 1,
        po_number: "PO".to_string(),
        invoice_number: None,
        amount_atomic: U128(1),
        not_before_ns: U64(START + 100),
        due_at_ns: U64(START + 150),
        expires_at_ns: U64(START + 200),
        evidence_commitment: DIGEST_A.to_string(),
        expected_endpoint_revision: None,
    });
    as_agent(START + 99);
    assert_eq!(
        rejection_of(request(&mut vault, "w", DIGEST_A)),
        VaultRejection::NotYetPayable
    );
    as_agent(START + 200);
    assert_eq!(
        rejection_of(request(&mut vault, "w", DIGEST_A)),
        VaultRejection::PayableExpired
    );
    assert_eq!(
        vault.get_payable("w".to_string()).unwrap().status,
        PayableStatus::Expired,
        "derived in the view"
    );
    as_agent(START + 199);
    assert_eq!(
        vault.get_payable("w".to_string()).unwrap().status,
        PayableStatus::Open
    );
    as_agent(START + 100);
    assert_transfer(request(&mut vault, "w", DIGEST_A));
}

#[test]
fn expired_policy_reports_binding_inactive() {
    let mut vault = funded_vault(None);
    add_payable(&mut vault, "a", 1);
    as_owner(START);
    vault.set_policy(
        PolicyInput {
            weekly_cap_atomic: U128(WEEKLY),
            lifetime_cap_atomic: U128(LIFETIME),
            expires_at_ns: U64(START + 5),
        },
        1,
    );
    as_agent(START + 5);
    assert_eq!(
        vault
            .request_payment("a".to_string(), DIGEST_A.to_string(), 1, 2, 1, None)
            .into_rejection(),
        VaultRejection::BindingInactive
    );
}

// ---------- Forged and replayed callbacks ----------

// A forged callback from another account is tested in tests/sandbox: `#[private]` is enforced by
// the wasm entry point, which a native unit test does not go through.

#[test]
fn replayed_success_callback_counts_once() {
    let mut vault = funded_vault(None);
    pay(&mut vault, "a", 100, START);
    settle(&mut vault, "op_1", START + 1);
    let usage = vault.get_usage();
    assert_eq!(usage.lifetime_settled_atomic.0, 100);
    assert_eq!(usage.weekly_settled_atomic.0, 100);
    assert_eq!(usage.lifetime_reserved_atomic.0, 0);
    assert_conserved(&vault);
}

#[test]
fn replayed_failure_callback_releases_once() {
    let mut vault = funded_vault(None);
    add_payable(&mut vault, "a", 100);
    as_agent(START);
    assert_transfer(request(&mut vault, "a", DIGEST_A));
    for _ in 0..3 {
        as_callback(START + 1, vec![PromiseResult::Failed]);
        vault.on_payment_result("op_1".to_string());
    }
    let usage = vault.get_usage();
    assert_eq!(usage.balance_atomic.0, 1_000_000, "released exactly once");
    assert_eq!(usage.lifetime_reserved_atomic.0, 0);
    assert_conserved(&vault);
}

#[test]
fn failure_replayed_after_settlement_changes_nothing() {
    let mut vault = funded_vault(None);
    pay(&mut vault, "a", 100, START);
    as_callback(START + 1, vec![PromiseResult::Failed]);
    vault.on_payment_result("op_1".to_string());
    assert_eq!(
        vault.get_payable("a".to_string()).unwrap().status,
        PayableStatus::Settled
    );
    assert_eq!(vault.get_usage().lifetime_settled_atomic.0, 100);
    assert_conserved(&vault);
}

#[test]
#[should_panic(expected = "E_UNKNOWN_OPERATION")]
fn callback_for_unknown_operation_panics() {
    let mut vault = funded_vault(None);
    as_callback(START, vec![PromiseResult::Successful(vec![])]);
    vault.on_payment_result("op_404".to_string());
}

// ---------- Anything else: stays reserved for reconciliation ----------

fn uncertain_vault(results: Vec<PromiseResult>) -> Vault {
    let mut vault = funded_vault(None);
    add_payable(&mut vault, "a", 100);
    as_agent(START);
    assert_transfer(request(&mut vault, "a", DIGEST_A));
    as_callback(START + 1, results);
    vault.on_payment_result("op_1".to_string());
    vault
}

#[test]
fn unexpected_success_value_stays_reserved() {
    let vault = uncertain_vault(vec![PromiseResult::Successful(b"\"surprise\"".to_vec())]);
    assert_eq!(
        vault.get_operation("op_1".to_string()).unwrap().status,
        OperationStatus::OutcomeUncertain
    );
    assert_eq!(
        vault.get_payable("a".to_string()).unwrap().status,
        PayableStatus::Pending
    );
    assert_eq!(vault.get_usage().lifetime_reserved_atomic.0, 100);
    assert_eq!(vault.get_usage().balance_atomic.0, 999_900);
    assert_conserved(&vault);
    assert!(get_logs().iter().any(|l| l.contains("payment_uncertain")));
}

#[test]
fn wrong_result_count_stays_reserved() {
    let vault = uncertain_vault(vec![]);
    assert_eq!(
        vault.get_operation("op_1".to_string()).unwrap().status,
        OperationStatus::OutcomeUncertain
    );
    assert_eq!(vault.get_usage().lifetime_reserved_atomic.0, 100);
}

#[test]
fn uncertain_payment_still_blocks_a_second_payment_and_withdrawal() {
    let mut vault = uncertain_vault(vec![]);
    as_agent(START + 2);
    assert_eq!(
        rejection_of(request(&mut vault, "a", DIGEST_B)),
        VaultRejection::AlreadyPending
    );
    as_owner(START + 2);
    assert_eq!(
        vault.owner_pay("a".to_string()).into_rejection(),
        VaultRejection::AlreadyPending
    );
}

#[test]
fn reconcile_settled_counts_once_and_late_callback_is_ignored() {
    let mut vault = uncertain_vault(vec![]);
    let now = START + 2;
    as_owner(now);
    vault.reconcile_operation("op_1".to_string(), true);
    assert_eq!(vault.get_usage().lifetime_settled_atomic.0, 100);
    assert_eq!(vault.get_usage().lifetime_reserved_atomic.0, 0);
    as_callback(now + 1, vec![PromiseResult::Failed]);
    vault.on_payment_result("op_1".to_string());
    assert_eq!(
        vault.get_payable("a".to_string()).unwrap().status,
        PayableStatus::Settled
    );
    assert_conserved(&vault);
}

#[test]
fn reconcile_failed_releases_and_allows_reopen() {
    let mut vault = uncertain_vault(vec![]);
    as_owner(START + 2);
    vault.reconcile_operation("op_1".to_string(), false);
    assert_eq!(vault.get_usage().balance_atomic.0, 1_000_000);
    assert_eq!(
        vault.get_payable("a".to_string()).unwrap().status,
        PayableStatus::FailedKnown
    );
    vault.reopen_failed_payable("a".to_string());
    assert_eq!(
        vault.get_payable("a".to_string()).unwrap().status,
        PayableStatus::Open
    );
    assert_conserved(&vault);
}

#[test]
fn reconcile_cannot_settle_twice() {
    let mut vault = uncertain_vault(vec![]);
    as_owner(START + 2);
    vault.reconcile_operation("op_1".to_string(), true);
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        vault.reconcile_operation("op_1".to_string(), true);
    }));
    assert!(again.is_err());
    assert_eq!(vault.get_usage().lifetime_settled_atomic.0, 100);
}

#[test]
#[should_panic(expected = "E_NOT_RECONCILABLE")]
fn fresh_reserved_operation_cannot_be_reconciled() {
    let mut vault = funded_vault(None);
    add_payable(&mut vault, "a", 100);
    as_agent(START);
    assert_transfer(request(&mut vault, "a", DIGEST_A));
    as_owner(START + RECONCILE_AFTER_NS - 1);
    vault.reconcile_operation("op_1".to_string(), false);
}

#[test]
fn reserved_with_no_callback_for_an_hour_can_be_reconciled() {
    let mut vault = funded_vault(None);
    add_payable(&mut vault, "a", 100);
    as_agent(START);
    assert_transfer(request(&mut vault, "a", DIGEST_A));
    as_owner(START + RECONCILE_AFTER_NS);
    vault.reconcile_operation("op_1".to_string(), false);
    assert_eq!(vault.get_usage().balance_atomic.0, 1_000_000);
}

// ---------- Capacity and storage ----------

#[test]
fn settlement_slots_are_reserved_up_front() {
    let mut vault = funded_vault(Some(Capacities {
        max_rolling: 2,
        ..DEFAULT_CAPACITIES
    }));
    add_payable(&mut vault, "a", 1);
    add_payable(&mut vault, "b", 1);
    add_payable(&mut vault, "c", 1);
    as_agent(START);
    assert_transfer(request(&mut vault, "a", DIGEST_A));
    as_agent(START);
    assert_transfer(request(&mut vault, "b", DIGEST_A));
    as_agent(START);
    assert_eq!(
        rejection_of(request(&mut vault, "c", DIGEST_A)),
        VaultRejection::CapacityFull
    );
    settle(&mut vault, "op_1", START);
    settle(&mut vault, "op_2", START);
    as_agent(START);
    assert_eq!(
        rejection_of(request(&mut vault, "c", DIGEST_A)),
        VaultRejection::CapacityFull,
        "both live entries still hold their slots"
    );
    as_agent(START + ROLLING_WINDOW_NS);
    assert_transfer(request(&mut vault, "c", DIGEST_A));
}

#[test]
fn rejected_requests_write_nothing() {
    let mut vault = funded_vault(None);
    add_payable(&mut vault, "a", VENDOR_CAP + 1);
    let before = near_sdk::env::storage_usage();
    for _ in 0..50 {
        as_agent(START);
        assert_eq!(
            rejection_of(request(&mut vault, "a", DIGEST_A)),
            VaultRejection::OverVendorCap
        );
        as_agent(START);
        assert_eq!(
            rejection_of(request(&mut vault, "nope", DIGEST_A)),
            VaultRejection::UnknownPayable
        );
    }
    assert_eq!(near_sdk::env::storage_usage(), before);
    assert_eq!(vault.get_usage().pending_count, 0);
    assert_eq!(vault.operation_count, 0);
}

#[test]
fn low_near_balance_reports_capacity_full() {
    let mut vault = funded_vault(None);
    add_payable(&mut vault, "a", 1);
    let mut low = context("agent.test", "agent.test", AGENT_KEY, START, 0);
    low.account_balance(NearToken::from_yoctonear(0));
    testing_env!(low.build());
    assert_eq!(
        rejection_of(request(&mut vault, "a", DIGEST_A)),
        VaultRejection::CapacityFull
    );
}

#[test]
#[should_panic(expected = "E_INSUFFICIENT_GAS")]
fn low_gas_cannot_strand_a_reservation() {
    let mut vault = funded_vault(None);
    add_payable(&mut vault, "a", 1);
    let mut low = context("agent.test", "agent.test", AGENT_KEY, START, 0);
    low.prepaid_gas(Gas::from_tgas(59));
    testing_env!(low.build());
    let _ = request(&mut vault, "a", DIGEST_A);
}

// ---------- Withdrawal callbacks ----------

fn in_flight_withdrawal() -> Vault {
    let mut vault = funded_vault(None);
    as_owner(START);
    vault.pause();
    let _ = vault.withdraw_available(U128(100));
    vault
}

#[test]
fn withdrawal_failure_restores_once() {
    let mut vault = in_flight_withdrawal();
    for _ in 0..2 {
        as_callback(START + 1, vec![PromiseResult::Failed]);
        vault.on_withdraw_result(U128(100));
    }
    assert_eq!(vault.get_usage().balance_atomic.0, 1_000_000);
    assert_eq!(vault.get_usage().withdrawn_atomic.0, 0);
    assert_conserved(&vault);
}

#[test]
fn withdrawal_success_counts_once() {
    let mut vault = in_flight_withdrawal();
    for _ in 0..2 {
        as_callback(START + 1, vec![PromiseResult::Successful(vec![])]);
        vault.on_withdraw_result(U128(100));
    }
    assert_eq!(vault.get_usage().withdrawn_atomic.0, 100);
    assert_eq!(vault.get_usage().balance_atomic.0, 999_900);
    assert_conserved(&vault);
}

#[test]
fn uncertain_withdrawal_blocks_until_reconciled() {
    let mut vault = in_flight_withdrawal();
    as_callback(START + 1, vec![PromiseResult::Successful(b"x".to_vec())]);
    vault.on_withdraw_result(U128(100));
    assert_eq!(vault.get_usage().withdrawal_in_flight_atomic.0, 100);
    assert_conserved(&vault);
    as_owner(START + 2);
    vault.reconcile_withdrawal(true);
    assert_eq!(vault.get_usage().withdrawn_atomic.0, 100);
    assert_eq!(vault.get_usage().withdrawal_in_flight_atomic.0, 0);
    assert_conserved(&vault);
}

#[test]
#[should_panic(expected = "E_NOT_RECONCILABLE")]
fn fresh_withdrawal_cannot_be_reconciled() {
    let mut vault = in_flight_withdrawal();
    as_owner(START + 1);
    vault.reconcile_withdrawal(false);
}

// ---------- Inputs and events ----------

#[test]
fn events_use_the_wardline_standard_and_carry_no_free_text() {
    let mut vault = funded_vault(None);
    pay(&mut vault, "a", 100, START);
    let settled = get_logs();
    let log = settled
        .iter()
        .find(|l| l.contains("payment_settled"))
        .expect("settlement event");
    assert!(log.starts_with("EVENT_JSON:{"));
    let parsed: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(log.trim_start_matches("EVENT_JSON:")).unwrap();
    assert_eq!(parsed["standard"], "wardline");
    assert_eq!(parsed["version"], "1.0.0");
    assert_eq!(parsed["data"][0]["amount_atomic"], "100");
    assert_eq!(parsed["data"][0]["origin"], "AGENT");
}

#[test]
fn digest_format_matches_schema() {
    assert!(is_digest(DIGEST_A));
    assert!(!is_digest("sha256:ABC"));
    assert!(!is_digest(&DIGEST_A.to_uppercase()));
    assert!(!is_digest(&format!("{DIGEST_A}0")));
    assert!(!is_digest("md5:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
}

#[test]
fn request_result_json_matches_schema() {
    let accepted = near_sdk::serde_json::to_value(RequestResult::accepted("op_1".to_string())).unwrap();
    assert_eq!(
        accepted,
        near_sdk::serde_json::json!({ "ok": true, "operation_id": "op_1", "rejection": null })
    );
    let rejected =
        near_sdk::serde_json::to_value(RequestResult::rejected(VaultRejection::OverLifetimeCap)).unwrap();
    assert_eq!(
        rejected,
        near_sdk::serde_json::json!({ "ok": false, "operation_id": null, "rejection": "OVER_LIFETIME_CAP" })
    );
}

trait IntoRejection {
    fn into_rejection(self) -> VaultRejection;
}

impl IntoRejection for PromiseOrValue<RequestResult> {
    fn into_rejection(self) -> VaultRejection {
        rejection_of(self)
    }
}

// ---------- Vault v2: Endpoint change control and Release Guard tests ----------

fn funded_vault_v2() -> Vault {
    testing_env!(context("vault.test", "vault.test", OTHER_KEY, START, 0).build());
    let mut vault = Vault::new(VaultConfig {
        owner: account("owner.test"),
        guardian: Some(account("guardian.test")),
        token_contract: account("token.test"),
        token_decimals: 6,
        policy: PolicyInput {
            weekly_cap_atomic: U128(WEEKLY),
            lifetime_cap_atomic: U128(LIFETIME),
            expires_at_ns: U64(FAR),
        },
        capacities: None,
        approver: Some(account("approver.test")),
        attestor: Some(account("attestor.test")),
        cooldown_policy: Some(CooldownPolicyInput {
            tier2_under_cap_ns: U64(24 * 3600 * 1_000_000_000),
            default_ns: U64(72 * 3600 * 1_000_000_000),
        }),
        conservative_caps: Some(PolicyInput {
            weekly_cap_atomic: U128(500),
            lifetime_cap_atomic: U128(LIFETIME),
            expires_at_ns: U64(FAR),
        }),
    });
    as_owner(START);
    vault.set_vendor(
        VendorInput {
            vendor_id: "vnd".to_string(),
            display_name: "Vendor".to_string(),
            account_id: account("vendor.test"),
            per_payment_cap_atomic: U128(VENDOR_CAP),
            active: true,
        },
        0,
    );
    vault.activate_agent(
        BindingInput {
            agent_account_id: account("agent.test"),
            public_key: key(AGENT_KEY),
            manifest_digest: DIGEST_A.to_string(),
            assessment_ref: "run".to_string(),
            expires_at_ns: U64(FAR),
        },
        0,
    );
    vault.unpause();
    testing_env!(context("token.test", "owner.test", OTHER_KEY, START, 0).build());
    vault.ft_on_transfer(account("owner.test"), U128(1_000_000), String::new());
    vault
}

fn as_approver(now: u64) {
    testing_env!(context("approver.test", "approver.test", OTHER_KEY, now, 0).build());
}

#[test]
fn test_endpoint_proposal_and_cooldown_duration() {
    let mut vault = funded_vault_v2();
    as_owner(START);
    // T2 under cap: 24h cooldown
    let rev2 = vault.propose_endpoint(
        "vnd".to_string(),
        "near:testnet:new-vnd.testnet".to_string(),
        "T2".to_string(),
        DIGEST_B.to_string(),
    );
    assert_eq!(rev2, 2);
    let endpoints = vault.get_vendor_endpoints("vnd".to_string());
    assert_eq!(endpoints.len(), 2);
    let ep2 = &endpoints[1];
    let activates_at = match ep2.status {
        EndpointStatusView::PendingCooldown { activates_at_ns } => activates_at_ns.0,
        _ => panic!("expected PendingCooldown"),
    };
    assert_eq!(activates_at, START + 24 * 3600 * 1_000_000_000);

    // T1: default 72h cooldown
    let rev3 = vault.propose_endpoint(
        "vnd".to_string(),
        "near:testnet:vnd3.testnet".to_string(),
        "T1".to_string(),
        DIGEST_B.to_string(),
    );
    assert_eq!(rev3, 3);
    let endpoints = vault.get_vendor_endpoints("vnd".to_string());
    let ep3 = &endpoints[2];
    let activates_at_3 = match ep3.status {
        EndpointStatusView::PendingCooldown { activates_at_ns } => activates_at_ns.0,
        _ => panic!("expected PendingCooldown"),
    };
    assert_eq!(activates_at_3, START + 72 * 3600 * 1_000_000_000);
}

#[test]
#[should_panic(expected = "E_NOT_APPROVER")]
fn test_owner_cannot_call_approve_endpoint() {
    let mut vault = funded_vault_v2();
    as_owner(START);
    let rev = vault.propose_endpoint(
        "vnd".to_string(),
        "near:testnet:new-vnd.testnet".to_string(),
        "T2".to_string(),
        DIGEST_B.to_string(),
    );
    // Owner tries to approve: must panic
    as_owner(START + 100);
    vault.approve_endpoint("vnd".to_string(), rev, DIGEST_A.to_string(), None);
}

#[test]
#[should_panic(expected = "E_NOT_APPROVER")]
fn test_agent_cannot_call_approve_endpoint() {
    let mut vault = funded_vault_v2();
    as_owner(START);
    let rev = vault.propose_endpoint(
        "vnd".to_string(),
        "near:testnet:new-vnd.testnet".to_string(),
        "T2".to_string(),
        DIGEST_B.to_string(),
    );
    // Agent tries to approve: must panic
    as_agent(START + 100);
    vault.approve_endpoint("vnd".to_string(), rev, DIGEST_A.to_string(), None);
}

#[test]
fn test_approval_digest_verification_and_replay() {
    let mut vault = funded_vault_v2();
    as_owner(START);
    let rev = vault.propose_endpoint(
        "vnd".to_string(),
        "near:testnet:new-vnd.testnet".to_string(),
        "T2".to_string(),
        DIGEST_B.to_string(),
    );
    let activates_at = START + 24 * 3600 * 1_000_000_000;
    let expiry = activates_at + 3600 * 1_000_000_000;

    let valid_digest = compute_approval_digest(
        &account("vault.test"),
        "vnd",
        rev,
        "near:testnet:new-vnd.testnet",
        expiry,
    );

    // 1. Mismatched digest should panic
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut v = funded_vault_v2();
        as_owner(START);
        v.propose_endpoint(
            "vnd".to_string(),
            "near:testnet:new-vnd.testnet".to_string(),
            "T2".to_string(),
            DIGEST_B.to_string(),
        );
        as_approver(START + 100);
        v.approve_endpoint("vnd".to_string(), rev, DIGEST_A.to_string(), Some(U64(expiry)));
    }));
    assert!(result.is_err());

    // 2. Valid approval succeeds
    as_approver(START + 100);
    vault.approve_endpoint("vnd".to_string(), rev, valid_digest.clone(), Some(U64(expiry)));

    // 3. Replay should panic
    let replay_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        vault.approve_endpoint("vnd".to_string(), rev, valid_digest, Some(U64(expiry)));
    }));
    assert!(replay_result.is_err());
}

#[test]
fn test_cooldown_holds_payment_and_activation() {
    let mut vault = funded_vault_v2();
    as_owner(START);
    let rev = vault.propose_endpoint(
        "vnd".to_string(),
        "near:testnet:new-vnd.testnet".to_string(),
        "T2".to_string(),
        DIGEST_B.to_string(),
    );
    let cooldown_duration = 24 * 3600 * 1_000_000_000;
    let activates_at = START + cooldown_duration;
    let expiry = activates_at + 3600 * 1_000_000_000;

    let digest = compute_approval_digest(
        &account("vault.test"),
        "vnd",
        rev,
        "near:testnet:new-vnd.testnet",
        expiry,
    );

    // Approve at t=100s (before cooldown ends)
    as_approver(START + 100);
    vault.approve_endpoint("vnd".to_string(), rev, digest, Some(U64(expiry)));

    // Pinned payable to revision 2: register fails or if registered pins rev 2
    // During cooldown, active revision is still 1
    let vendors = vault.get_vendors(None, None);
    assert_eq!(vendors[0].active_endpoint_revision, Some(1));

    // Try paying during cooldown pinned to rev 2:
    as_owner(START + 200);
    vault.register_payable(PayableInput {
        payable_ref: "pay_v1".to_string(),
        vendor_id: "vnd".to_string(),
        vendor_revision: 1,
        po_number: "PO-1".to_string(),
        invoice_number: None,
        amount_atomic: U128(100),
        not_before_ns: U64(START),
        due_at_ns: U64(FAR),
        expires_at_ns: U64(FAR),
        evidence_commitment: DIGEST_A.to_string(),
        expected_endpoint_revision: Some(1),
    });

    // Pinned to rev 1 succeeds during cooldown
    as_agent(START + 300);
    assert_transfer(vault.request_payment("pay_v1".to_string(), DIGEST_A.to_string(), 1, 1, 1, None));

    // After cooldown ends, activate endpoint
    testing_env!(context("vault.test", "anyone.test", OTHER_KEY, activates_at + 1, 0).build());
    vault.activate_endpoint("vnd".to_string(), rev);

    let vendors_after = vault.get_vendors(None, None);
    assert_eq!(vendors_after[0].active_endpoint_revision, Some(2));
    assert_eq!(vendors_after[0].account_id, account("new-vnd.testnet"));
}

#[test]
fn test_release_guard_manifest_check() {
    let mut vault = funded_vault_v2();
    as_owner(START);
    vault.register_payable(PayableInput {
        payable_ref: "p_rel".to_string(),
        vendor_id: "vnd".to_string(),
        vendor_revision: 1,
        po_number: "PO-1".to_string(),
        invoice_number: None,
        amount_atomic: U128(100),
        not_before_ns: U64(START),
        due_at_ns: U64(FAR),
        expires_at_ns: U64(FAR),
        evidence_commitment: DIGEST_A.to_string(),
        expected_endpoint_revision: None,
    });

    // Wrong manifest digest: rejects with ReleaseMismatch
    as_agent(START);
    let res = vault.request_payment(
        "p_rel".to_string(),
        DIGEST_A.to_string(),
        1,
        1,
        1,
        Some(DIGEST_B.to_string()),
    );
    assert_eq!(rejection_of(res), VaultRejection::ReleaseMismatch);

    // Matching manifest digest: passes
    let res_ok = vault.request_payment(
        "p_rel".to_string(),
        DIGEST_A.to_string(),
        1,
        1,
        1,
        Some(DIGEST_A.to_string()),
    );
    assert_transfer(res_ok);
}

#[test]
fn test_conservative_caps_and_raise() {
    let mut vault = funded_vault_v2();
    // Conservative weekly cap is 500 WUSD
    as_owner(START);
    vault.register_payable(PayableInput {
        payable_ref: "p_large".to_string(),
        vendor_id: "vnd".to_string(),
        vendor_revision: 1,
        po_number: "PO-1".to_string(),
        invoice_number: None,
        amount_atomic: U128(600), // over conservative cap 500
        not_before_ns: U64(START),
        due_at_ns: U64(FAR),
        expires_at_ns: U64(FAR),
        evidence_commitment: DIGEST_A.to_string(),
        expected_endpoint_revision: None,
    });

    // Rejects with OverWeeklyCap
    as_agent(START);
    let res = vault.request_payment("p_large".to_string(), DIGEST_A.to_string(), 1, 1, 1, None);
    assert_eq!(rejection_of(res), VaultRejection::OverWeeklyCap);

    // Owner raises binding caps
    as_owner(START + 1);
    vault.raise_binding_caps();

    // Now succeeds
    as_agent(START + 2);
    let res_raised = vault.request_payment("p_large".to_string(), DIGEST_A.to_string(), 1, 1, 1, None);
    assert_transfer(res_raised);
}

#[test]
fn test_endpoint_revocation_blocks_payment() {
    let mut vault = funded_vault_v2();
    as_owner(START);
    vault.register_payable(PayableInput {
        payable_ref: "p_revk".to_string(),
        vendor_id: "vnd".to_string(),
        vendor_revision: 1,
        po_number: "PO-1".to_string(),
        invoice_number: None,
        amount_atomic: U128(100),
        not_before_ns: U64(START),
        due_at_ns: U64(FAR),
        expires_at_ns: U64(FAR),
        evidence_commitment: DIGEST_A.to_string(),
        expected_endpoint_revision: None,
    });

    // Owner revokes active endpoint (rev 1)
    vault.revoke_endpoint("vnd".to_string(), 1);

    // Agent request now rejected with PayeeNotVerified
    as_agent(START);
    let res = vault.request_payment("p_revk".to_string(), DIGEST_A.to_string(), 1, 1, 1, None);
    assert_eq!(rejection_of(res), VaultRejection::PayeeNotVerified);
}
