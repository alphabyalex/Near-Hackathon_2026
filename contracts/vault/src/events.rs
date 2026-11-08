//! NEP-297 events, matching `RedlineEventSchema`. Typed fields only: ids, refs, amounts,
//! revisions, digests and statuses. Never invoice text.

use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

use crate::types::Origin;

fn emit(event: &str, data: Value) {
    let envelope = json!({
        "standard": "redline",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{envelope}"));
}

pub fn vendor_set(vendor_id: &str, revision: u64, account_id: &AccountId, cap: u128, active: bool) {
    emit(
        "vendor_set",
        json!({
            "vendor_id": vendor_id,
            "revision": revision,
            "account_id": account_id,
            "per_payment_cap_atomic": cap.to_string(),
            "active": active,
        }),
    );
}

pub fn payable_registered(
    payable_ref: &str,
    vendor_id: &str,
    vendor_revision: u64,
    amount: u128,
    recipient: &AccountId,
    due_at_ns: u64,
) {
    emit(
        "payable_registered",
        json!({
            "payable_ref": payable_ref,
            "vendor_id": vendor_id,
            "vendor_revision": vendor_revision,
            "amount_atomic": amount.to_string(),
            "recipient": recipient,
            "due_at_ns": due_at_ns.to_string(),
        }),
    );
}

pub fn payable_cancelled(payable_ref: &str) {
    emit("payable_cancelled", json!({ "payable_ref": payable_ref }));
}

pub fn payable_reopened(payable_ref: &str) {
    emit("payable_reopened", json!({ "payable_ref": payable_ref }));
}

pub fn policy_set(revision: u64, weekly_cap: u128, lifetime_cap: u128, expires_at_ns: u64) {
    emit(
        "policy_set",
        json!({
            "revision": revision,
            "weekly_cap_atomic": weekly_cap.to_string(),
            "lifetime_cap_atomic": lifetime_cap.to_string(),
            "expires_at_ns": expires_at_ns.to_string(),
        }),
    );
}

pub fn agent_activated(agent: &AccountId, revision: u64, manifest_digest: &str, expires_at_ns: u64) {
    emit(
        "agent_activated",
        json!({
            "agent_account_id": agent,
            "revision": revision,
            "manifest_digest": manifest_digest,
            "expires_at_ns": expires_at_ns.to_string(),
        }),
    );
}

pub fn agent_revoked(agent: &AccountId, revision: u64) {
    emit(
        "agent_revoked",
        json!({ "agent_account_id": agent, "revision": revision }),
    );
}

pub fn vault_paused(by: &AccountId) {
    emit("vault_paused", json!({ "by": by }));
}

pub fn vault_unpaused(by: &AccountId) {
    emit("vault_unpaused", json!({ "by": by }));
}

pub fn payment_reserved(
    operation_id: &str,
    payable_ref: &str,
    amount: u128,
    recipient: &AccountId,
    origin: Origin,
    attempt: u32,
) {
    emit(
        "payment_reserved",
        json!({
            "operation_id": operation_id,
            "payable_ref": payable_ref,
            "amount_atomic": amount.to_string(),
            "recipient": recipient,
            "origin": origin.as_str(),
            "attempt": attempt,
        }),
    );
}

fn payment_outcome(event: &str, operation_id: &str, payable_ref: &str, amount: u128, origin: Origin) {
    emit(
        event,
        json!({
            "operation_id": operation_id,
            "payable_ref": payable_ref,
            "amount_atomic": amount.to_string(),
            "origin": origin.as_str(),
        }),
    );
}

pub fn payment_settled(operation_id: &str, payable_ref: &str, amount: u128, origin: Origin) {
    payment_outcome("payment_settled", operation_id, payable_ref, amount, origin);
}

pub fn payment_failed(operation_id: &str, payable_ref: &str, amount: u128, origin: Origin) {
    payment_outcome("payment_failed", operation_id, payable_ref, amount, origin);
}

pub fn payment_uncertain(operation_id: &str, payable_ref: &str, amount: u128, origin: Origin) {
    payment_outcome("payment_uncertain", operation_id, payable_ref, amount, origin);
}

pub fn operation_reconciled(operation_id: &str, payable_ref: &str, settled: bool) {
    emit(
        "operation_reconciled",
        json!({ "operation_id": operation_id, "payable_ref": payable_ref, "settled": settled }),
    );
}

pub fn funding_received(sender_id: &AccountId, amount: u128) {
    emit(
        "funding_received",
        json!({ "sender_id": sender_id, "amount_atomic": amount.to_string() }),
    );
}

pub fn withdrawal(event: &str, amount: u128) {
    emit(event, json!({ "amount_atomic": amount.to_string() }));
}

pub fn endpoint_proposed(
    vendor_id: &str,
    revision: u64,
    account: &str,
    evidence_tier: &str,
    evidence_digest: &str,
    activates_at_ns: u64,
) {
    emit(
        "endpoint_proposed",
        json!({
            "vendor_id": vendor_id,
            "revision": revision,
            "account": account,
            "evidence_tier": evidence_tier,
            "evidence_digest": evidence_digest,
            "activates_at_ns": activates_at_ns.to_string(),
        }),
    );
}

pub fn endpoint_approved(vendor_id: &str, revision: u64, approver: &AccountId) {
    emit(
        "endpoint_approved",
        json!({
            "vendor_id": vendor_id,
            "revision": revision,
            "approver": approver,
        }),
    );
}

pub fn endpoint_activated(vendor_id: &str, revision: u64, account: &str) {
    emit(
        "endpoint_activated",
        json!({
            "vendor_id": vendor_id,
            "revision": revision,
            "account": account,
        }),
    );
}

pub fn endpoint_rejected(vendor_id: &str, revision: u64, by: &AccountId) {
    emit(
        "endpoint_rejected",
        json!({
            "vendor_id": vendor_id,
            "revision": revision,
            "by": by,
        }),
    );
}

pub fn endpoint_revoked(vendor_id: &str, revision: u64, by: &AccountId) {
    emit(
        "endpoint_revoked",
        json!({
            "vendor_id": vendor_id,
            "revision": revision,
            "by": by,
        }),
    );
}

pub fn release_mismatch(agent: &AccountId, presented_digest: &str, expected_digest: &str) {
    emit(
        "release_mismatch",
        json!({
            "agent_account_id": agent,
            "presented_manifest_digest": presented_digest,
            "expected_manifest_digest": expected_digest,
        }),
    );
}
