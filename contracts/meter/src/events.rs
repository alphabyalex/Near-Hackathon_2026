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

pub fn budget_created(budget_id: &str, owner: &str, deposit: &str) {
    emit(
        "budget_created",
        json!({
            "budget_id": budget_id,
            "owner": owner,
            "deposit": deposit,
        }),
    );
}

pub fn budget_funded(budget_id: &str, amount: &str, new_deposit: &str) {
    emit(
        "budget_funded",
        json!({
            "budget_id": budget_id,
            "amount": amount,
            "new_deposit": new_deposit,
        }),
    );
}

pub fn allowance_set(budget_id: &str, member: &str, allowance: &str) {
    emit(
        "allowance_set",
        json!({
            "budget_id": budget_id,
            "member": member,
            "allowance": allowance,
        }),
    );
}

pub fn call_reserved(budget_id: &str, member: &str, call_id: &str, model_id: &str, amount: &str) {
    emit(
        "call_reserved",
        json!({
            "budget_id": budget_id,
            "member": member,
            "call_id": call_id,
            "model_id": model_id,
            "amount": amount,
        }),
    );
}

pub fn call_settled(call_id: &str, chat_id: &str, amount: &str, refund: &str, signer: &str) {
    emit(
        "call_settled",
        json!({
            "call_id": call_id,
            "chat_id": chat_id,
            "amount": amount,
            "refund": refund,
            "signer": signer,
        }),
    );
}

pub fn call_released(call_id: &str, reason: &str, refund: &str) {
    emit(
        "call_released",
        json!({
            "call_id": call_id,
            "reason": reason,
            "refund": refund,
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

