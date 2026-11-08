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

pub fn model_added(model_id: &str, signing_address: &str) {
    emit(
        "model_added",
        json!({
            "model_id": model_id,
            "signing_address": signing_address,
        }),
    );
}

pub fn provider_added(provider_id: &str, pay_to: &str, model_ids: &[String]) {
    emit(
        "provider_added",
        json!({
            "provider_id": provider_id,
            "pay_to": pay_to,
            "model_ids": model_ids,
        }),
    );
}
