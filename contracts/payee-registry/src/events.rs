use near_sdk::serde_json::{json, Value};
use near_sdk::env;

fn emit(event: &str, data: Value) {
    let envelope = json!({
        "standard": "wardline",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{envelope}"));
}

pub fn payee_attested(domain: &str, accounts_count: usize, evidence_hash: &str) {
    emit(
        "payee_attested",
        json!({
            "domain": domain,
            "accounts_count": accounts_count,
            "evidence_hash": evidence_hash,
        }),
    );
}

pub fn payee_updated(domain: &str, accounts_count: usize, evidence_hash: &str) {
    emit(
        "payee_updated",
        json!({
            "domain": domain,
            "accounts_count": accounts_count,
            "evidence_hash": evidence_hash,
        }),
    );
}

pub fn payee_revoked(domain: &str) {
    emit(
        "payee_revoked",
        json!({
            "domain": domain,
        }),
    );
}
