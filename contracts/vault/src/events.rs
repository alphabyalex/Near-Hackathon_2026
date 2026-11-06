use near_sdk::env;
use near_sdk::serde::Serialize;
use near_sdk::serde_json::{Value, json};

pub const STANDARD: &str = "spendgym";
pub const VERSION: &str = "1.0.0";

pub fn emit(event: &str, data: Value) {
    let value = json!({
        "standard": STANDARD,
        "version": VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{value}"));
}

pub fn to_value<T: Serialize>(value: &T) -> Value {
    near_sdk::serde_json::to_value(value).expect("event data must serialize")
}
