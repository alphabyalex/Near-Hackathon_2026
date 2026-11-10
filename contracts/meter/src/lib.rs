use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupSet};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    PromiseOrValue,
};

pub mod events;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_FT_TRANSFER_CALL: Gas = Gas::from_tgas(40);
const GAS_CALLBACK: Gas = Gas::from_tgas(25);

#[ext_contract(ext_ft)]
pub trait FtCore {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128>;
}

fn read_transfer_outcome() -> bool {
    if env::promise_results_count() == 0 {
        return false;
    }
    for i in 0..env::promise_results_count() {
        match env::promise_result_checked(i, 64) {
            Ok(_) => {}
            Err(_) => return false,
        }
    }
    true
}

#[derive(near_sdk::serde::Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct FundMsg {
    #[allow(dead_code)]
    action: Option<String>,
    budget_id: Option<String>,
}

const PERIOD_DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;
const PERIOD_WEEK_NS: u64 = 7 * PERIOD_DAY_NS;
const PERIOD_MONTH_NS: u64 = 30 * PERIOD_DAY_NS;

fn period_duration_ns(period: &str) -> u64 {
    match period {
        "day" => PERIOD_DAY_NS,
        "month" => PERIOD_MONTH_NS,
        _ => PERIOD_WEEK_NS,
    }
}

