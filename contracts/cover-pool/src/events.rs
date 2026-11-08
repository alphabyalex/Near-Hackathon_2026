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
