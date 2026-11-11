use near_sdk::env;
use near_sdk::serde_json::{json, Value};

fn emit(event: &str, data: Value) {
    let envelope = json!({
        "standard": "wardline",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", envelope));
}

pub fn pool_deposited(account: &str, amount: &str, shares: &str) {
    emit(
        "pool_deposited",
        json!({
            "account": account,
            "amount": amount,
            "shares": shares,
        }),
    );
}

pub fn pool_withdraw_requested(account: &str, id: &str, shares: &str, available_at: &str) {
    emit(
        "pool_withdraw_requested",
        json!({
            "account": account,
            "id": id,
            "shares": shares,
            "available_at": available_at,
        }),
    );
}

pub fn pool_redeemed(account: &str, id: &str, ward: &str, usdc: &str) {
    emit(
        "pool_redeemed",
        json!({
            "account": account,
            "id": id,
            "ward": ward,
            "usdc": usdc,
        }),
    );
}

/**
 * NEP-141 events (NEP-297 envelope, standard "nep141", version "1.0.0"), so wallets and indexers see
 * WARD move. Field names are the spec's: ft_mint and ft_burn carry owner_id, amount and an optional
 * memo; ft_transfer carries old_owner_id, new_owner_id, amount and an optional memo. memo is left out
 * when there is none.
 */
fn emit_nep141(event: &str, data: Value) {
    let envelope = json!({
        "standard": "nep141",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", envelope));
}

fn with_memo(mut data: Value, memo: Option<&str>) -> Value {
    if let Some(m) = memo {
        data["memo"] = json!(m);
    }
    data
}

/// WARD minted to `owner_id` by a deposit.
pub fn ft_mint_event(owner_id: &str, amount: &str, memo: Option<&str>) {
    emit_nep141("ft_mint", with_memo(json!({ "owner_id": owner_id, "amount": amount }), memo));
}

/// WARD burned from `owner_id` when a redemption pays out.
pub fn ft_burn_event(owner_id: &str, amount: &str, memo: Option<&str>) {
    emit_nep141("ft_burn", with_memo(json!({ "owner_id": owner_id, "amount": amount }), memo));
}

/// WARD moved between accounts: ft_transfer, ft_transfer_call, and the refund in ft_resolve_transfer.
pub fn ft_transfer_event(old_owner_id: &str, new_owner_id: &str, amount: &str, memo: Option<&str>) {
    emit_nep141(
        "ft_transfer",
        with_memo(json!({ "old_owner_id": old_owner_id, "new_owner_id": new_owner_id, "amount": amount }), memo),
    );
}

pub fn claim_filed(claim_id: &str, claimant: &str, amount: &str, status: &str) {
    emit(
        "claim_filed",
        json!({
            "claim_id": claim_id,
            "claimant": claimant,
            "amount": amount,
            "status": status,
        }),
    );
}

pub fn claim_approved(claim_id: &str, from_junior: &str, from_senior: &str) {
    emit(
        "claim_approved",
        json!({
            "claim_id": claim_id,
            "paid_from_junior": from_junior,
            "paid_from_senior": from_senior,
        }),
    );
}

pub fn fees_added(amount: &str, total_fees: &str) {
    emit(
        "fees_added",
        json!({
            "amount": amount,
            "total_fees": total_fees,
        }),
    );
}

pub fn param_set(name: &str, value: &str) {
    emit(
        "param_set",
        json!({
            "name": name,
            "value": value,
        }),
    );
}