pub fn recover_eth_signer(text: &str, signature_hex: &str) -> Result<String, &'static str> {
    let sig_hex = signature_hex.strip_prefix("0x").unwrap_or(signature_hex);
    if sig_hex.len() != 130 {
        return Err("Signature must be 65 bytes (130 hex characters)");
    }
    let sig_bytes = hex::decode(sig_hex).map_err(|_| "Invalid hex in signature")?;
    let mut v = sig_bytes[64];
    if v >= 27 {
        v -= 27;
    }
    if v > 1 {
        return Err("Invalid recovery id v");
    }

    let prefix = format!("\x19Ethereum Signed Message:\n{}{}", text.len(), text);
    let hash = env::keccak256_array(prefix.as_bytes());

    let pubkey = env::ecrecover(&hash, &sig_bytes[0..64], v, false)
        .ok_or("ecrecover failed to recover public key")?;

    let pubkey_hash = env::keccak256_array(&pubkey);
    let eth_addr = hex::encode(&pubkey_hash[12..32]);
    Ok(format!("0x{}", eth_addr.to_lowercase()))
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemberView {
    pub member: String,
    pub allowance: U128,
    pub used: U128,
    pub reserved: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BudgetView {
    pub budget_id: String,
    pub name: String,
    pub owner: AccountId,
    pub deposit: U128,
    pub spent: U128,
    pub reserved: U128,
    pub period: String,
    pub period_start: String,
    pub members: Vec<MemberView>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReputationView {
    pub budget_id: String,
    pub name: String,
    pub owner: AccountId,
    pub tier: String,
    pub proven_calls: u32,
    pub refused_calls: u32,
    pub claims: u32,
    pub clean_calls: u32,
    pub next_tier_at: Option<u32>,
    pub fee_bps: u32,
    pub coverage_cap: String,
    pub spent: String,
    pub fees_paid: String,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct StoredReputation {
    pub tier_idx: u8,
    pub proven_calls: u32,
    pub refused_calls: u32,
    pub claims: u32,
    pub clean_calls: u32,
    pub spent: u128,
    pub fees_paid: u128,
}

impl StoredReputation {
    pub fn default() -> Self {
        Self {
            tier_idx: 0,
            proven_calls: 0,
            refused_calls: 0,
            claims: 0,
            clean_calls: 0,
            spent: 0,
            fees_paid: 0,
        }
    }

    pub fn tier_name(&self) -> &'static str {
        match self.tier_idx {
            0 => "bronze",
            1 => "silver",
            _ => "gold",
        }
    }

    pub fn fee_bps(&self) -> u32 {
        match self.tier_idx {
            0 => 200,
            1 => 150,
            _ => 100,
        }
    }

    pub fn coverage_cap(&self) -> U128 {
        match self.tier_idx {
            0 => U128(25_000_000),
            1 => U128(50_000_000),
            _ => U128(100_000_000),
        }
    }

    pub fn next_tier_at(&self) -> Option<u32> {
        match self.tier_idx {
            0 => Some(10),
            1 => Some(25),
            _ => None,
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct MemberInput {
    pub member: String,
    pub allowance: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SettlementProof {
    pub model_id: String,
    pub request_hash: String,
    pub response_hash: String,
    pub text: String,
    pub signature: String,
    pub signing_address: String,
    pub chat_id: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReserveResultView {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reserved: Option<U128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettleResultView {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<U128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refund: Option<U128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReleaseResultView {
    pub tx: String,
    pub refund: U128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct StoredMember {
    allowance: u128,
    used: u128,
    reserved: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct StoredBudget {
    name: String,
    owner: AccountId,
    deposit: u128,
    spent: u128,
    reserved: u128,
    period: String,
    period_start_ns: u64,
    members: Vec<(String, StoredMember)>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct StoredReservation {
    budget_id: String,
    member: String,
    model_id: String,
    amount: u128,
    created_at_ns: u64,
}

#[near]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Budgets,
    Reservations,
    SettledChats,
    AttestedCache,
    Reputations,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MeterContract {
    pub owner: AccountId,
    pub token_contract: AccountId,
    pub registry_contract: AccountId,
    pub pool_contract: AccountId,
    pub cover_fee_bps: u64,
    budgets: IterableMap<String, StoredBudget>,
    reservations: IterableMap<String, StoredReservation>,
    settled_chats: LookupSet<String>,
    attested_cache: IterableMap<String, String>,
    reputations: IterableMap<String, StoredReputation>,
    pub coverage_multiplier_bps: u32,
    pub fee_bps_bronze: u32,
    pub fee_bps_silver: u32,
    pub fee_bps_gold: u32,
}

#[near]
impl MeterContract {
    #[init]
    pub fn new(
        owner: AccountId,
        token_contract: AccountId,
        registry_contract: AccountId,
        pool_contract: AccountId,
        cover_fee_bps: Option<u64>,
    ) -> Self {
        require!(!env::state_exists(), "Already initialized");
        let mut contract = Self {
            owner,
            token_contract,
            registry_contract,
            pool_contract,
            cover_fee_bps: cover_fee_bps.unwrap_or(200),
            budgets: IterableMap::new(StorageKey::Budgets),
            reservations: IterableMap::new(StorageKey::Reservations),
            settled_chats: LookupSet::new(StorageKey::SettledChats),
            attested_cache: IterableMap::new(StorageKey::AttestedCache),
            reputations: IterableMap::new(StorageKey::Reputations),
            coverage_multiplier_bps: 10_000,
            fee_bps_bronze: 200,
            fee_bps_silver: 150,
            fee_bps_gold: 100,
        };

        // Seed default model signers for self-contained verification
        contract.attested_cache.insert(
            "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
            "0xfe0071895500a9755c18044948ab4f4e1a7f337e".to_string(),
        );
        contract.attested_cache.insert(
            "wardline/sim-echo-1".to_string(),
            "0x90f79bf6eb2c4f870365e785982e1f101e93b906".to_string(),
        );

        contract
    }

fn roll_budget(budget: &mut StoredBudget, now_ns: u64) {
    let length = period_duration_ns(&budget.period);
    if now_ns.saturating_sub(budget.period_start_ns) >= length {
        let cycles = (now_ns - budget.period_start_ns) / length;
        budget.period_start_ns += cycles * length;
        for (_, member) in budget.members.iter_mut() {
            member.used = 0;
        }
    }
}

    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        #[near(serializers = [borsh])]
        struct OldMeterContract10 {
            owner: AccountId,
            token_contract: AccountId,
            registry_contract: AccountId,
            pool_contract: AccountId,
            cover_fee_bps: u64,
            budgets: IterableMap<String, StoredBudget>,
            reservations: IterableMap<String, StoredReservation>,
            settled_chats: LookupSet<String>,
            attested_cache: IterableMap<String, String>,
            reputations: IterableMap<String, StoredReputation>,
        }

        #[near(serializers = [borsh])]
        struct OldMeterContract9 {
            owner: AccountId,
            token_contract: AccountId,
            registry_contract: AccountId,
            pool_contract: AccountId,
            cover_fee_bps: u64,
            budgets: IterableMap<String, StoredBudget>,
            reservations: IterableMap<String, StoredReservation>,
            settled_chats: LookupSet<String>,
            attested_cache: IterableMap<String, String>,
        }

        if let Some(old) = env::state_read::<OldMeterContract10>() {
            Self {
                owner: old.owner,
                token_contract: old.token_contract,
                registry_contract: old.registry_contract,
                pool_contract: old.pool_contract,
                cover_fee_bps: old.cover_fee_bps,
                budgets: old.budgets,
                reservations: old.reservations,
                settled_chats: old.settled_chats,
                attested_cache: old.attested_cache,
                reputations: old.reputations,
                coverage_multiplier_bps: 11_000,
                fee_bps_bronze: 200,
                fee_bps_silver: 125,
                fee_bps_gold: 100,
            }
        } else if let Some(old) = env::state_read::<OldMeterContract9>() {
            Self {
                owner: old.owner,
                token_contract: old.token_contract,
                registry_contract: old.registry_contract,
                pool_contract: old.pool_contract,
                cover_fee_bps: old.cover_fee_bps,
                budgets: old.budgets,
                reservations: old.reservations,
                settled_chats: old.settled_chats,
                attested_cache: old.attested_cache,
                reputations: IterableMap::new(StorageKey::Reputations),
                coverage_multiplier_bps: 11_000,
                fee_bps_bronze: 200,
                fee_bps_silver: 125,
                fee_bps_gold: 100,
            }
        } else {
            env::state_read::<Self>().expect("Failed to deserialize state")
        }
    }

    pub fn create_budget(
        &mut self,
        budget_id: String,
        name: String,
        owner: AccountId,
        deposit: U128,
        period: String,
        members: Vec<MemberInput>,
    ) {
        require!(
            env::predecessor_account_id() == self.owner
                || env::predecessor_account_id() == owner,
            "E_NOT_OWNER: unauthorized to create budget"
        );
        require!(!self.budgets.contains_key(&budget_id), "Budget already exists");

        let stored_members = members
            .into_iter()
            .map(|m| {
                (
                    m.member,
                    StoredMember {
                        allowance: m.allowance.0,
                        used: 0,
                        reserved: 0,
                    },
                )
            })
            .collect();

        let budget = StoredBudget {
            name,
            owner: owner.clone(),
            deposit: deposit.0,
            spent: 0,
            reserved: 0,
            period,
            period_start_ns: env::block_timestamp(),
            members: stored_members,
        };

        let dep_str = deposit.0.to_string();
        self.budgets.insert(budget_id.clone(), budget);
        events::budget_created(&budget_id, owner.as_str(), &dep_str);
    }

    pub fn get_budget(&self, budget_id: String) -> Option<BudgetView> {
        let budget = self.budgets.get(&budget_id)?;
        let mut b = budget.clone();
        Self::roll_budget(&mut b, env::block_timestamp());

        Some(BudgetView {
            budget_id,
            name: b.name,
            owner: b.owner,
            deposit: U128(b.deposit),
            spent: U128(b.spent),
            reserved: U128(b.reserved),
            period: b.period,
            period_start: format!("{}ns", b.period_start_ns),
            members: b
                .members
                .iter()
                .map(|(id, m)| MemberView {
                    member: id.clone(),
                    allowance: U128(m.allowance),
                    used: U128(m.used),
                    reserved: U128(m.reserved),
                })
                .collect(),
        })
    }

    pub fn list_budgets(&self) -> Vec<BudgetView> {
        self.budgets
            .keys()
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .filter_map(|id| self.get_budget(id))
            .collect()
    }

    pub fn reserve(
        &mut self,
        budget_id: String,
        member: String,
        call_id: String,
        model_id: String,
        max_amount: U128,
    ) -> ReserveResultView {
        if self.reservations.contains_key(&call_id) {
            return ReserveResultView {
                ok: false,
                reserved: None,
                reason: Some("DUPLICATE_CALL".to_string()),
                detail: Some(format!("Call {} is already reserved.", call_id)),
            };
        }

        let budget = match self.budgets.get_mut(&budget_id) {
            Some(b) => b,
            None => {
                return ReserveResultView {
                    ok: false,
                    reserved: None,
                    reason: Some("UNKNOWN_BUDGET".to_string()),
                    detail: Some(format!("No budget {}.", budget_id)),
                };
            }
        };

        Self::roll_budget(budget, env::block_timestamp());

        let member_record = match budget.members.iter_mut().find(|(m, _)| *m == member) {
            Some((_, rec)) => rec,
            None => {
                return ReserveResultView {
                    ok: false,
                    reserved: None,
                    reason: Some("UNKNOWN_MEMBER".to_string()),
                    detail: Some(format!("{} is not a member of {}.", member, budget_id)),
                };
            }
        };

        let amount = max_amount.0;
        if member_record.used.saturating_add(member_record.reserved).saturating_add(amount)
            > member_record.allowance
        {
            return ReserveResultView {
                ok: false,
                reserved: None,
                reason: Some("ALLOWANCE_EXHAUSTED".to_string()),
                detail: format!(
                    "{} has spent {} and reserved {} of allowance {}.",
                    member, member_record.used, member_record.reserved, member_record.allowance
                ).into(),
            };
        }

        if budget.spent.saturating_add(budget.reserved).saturating_add(amount) > budget.deposit {
            return ReserveResultView {
                ok: false,
                reserved: None,
                reason: Some("BUDGET_EXHAUSTED".to_string()),
                detail: format!(
                    "Budget {} has spent {} and reserved {} of deposit {}.",
                    budget_id, budget.spent, budget.reserved, budget.deposit
                ).into(),
            };
        }

        member_record.reserved = member_record.reserved.saturating_add(amount);
        budget.reserved = budget.reserved.saturating_add(amount);

        self.reservations.insert(
            call_id.clone(),
            StoredReservation {
                budget_id: budget_id.clone(),
                member: member.clone(),
                model_id: model_id.clone(),
                amount,
                created_at_ns: env::block_timestamp(),
            },
        );

        events::call_reserved(&budget_id, &member, &call_id, &model_id, &amount.to_string());

        ReserveResultView {
            ok: true,
            reserved: Some(max_amount),
            reason: None,
            detail: None,
        }
    }

    pub fn settle(
        &mut self,
        call_id: String,
        amount: U128,
        proof: SettlementProof,
        pay_to: Option<AccountId>,
    ) -> PromiseOrValue<SettleResultView> {
        let reservation = match self.reservations.get(&call_id) {
            Some(r) => r.clone(),
            None => {
                return PromiseOrValue::Value(SettleResultView {
                    ok: false,
                    tx: None,
                    amount: None,
                    refund: None,
                    reason: Some("NO_RESERVATION".to_string()),
                    detail: Some(format!("No reservation for call {}.", call_id)),
                });
            }
        };

        if amount.0 > reservation.amount {
            return PromiseOrValue::Value(SettleResultView {
                ok: false,
                tx: None,
                amount: None,
                refund: None,
                reason: Some("OVER_RESERVATION".to_string()),
                detail: Some(format!(
                    "Requested amount {} exceeds reservation {}.",
                    amount.0, reservation.amount
                )),
            });
        }

        if self.settled_chats.contains(&proof.chat_id) {
            return PromiseOrValue::Value(SettleResultView {
                ok: false,
                tx: None,
                amount: None,
                refund: None,
                reason: Some("REPLAYED".to_string()),
                detail: Some(format!("Chat id {} was already settled.", proof.chat_id)),
            });
        }

        // Validate proof text format
        let expected_text = format!(
            "{}:{}:{}",
            proof.model_id, proof.request_hash, proof.response_hash
        );
        if proof.text != expected_text || proof.model_id != reservation.model_id {
            return PromiseOrValue::Value(SettleResultView {
                ok: false,
                tx: None,
                amount: None,
                refund: None,
                reason: Some("PROOF_REJECTED".to_string()),
                detail: Some("Signed text does not match model and content hashes.".to_string()),
            });
        }

        // On-chain EIP-191 signature verification
        let recovered_signer = match recover_eth_signer(&proof.text, &proof.signature) {
            Ok(signer) => signer,
            Err(e) => {
                return PromiseOrValue::Value(SettleResultView {
                    ok: false,
                    tx: None,
                    amount: None,
                    refund: None,
                    reason: Some("PROOF_REJECTED".to_string()),
                    detail: Some(format!("Signature recovery failed: {}", e)),
                });
            }
        };

        if recovered_signer.to_lowercase() != proof.signing_address.to_lowercase() {
            return PromiseOrValue::Value(SettleResultView {
                ok: false,
                tx: None,
                amount: None,
                refund: None,
                reason: Some("PROOF_REJECTED".to_string()),
                detail: Some(format!(
                    "Recovered signer {} does not match signing address {}.",
                    recovered_signer, proof.signing_address
                )),
            });
        }

        // Check attestation
        let is_attested = self
            .attested_cache
            .get(&proof.model_id)
            .map(|a| a.to_lowercase() == recovered_signer.to_lowercase())
            .unwrap_or(false);

        if !is_attested {
            return PromiseOrValue::Value(SettleResultView {
                ok: false,
                tx: None,
                amount: None,
                refund: None,
                reason: Some("MODEL_NOT_ATTESTED".to_string()),
                detail: Some(format!(
                    "Signer {} is not attested for {}.",
                    recovered_signer, proof.model_id
                )),
            });
        }

        let fee_bps = self
            .reputations
            .get(&reservation.budget_id)
            .map(|r| self.get_fee_bps_for_tier(r.tier_idx))
            .unwrap_or(self.cover_fee_bps as u32);
        let cover_fee = (amount.0 * fee_bps as u128) / 10_000;
        let provider_payout = amount.0.saturating_sub(cover_fee);

        if let Some(recipient) = pay_to {
            let provider_promise = ext_ft::ext(self.token_contract.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(
                    recipient,
                    U128(provider_payout),
                    Some("Wardline AI Settlement".to_string()),
                );

            let combined_promise = if cover_fee > 0 {
                let fee_promise = ext_ft::ext(self.token_contract.clone())
                    .with_attached_deposit(NearToken::from_yoctonear(1))
                    .with_static_gas(GAS_FT_TRANSFER_CALL)
                    .ft_transfer_call(
                        self.pool_contract.clone(),
                        U128(cover_fee),
                        Some("Coverage fee".to_string()),
                        "{\"fee\":true}".to_string(),
                    );
                provider_promise.and(fee_promise)
            } else {
                provider_promise
            };

            combined_promise
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_CALLBACK)
                        .on_settlement_payout(call_id, amount, proof.chat_id, recovered_signer),
                )
                .into()
        } else {
            // In-state settlement without token transfer
            self.settled_chats.insert(proof.chat_id.clone());
            self.reservations.remove(&call_id);

            let refund = reservation.amount.saturating_sub(amount.0);

            if let Some(budget) = self.budgets.get_mut(&reservation.budget_id) {
                budget.reserved = budget.reserved.saturating_sub(reservation.amount);
                budget.spent = budget.spent.saturating_add(amount.0);

                if let Some((_, member)) = budget
                    .members
                    .iter_mut()
                    .find(|(m, _)| *m == reservation.member)
                {
                    member.reserved = member.reserved.saturating_sub(reservation.amount);
                    member.used = member.used.saturating_add(amount.0);
                }
            }

            // Update reputation in-state
            let mut rep = self
                .reputations
                .get(&reservation.budget_id)
                .cloned()
                .unwrap_or_else(StoredReputation::default);
            rep.proven_calls = rep.proven_calls.saturating_add(1);
            rep.clean_calls = rep.clean_calls.saturating_add(1);
            rep.spent = rep.spent.saturating_add(amount.0);
            rep.fees_paid = rep.fees_paid.saturating_add(cover_fee);
            if rep.tier_idx == 0 && rep.clean_calls >= 10 {
                rep.tier_idx = 1;
                rep.clean_calls = 0;
            } else if rep.tier_idx == 1 && rep.clean_calls >= 25 {
                rep.tier_idx = 2;
                rep.clean_calls = 0;
            }
            self.reputations.insert(reservation.budget_id.clone(), rep);

            let tx = format!("{}:{}", env::current_account_id(), call_id);
            events::call_settled(
                &call_id,
                &proof.chat_id,
                &amount.0.to_string(),
                &refund.to_string(),
                &recovered_signer,
            );

            PromiseOrValue::Value(SettleResultView {
                ok: true,
                tx: Some(tx),
                amount: Some(amount),
                refund: Some(U128(refund)),
                reason: None,
                detail: None,
            })
        }
    }

    #[private]
    pub fn on_settlement_payout(
        &mut self,
        call_id: String,
        amount: U128,
        chat_id: String,
        recovered_signer: String,
    ) -> SettleResultView {
        if !read_transfer_outcome() {
            return SettleResultView {
                ok: false,
                tx: None,
                amount: None,
                refund: None,
                reason: Some("TRANSFER_FAILED".to_string()),
                detail: Some("Token payout transfer failed; reservation was restored".to_string()),
            };
        }

        let reservation = match self.reservations.remove(&call_id) {
            Some(r) => r,
            None => {
                return SettleResultView {
                    ok: false,
                    tx: None,
                    amount: None,
                    refund: None,
                    reason: Some("NO_RESERVATION".to_string()),
                    detail: Some("Reservation not found on callback".to_string()),
                };
            }
        };

        self.settled_chats.insert(chat_id.clone());
        let refund = reservation.amount.saturating_sub(amount.0);

        if let Some(budget) = self.budgets.get_mut(&reservation.budget_id) {
            budget.reserved = budget.reserved.saturating_sub(reservation.amount);
            budget.spent = budget.spent.saturating_add(amount.0);

            if let Some((_, member)) = budget
                .members
                .iter_mut()
                .find(|(m, _)| *m == reservation.member)
            {
                member.reserved = member.reserved.saturating_sub(reservation.amount);
                member.used = member.used.saturating_add(amount.0);
            }
        }

        // Update reputation
        let fee_bps = self
            .reputations
            .get(&reservation.budget_id)
            .map(|r| self.get_fee_bps_for_tier(r.tier_idx))
            .unwrap_or(self.cover_fee_bps as u32);
        let cover_fee = (amount.0 * fee_bps as u128) / 10_000;

        let mut rep = self
            .reputations
            .get(&reservation.budget_id)
            .cloned()
            .unwrap_or_else(StoredReputation::default);
        rep.proven_calls = rep.proven_calls.saturating_add(1);
        rep.clean_calls = rep.clean_calls.saturating_add(1);
        rep.spent = rep.spent.saturating_add(amount.0);
        rep.fees_paid = rep.fees_paid.saturating_add(cover_fee);
        if rep.tier_idx == 0 && rep.clean_calls >= 10 {
            rep.tier_idx = 1;
            rep.clean_calls = 0;
        } else if rep.tier_idx == 1 && rep.clean_calls >= 25 {
            rep.tier_idx = 2;
            rep.clean_calls = 0;
        }
        self.reputations.insert(reservation.budget_id.clone(), rep);

        let tx = format!("{}:{}", env::current_account_id(), call_id);
        events::call_settled(
            &call_id,
            &chat_id,
            &amount.0.to_string(),
            &refund.to_string(),
            &recovered_signer,
        );

        SettleResultView {
            ok: true,
            tx: Some(tx),
            amount: Some(amount),
            refund: Some(U128(refund)),
            reason: None,
            detail: None,
        }
    }

    pub fn release(&mut self, call_id: String, reason: String) -> ReleaseResultView {
        let reservation = self
            .reservations
            .remove(&call_id)
            .expect("No reservation to release");

        if let Some(budget) = self.budgets.get_mut(&reservation.budget_id) {
            budget.reserved = budget.reserved.saturating_sub(reservation.amount);

            if let Some((_, member)) = budget
                .members
                .iter_mut()
                .find(|(m, _)| *m == reservation.member)
            {
                member.reserved = member.reserved.saturating_sub(reservation.amount);
            }
        }

        let mut rep = self
            .reputations
            .get(&reservation.budget_id)
            .cloned()
            .unwrap_or_else(StoredReputation::default);
        rep.refused_calls = rep.refused_calls.saturating_add(1);
        self.reputations.insert(reservation.budget_id.clone(), rep);

        let refund = reservation.amount;
        let tx = format!("{}:{}", env::current_account_id(), call_id);
        events::call_released(&call_id, &reason, &refund.to_string());

        ReleaseResultView {
            tx,
            refund: U128(refund),
        }
    }

    pub fn record_claim(&mut self, budget_id: String) {
        require!(
            env::predecessor_account_id() == self.owner || env::predecessor_account_id() == self.pool_contract,
            "Unauthorized caller"
        );
        let mut rep = self
            .reputations
            .get(&budget_id)
            .cloned()
            .unwrap_or_else(StoredReputation::default);
        rep.claims = rep.claims.saturating_add(1);
        if rep.tier_idx > 0 {
            rep.tier_idx -= 1;
        }
        rep.clean_calls = 0;
        self.reputations.insert(budget_id, rep);
    }

    pub fn get_fee_bps_for_tier(&self, tier_idx: u8) -> u32 {
        match tier_idx {
            0 => self.fee_bps_bronze,
            1 => self.fee_bps_silver,
            _ => self.fee_bps_gold,
        }
    }

    pub fn get_coverage_cap_for_tier(&self, tier_idx: u8) -> U128 {
        let base: u128 = match tier_idx {
            0 => 25_000_000,
            1 => 50_000_000,
            _ => 100_000_000,
        };
        let cap = (base.saturating_mul(self.coverage_multiplier_bps as u128)) / 10_000;
        U128(cap)
    }

    pub fn get_reputation(&self, budget_id: String) -> Option<ReputationView> {
        let budget = self.budgets.get(&budget_id)?;
        let rep = self
            .reputations
            .get(&budget_id)
            .cloned()
            .unwrap_or_else(StoredReputation::default);
        let fee_bps = self.get_fee_bps_for_tier(rep.tier_idx);
        let cap = self.get_coverage_cap_for_tier(rep.tier_idx);
        Some(ReputationView {
            budget_id: budget_id.clone(),
            name: budget.name.clone(),
            owner: budget.owner.clone(),
            tier: rep.tier_name().to_string(),
            proven_calls: rep.proven_calls,
            refused_calls: rep.refused_calls,
            claims: rep.claims,
            clean_calls: rep.clean_calls,
            next_tier_at: rep.next_tier_at(),
            fee_bps,
            coverage_cap: cap.0.to_string(),
            spent: rep.spent.to_string(),
            fees_paid: rep.fees_paid.to_string(),
        })
    }

    pub fn list_reputations(&self) -> Vec<ReputationView> {
        self.budgets
            .keys()
            .filter_map(|bid| self.get_reputation(bid.clone()))
            .collect()
    }

    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = sender_id;
        if env::predecessor_account_id() != self.token_contract {
            return PromiseOrValue::Value(amount);
        }
        if let Ok(parsed) = near_sdk::serde_json::from_str::<FundMsg>(&msg) {
            if let Some(budget_id) = parsed.budget_id {
                if let Some(budget) = self.budgets.get_mut(&budget_id) {
                    budget.deposit = budget.deposit.saturating_add(amount.0);
                    events::budget_funded(
                        &budget_id,
                        &amount.0.to_string(),
                        &budget.deposit.to_string(),
                    );
                    return PromiseOrValue::Value(U128(0));
                }
            }
        }
        PromiseOrValue::Value(amount)
    }

    pub fn fund(&mut self, budget_id: String, amount: U128) {
        require!(
            env::predecessor_account_id() == self.token_contract,
            "E_NOT_AUTHORIZED: funding must go through ft_on_transfer from token contract"
        );
        let budget = self
            .budgets
            .get_mut(&budget_id)
            .expect("Budget does not exist");
        budget.deposit = budget.deposit.saturating_add(amount.0);
        events::budget_funded(
            &budget_id,
            &amount.0.to_string(),
            &budget.deposit.to_string(),
        );
    }

    pub fn set_allowance(&mut self, budget_id: String, member: String, allowance: U128) {
        let budget = self
            .budgets
            .get_mut(&budget_id)
            .expect("Budget does not exist");

        require!(
            env::predecessor_account_id() == self.owner
                || env::predecessor_account_id() == budget.owner,
            "E_NOT_OWNER: unauthorized to change allowance"
        );

        if let Some((_, mem)) = budget.members.iter_mut().find(|(m, _)| *m == member) {
            mem.allowance = allowance.0;
        } else {
            budget.members.push((
                member.clone(),
                StoredMember {
                    allowance: allowance.0,
                    used: 0,
                    reserved: 0,
                },
            ));
        }

        events::allowance_set(&budget_id, &member, &allowance.0.to_string());
    }

    pub fn set_owner(&mut self, owner: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner,
            "E_NOT_OWNER: unauthorized"
        );
        self.owner = owner;
    }

    pub fn set_cover_fee_bps(&mut self, cover_fee_bps: u64) {
        require!(
            env::predecessor_account_id() == self.owner
                || env::predecessor_account_id().as_str().starts_with("dao."),
            "E_NOT_OWNER: only owner or DAO can change cover fee"
        );
        require!(cover_fee_bps <= 10_000, "Invalid fee bps");
        self.cover_fee_bps = cover_fee_bps;
    }

    pub fn set_param(&mut self, name: String, value: String) {
        require!(
            env::predecessor_account_id() == self.owner
                || env::predecessor_account_id() == self.pool_contract
                || env::predecessor_account_id().as_str().starts_with("dao."),
            "E_NOT_OWNER: only owner, DAO, or pool contract can change parameters"
        );
        match name.as_str() {
            "cover_fee_bps" => {
                let bps: u64 = value.parse().expect("Invalid u64");
                require!(bps <= 10_000, "Invalid fee bps");
                self.cover_fee_bps = bps;
            }
            "coverage_multiplier" | "coverage_multiplier_bps" => {
                let bps: u32 = value.parse().expect("Invalid u32");
                require!(
                    bps >= 2_500 && bps <= 40_000,
                    "Coverage multiplier out of bounds (2500-40000 bps)"
                );
                self.coverage_multiplier_bps = bps;
            }
            "fee_bps_bronze" => {
                let bps: u32 = value.parse().expect("Invalid u32");
                require!(
                    bps >= 10 && bps <= 1_000,
                    "Fee bps out of bounds (10-1000 bps)"
                );
                self.fee_bps_bronze = bps;
            }
            "fee_bps_silver" => {
                let bps: u32 = value.parse().expect("Invalid u32");
                require!(
                    bps >= 10 && bps <= 1_000,
                    "Fee bps out of bounds (10-1000 bps)"
                );
                self.fee_bps_silver = bps;
            }
            "fee_bps_gold" => {
                let bps: u32 = value.parse().expect("Invalid u32");
                require!(
                    bps >= 10 && bps <= 1_000,
                    "Fee bps out of bounds (10-1000 bps)"
                );
                self.fee_bps_gold = bps;
            }
            _ => env::panic_str("Unknown parameter"),
        }
        events::param_set(&name, &value);
    }

    pub fn get_fee_bps(&self, tier: String) -> u32 {
        match tier.as_str() {
            "bronze" => self.fee_bps_bronze,
            "silver" => self.fee_bps_silver,
            "gold" => self.fee_bps_gold,
            _ => env::panic_str("Unknown tier"),
        }
    }

    pub fn get_coverage_multiplier_bps(&self) -> u32 {
        self.coverage_multiplier_bps
    }

    pub fn get_cover_fee_bps(&self) -> u64 {
        self.cover_fee_bps
    }

    pub fn update_attested_model(&mut self, model_id: String, signing_address: String) {
        require!(
            env::predecessor_account_id() == self.owner,
            "E_NOT_OWNER: only owner can update attested cache"
        );
        self.attested_cache
            .insert(model_id, signing_address.to_lowercase());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    #[test]
    fn test_budget_reserve_settle_release() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("meter.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut meter = MeterContract::new(
            owner.clone(),
            "token.testnet".parse().unwrap(),
            "registry.testnet".parse().unwrap(),
            "pool.testnet".parse().unwrap(),
            Some(200),
        );

        meter.create_budget(
            "bgt_test".to_string(),
            "Test Budget".to_string(),
            owner.clone(),
            U128(25_000_000), // 25 WUSD
            "week".to_string(),
            vec![MemberInput {
                member: "alice.testnet".to_string(),
                allowance: U128(5_000_000), // 5 WUSD
            }],
        );

        let res = meter.reserve(
            "bgt_test".to_string(),
            "alice.testnet".to_string(),
            "call_1".to_string(),
            "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
            U128(1_000_000),
        );
        assert!(res.ok);
        assert_eq!(res.reserved, Some(U128(1_000_000)));

        // Attempting to reserve beyond allowance
        let res_over = meter.reserve(
            "bgt_test".to_string(),
            "alice.testnet".to_string(),
            "call_2".to_string(),
            "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
            U128(5_000_000),
        );
        assert!(!res_over.ok);
        assert_eq!(res_over.reason, Some("ALLOWANCE_EXHAUSTED".to_string()));

        // Release call_1
        let rel = meter.release("call_1".to_string(), "canceled".to_string());
        assert_eq!(rel.refund, U128(1_000_000));

        let b = meter.get_budget("bgt_test".to_string()).unwrap();
        assert_eq!(b.reserved, U128(0));
        assert_eq!(b.members[0].reserved, U128(0));
    }

    #[test]
    fn test_ecrecover_verification_on_real_fixture() {
        let text = "deepseek-ai/DeepSeek-V4.1-Flash-1017:ce6c1665d87a3a276478aac4111c299e3e35a220cda09647310b708390b6b66c:2f3005787eeb988e39090f62298cda16aa43971208c4eeb40fc6109af9a8cdb9";
        let sig = "0xa3486136dcb0e7592a5aacef44edb867648ed75ac98e8b3e4621468a68795dc564e006f5aa2d192530c6a87437e76c0a1ce45fdc8c8edd576c84bc94da717e641c";
        let expected_signer = "0xfe0071895500a9755c18044948ab4f4e1a7f337e";

        let context = VMContextBuilder::new().build();
        testing_env!(context);

        let recovered = recover_eth_signer(text, sig).expect("recovery failed");
        assert_eq!(recovered, expected_signer);
    }

    #[test]
    fn test_settle_with_real_proof_and_replay_protection() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("meter.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut meter = MeterContract::new(
            owner.clone(),
            "token.testnet".parse().unwrap(),
            "registry.testnet".parse().unwrap(),
            "pool.testnet".parse().unwrap(),
            Some(200),
        );

        meter.create_budget(
            "bgt_test".to_string(),
            "Test Budget".to_string(),
            owner.clone(),
            U128(25_000_000),
            "week".to_string(),
            vec![MemberInput {
                member: "alice.testnet".to_string(),
                allowance: U128(5_000_000),
            }],
        );

        let reserve_res = meter.reserve(
            "bgt_test".to_string(),
            "alice.testnet".to_string(),
            "call_deepseek".to_string(),
            "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
            U128(1_000),
        );
        assert!(reserve_res.ok);

        let proof = SettlementProof {
            model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
            request_hash: "ce6c1665d87a3a276478aac4111c299e3e35a220cda09647310b708390b6b66c".to_string(),
            response_hash: "2f3005787eeb988e39090f62298cda16aa43971208c4eeb40fc6109af9a8cdb9".to_string(),
            text: "deepseek-ai/DeepSeek-V4.1-Flash-1017:ce6c1665d87a3a276478aac4111c299e3e35a220cda09647310b708390b6b66c:2f3005787eeb988e39090f62298cda16aa43971208c4eeb40fc6109af9a8cdb9".to_string(),
            signature: "0xa3486136dcb0e7592a5aacef44edb867648ed75ac98e8b3e4621468a68795dc564e006f5aa2d192530c6a87437e76c0a1ce45fdc8c8edd576c84bc94da717e641c".to_string(),
            signing_address: "0xfe0071895500a9755c18044948ab4f4e1a7f337e".to_string(),
            chat_id: "chatcmpl-96068d70-a320-4475-a330-400be955d887".to_string(),
        };

        let settle_res = match meter.settle("call_deepseek".to_string(), U128(739), proof, None) {
            PromiseOrValue::Value(v) => v,
            _ => panic!("Expected Value"),
        };
        assert!(settle_res.ok);
        assert_eq!(settle_res.amount, Some(U128(739)));
        assert_eq!(settle_res.refund, Some(U128(261)));

        // Replay attempt with same chat_id fails
        let meter_reserve_2 = meter.reserve(
            "bgt_test".to_string(),
            "alice.testnet".to_string(),
            "call_deepseek_2".to_string(),
            "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
            U128(1_000),
        );
        assert!(meter_reserve_2.ok);

        let replay_proof = SettlementProof {
            model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
            request_hash: "ce6c1665d87a3a276478aac4111c299e3e35a220cda09647310b708390b6b66c".to_string(),
            response_hash: "2f3005787eeb988e39090f62298cda16aa43971208c4eeb40fc6109af9a8cdb9".to_string(),
            text: "deepseek-ai/DeepSeek-V4.1-Flash-1017:ce6c1665d87a3a276478aac4111c299e3e35a220cda09647310b708390b6b66c:2f3005787eeb988e39090f62298cda16aa43971208c4eeb40fc6109af9a8cdb9".to_string(),
            signature: "0xa3486136dcb0e7592a5aacef44edb867648ed75ac98e8b3e4621468a68795dc564e006f5aa2d192530c6a87437e76c0a1ce45fdc8c8edd576c84bc94da717e641c".to_string(),
            signing_address: "0xfe0071895500a9755c18044948ab4f4e1a7f337e".to_string(),
            chat_id: "chatcmpl-96068d70-a320-4475-a330-400be955d887".to_string(),
        };
        let replay_res = match meter.settle("call_deepseek_2".to_string(), U128(739), replay_proof, None) {
            PromiseOrValue::Value(v) => v,
            _ => panic!("Expected Value"),
        };
        assert!(!replay_res.ok);
        assert_eq!(replay_res.reason, Some("REPLAYED".to_string()));
    }

    #[test]
    fn test_ft_on_transfer_funding() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("meter.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut meter = MeterContract::new(
            owner.clone(),
            token.clone(),
            "registry.testnet".parse().unwrap(),
            "pool.testnet".parse().unwrap(),
            Some(200),
        );

        meter.create_budget(
            "bgt_ft".to_string(),
            "FT Budget".to_string(),
            owner.clone(),
            U128(10_000_000),
            "week".to_string(),
            vec![],
        );

        // Predecessor must be token contract for ft_on_transfer
        let transfer_context = VMContextBuilder::new()
            .current_account_id("meter.testnet".parse().unwrap())
            .predecessor_account_id(token.clone())
            .build();
        testing_env!(transfer_context);

        let msg = r#"{"action":"fund","budget_id":"bgt_ft"}"#.to_string();
        let res = meter.ft_on_transfer("alice.testnet".parse().unwrap(), U128(5_000_000), msg);
        match res {
            PromiseOrValue::Value(refund) => assert_eq!(refund.0, 0),
            _ => panic!("Expected Value"),
        }

        let b = meter.get_budget("bgt_ft".to_string()).unwrap();
        assert_eq!(b.deposit, U128(15_000_000));
    }

    #[test]
    fn test_reputation_progression_and_claim() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("meter.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut meter = MeterContract::new(
            owner.clone(),
            "token.testnet".parse().unwrap(),
            "registry.testnet".parse().unwrap(),
            "pool.testnet".parse().unwrap(),
            Some(200),
        );

        meter.create_budget(
            "bgt_rep".to_string(),
            "Reputation House".to_string(),
            owner.clone(),
            U128(100_000_000),
            "week".to_string(),
            vec![MemberInput {
                member: "agent.testnet".to_string(),
                allowance: U128(100_000_000),
            }],
        );

        // 1. Initial reputation is Bronze
        let rep = meter.get_reputation("bgt_rep".to_string()).unwrap();
        assert_eq!(rep.tier, "bronze");
        assert_eq!(rep.fee_bps, 200);
        assert_eq!(rep.coverage_cap, "25000000");
        assert_eq!(rep.next_tier_at, Some(10));
        assert_eq!(rep.clean_calls, 0);

        // 2. Perform 10 settlements to promote from Bronze to Silver
        for i in 0..10 {
            let call_id = format!("call_{}", i);
            let res = meter.reserve(
                "bgt_rep".to_string(),
                "agent.testnet".to_string(),
                call_id.clone(),
                "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
                U128(1_000),
            );
            assert!(res.ok);

            let proof = SettlementProof {
                model_id: "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
                request_hash: "ce6c1665d87a3a276478aac4111c299e3e35a220cda09647310b708390b6b66c".to_string(),
                response_hash: "2f3005787eeb988e39090f62298cda16aa43971208c4eeb40fc6109af9a8cdb9".to_string(),
                text: "deepseek-ai/DeepSeek-V4.1-Flash-1017:ce6c1665d87a3a276478aac4111c299e3e35a220cda09647310b708390b6b66c:2f3005787eeb988e39090f62298cda16aa43971208c4eeb40fc6109af9a8cdb9".to_string(),
                signature: "0xa3486136dcb0e7592a5aacef44edb867648ed75ac98e8b3e4621468a68795dc564e006f5aa2d192530c6a87437e76c0a1ce45fdc8c8edd576c84bc94da717e641c".to_string(),
                signing_address: "0xfe0071895500a9755c18044948ab4f4e1a7f337e".to_string(),
                chat_id: format!("chat_rep_{}", i),
            };

            let s = meter.settle(call_id, U128(500), proof, None);
            match s {
                PromiseOrValue::Value(res) => assert!(res.ok),
                _ => panic!("Expected Value in in-state settlement"),
            }
        }

        // Now should be Silver
        let rep_silver = meter.get_reputation("bgt_rep".to_string()).unwrap();
        assert_eq!(rep_silver.tier, "silver");
        assert_eq!(rep_silver.fee_bps, 150);
        assert_eq!(rep_silver.coverage_cap, "50000000");
        assert_eq!(rep_silver.next_tier_at, Some(25));
        assert_eq!(rep_silver.proven_calls, 10);
        assert_eq!(rep_silver.clean_calls, 0);

        // 3. Claim moves it back down to Bronze
        meter.record_claim("bgt_rep".to_string());
        let rep_demoted = meter.get_reputation("bgt_rep".to_string()).unwrap();
        assert_eq!(rep_demoted.tier, "bronze");
        assert_eq!(rep_demoted.fee_bps, 200);
        assert_eq!(rep_demoted.claims, 1);
        assert_eq!(rep_demoted.clean_calls, 0);

        // 4. Release records refused call without demoting
        let res_ref = meter.reserve(
            "bgt_rep".to_string(),
            "agent.testnet".to_string(),
            "call_refused".to_string(),
            "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
            U128(1_000),
        );
        assert!(res_ref.ok);
        meter.release("call_refused".to_string(), "provider_timeout".to_string());

        let rep_after_refuse = meter.get_reputation("bgt_rep".to_string()).unwrap();
        assert_eq!(rep_after_refuse.refused_calls, 1);
        assert_eq!(rep_after_refuse.tier, "bronze");

        let reps = meter.list_reputations();
        assert_eq!(reps.len(), 1);
        assert_eq!(reps[0].budget_id, "bgt_rep");
    }

    #[test]
    #[should_panic(expected = "E_NOT_AUTHORIZED")]
    fn test_fund_rejects_unauthorized_caller() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let attacker: AccountId = "attacker.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("meter.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut meter = MeterContract::new(
            owner.clone(),
            token.clone(),
            "registry.testnet".parse().unwrap(),
            "pool.testnet".parse().unwrap(),
            Some(200),
        );

        meter.create_budget(
            "bgt_fund_hole".to_string(),
            "Test Budget".to_string(),
            owner.clone(),
            U128(10_000_000),
            "week".to_string(),
            vec![],
        );

        let attacker_context = VMContextBuilder::new()
            .current_account_id("meter.testnet".parse().unwrap())
            .predecessor_account_id(attacker)
            .build();
        testing_env!(attacker_context);

        // Attacker calling fund directly must panic with E_NOT_AUTHORIZED
        meter.fund("bgt_fund_hole".to_string(), U128(10_000_000));
    }

    #[test]
    fn test_set_param_bounds_and_auth() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("meter.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut meter = MeterContract::new(
            owner.clone(),
            token.clone(),
            "registry.testnet".parse().unwrap(),
            "pool.testnet".parse().unwrap(),
            Some(200),
        );

        meter.create_budget(
            "bgt_dyn".to_string(),
            "Dyn Budget".to_string(),
            owner.clone(),
            U128(10_000_000),
            "week".to_string(),
            vec![],
        );

        // Update fee for silver and multiplier
        meter.set_param("fee_bps_silver".to_string(), "125".to_string());
        assert_eq!(meter.get_fee_bps("silver".to_string()), 125);

        meter.set_param("coverage_multiplier".to_string(), "12500".to_string());
        assert_eq!(meter.get_coverage_multiplier_bps(), 12500);

        // Pool contract can also call set_param
        let pool_context = VMContextBuilder::new()
            .current_account_id("meter.testnet".parse().unwrap())
            .predecessor_account_id("pool.testnet".parse().unwrap())
            .build();
        testing_env!(pool_context);
        meter.set_param("fee_bps_gold".to_string(), "80".to_string());
        assert_eq!(meter.get_fee_bps("gold".to_string()), 80);
    }

    #[test]
    #[should_panic(expected = "Fee bps out of bounds")]
    fn test_set_param_fee_out_of_bounds() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("meter.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut meter = MeterContract::new(
            owner.clone(),
            token.clone(),
            "registry.testnet".parse().unwrap(),
            "pool.testnet".parse().unwrap(),
            Some(200),
        );

        meter.set_param("fee_bps_bronze".to_string(), "5000".to_string());
    }

    #[test]
    #[should_panic(expected = "Coverage multiplier out of bounds")]
    fn test_set_param_coverage_multiplier_out_of_bounds() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("meter.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut meter = MeterContract::new(
            owner.clone(),
            token.clone(),
            "registry.testnet".parse().unwrap(),
            "pool.testnet".parse().unwrap(),
            Some(200),
        );

        meter.set_param("coverage_multiplier".to_string(), "50000".to_string());
    }
}
