//! Test only. Never deployed next to a production vault, and the testnet deploy script leaves it out.
//!
//! Two jobs:
//! 1. `forward`: calls anything, so tests can make the vault see a predecessor that differs from the signer.
//! 2. A scriptable fake token: a vault configured with this account as its token gets `ft_transfer`
//!    results a real token would not produce on demand, and can be held PENDING for as long as a test
//!    needs, using NEAR's yield and resume. That makes "while pending" tests deterministic.

use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, CryptoHash, Gas, GasWeight, NearToken, Promise, PromiseError};

const DATA_ID_REGISTER: u64 = 0;

#[near(serializers = [json, borsh])]
#[serde(rename_all = "snake_case")]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TokenMode {
    /// Succeeds with no return value, like a real `ft_transfer`.
    #[default]
    Ok,
    /// Panics.
    Fail,
    /// Succeeds, but returns a value `ft_transfer` never returns.
    Weird,
    /// Waits, until `release_held` says how to finish.
    Hold,
}

#[near(contract_state)]
#[derive(Default)]
pub struct TestProxy {
    mode: TokenMode,
    transfer_count: u32,
    held: Vec<CryptoHash>,
}

#[near]
impl TestProxy {
    /// Calls `receiver.method(args_json)` and returns its result. Forwards any attached deposit
    /// unless `deposit_yocto` is given.
    #[payable]
    pub fn forward(
        &mut self,
        receiver: AccountId,
        method: String,
        args_json: String,
        gas_tgas: u64,
        deposit_yocto: Option<U128>,
    ) -> Promise {
        let deposit = deposit_yocto
            .map(|d| NearToken::from_yoctonear(d.0))
            .unwrap_or_else(env::attached_deposit);
        Promise::new(receiver).function_call(
            method,
            args_json.into_bytes(),
            deposit,
            Gas::from_tgas(gas_tgas),
        )
    }

    pub fn set_mode(&mut self, mode: TokenMode) {
        self.mode = mode;
    }

    /// Fake token: credits a vault the way a real token's `ft_transfer_call` would.
    pub fn fund(&mut self, vault: AccountId, amount: U128) -> Promise {
        Promise::new(vault).function_call(
            "ft_on_transfer".to_string(),
            near_sdk::serde_json::json!({
                "sender_id": env::predecessor_account_id(),
                "amount": amount,
                "msg": "",
            })
            .to_string()
            .into_bytes(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(20),
        )
    }

    /// Fake token: behaves as `mode` says.
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        let _ = (receiver_id, amount, memo);
        self.transfer_count += 1;
        match self.mode {
            TokenMode::Ok => {}
            TokenMode::Fail => env::panic_str("fake token failure"),
            TokenMode::Weird => env::value_return(b"\"surprise\""),
            TokenMode::Hold => {
                let promise = env::promise_yield_create(
                    "on_held",
                    [],
                    Gas::from_tgas(5),
                    GasWeight(0),
                    DATA_ID_REGISTER,
                );
                let data_id: CryptoHash = env::read_register(DATA_ID_REGISTER)
                    .expect("yield id")
                    .try_into()
                    .expect("32 bytes");
                self.held.push(data_id);
                env::promise_return(promise);
            }
        }
    }

    /// Finishes the oldest held transfer. `outcome` is "ok" or "fail".
    pub fn release_held(&mut self, outcome: String) {
        let data_id = self.held.remove(0);
        let payload = near_sdk::serde_json::to_vec(&outcome).expect("json");
        assert!(env::promise_yield_resume(&data_id, payload), "yield already gone");
    }

    #[private]
    pub fn on_held(&mut self, #[callback_result] outcome: Result<String, PromiseError>) {
        match outcome.as_deref() {
            Ok("ok") => {}
            _ => env::panic_str("fake token failure after hold"),
        }
    }

    pub fn get_transfer_count(&self) -> u32 {
        self.transfer_count
    }

    pub fn get_held_count(&self) -> u32 {
        self.held.len() as u32
    }
}
