use near_sdk::json_types::U128;
use near_sdk::store::IterableMap;
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    Promise, PromiseOrValue,
};

pub mod events;

const SCALE: u128 = 1_000_000;
const ONE_DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(20);
const GAS_FT_ON_TRANSFER: Gas = Gas::from_tgas(25);
const GAS_CALLBACK: Gas = Gas::from_tgas(25);

#[ext_contract(ext_ft)]
pub trait FtCore {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[ext_contract(ext_ft_receiver)]
pub trait FtReceiver {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128>;
}

#[ext_contract(ext_meter)]
pub trait MeterParamReceiver {
    fn set_param(&mut self, name: String, value: String);
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

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StorageBalance {
    pub total: NearToken,
    pub available: NearToken,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StorageBalanceBounds {
    pub min: NearToken,
    pub max: Option<NearToken>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WardPricePoint {
    pub at: String,
    pub price: String,
    pub event: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolView {
    pub tvl: String,
    pub junior: String,
    pub senior: String,
    pub junior_holder: String,
    pub ward_symbol: String,
    pub ward_name: String,
    pub ward_supply: String,
    pub ward_price: String,
    pub launch_price: String,
    pub price_history: Vec<WardPricePoint>,
    pub fees_earned: String,
    pub claims_paid: String,
    pub coverage_capacity: String,
    pub withdraw_delay_days: u32,
    pub large_claim_threshold: String,
    pub trade_url: Option<String>,
    pub share_price: String,
    pub senior_shares: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingWithdrawalView {
    pub id: String,
    pub shares: String,
    pub ward: String,
    pub value: String,
    pub requested_at: String,
    pub available_at: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolPositionView {
    pub account: String,
    pub shares: String,
    pub ward: String,
    pub ward_locked: String,
    pub value: String,
    pub pending_withdrawals: Vec<PendingWithdrawalView>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimView {
    pub claim_id: String,
    pub subject: String,
    pub claimant: String,
    pub amount: String,
    pub reason: String,
    pub status: String,
    pub paid_from_junior: String,
    pub paid_from_senior: String,
    pub ward_price_before: String,
    pub ward_price_after: String,
    pub filed_at: String,
    pub tx: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct DepositResultView {
    pub tx: String,
    pub shares: String,
    pub ward: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct WithdrawResultView {
    pub tx: String,
    pub id: String,
    pub available_at: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RedeemResultView {
    pub tx: String,
    pub usdc: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct FungibleTokenMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct StoredWithdrawal {
    id: String,
    account: AccountId,
    shares: u128,
    requested_at_ns: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum MutualAction {
    #[serde(rename = "set_fee_bps")]
    SetFeeBps { tier: String, fee_bps: u32 },
    #[serde(rename = "set_coverage_multiplier")]
    SetCoverageMultiplier { multiplier_bps: u32 },
    #[serde(rename = "cover_model")]
    CoverModel { model_id: String, signing_address: String },
    #[serde(rename = "uncover_model")]
    UncoverModel { model_id: String },
    #[serde(rename = "approve_payout")]
    ApprovePayout { claim_id: String },
    #[serde(rename = "set_withdraw_delay_days")]
    SetWithdrawDelay { days: u32 },
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MutualProposalView {
    pub id: u32,
    pub proposer: AccountId,
    pub description: String,
    pub action: MutualAction,
    pub snapshot_at: String,
    pub snapshot_supply: String,
    pub votes_for: String,
    pub votes_against: String,
    pub voters: u32,
    pub quorum: String,
    pub opens_at: String,
    pub closes_at: String,
    pub status: String,
    pub executed_at: Option<String>,
    pub tx: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GovernanceParamsView {
    pub quorum_bps: u32,
    pub voting_days: u32,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct StoredProposal {
    pub id: u32,
    pub proposer: AccountId,
    pub description: String,
    pub action: MutualAction,
    pub snapshot_supply: u128,
    pub votes_for: u128,
    pub votes_against: u128,
    pub voters: u32,
    pub opens_at_ns: u64,
    pub closes_at_ns: u64,
    pub executed_at_ns: Option<u64>,
}

/// Raw storage key for WARD's icon (ft_metadata.icon), outside the borsh state.
const WARD_ICON_KEY: &[u8] = b"ward_icon";
const WARD_ICON_MAX: usize = 16_384;

#[near]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Positions,
    Withdrawals,
    Proposals,
    ProposalVotes,
    ProposalSnapshots,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CoverPoolContract {
    pub owner: AccountId,
    pub token_contract: AccountId,
    pub junior_holder: AccountId,
    pub junior: u128,
    pub senior: u128,
    pub senior_shares: u128,
    pub fees_earned: u128,
    pub claims_paid: u128,
    pub withdraw_delay_days: u32,
    pub large_claim_threshold: u128,
    pub max_claim_bps: u64,
    pub trade_url: Option<String>,
    positions: IterableMap<AccountId, u128>,
    withdrawals: IterableMap<String, StoredWithdrawal>,
    claims: Vec<ClaimView>,
    price_history: Vec<WardPricePoint>,
    proposals: IterableMap<u32, StoredProposal>,
    proposal_votes: IterableMap<(u32, AccountId), String>,
    proposal_snapshots: IterableMap<(u32, AccountId), u128>,
    pub meter_contract: Option<AccountId>,
    pub coverage_multiplier_bps: u32,
    pub fee_bps_bronze: u32,
    pub fee_bps_silver: u32,
    pub fee_bps_gold: u32,
}

#[near]
impl CoverPoolContract {
    #[init]
    pub fn new(
        owner: AccountId,
        token_contract: AccountId,
        junior_holder: AccountId,
        junior: U128,
        withdraw_delay_days: Option<u32>,
        large_claim_threshold: Option<U128>,
        max_claim_bps: Option<u64>,
        trade_url: Option<String>,
        meter_contract: Option<AccountId>,
    ) -> Self {
        require!(!env::state_exists(), "Already initialized");
        let now_ns = env::block_timestamp();
        let initial_history = vec![WardPricePoint {
            at: format!("{}ns", now_ns),
            price: SCALE.to_string(),
            event: "launch".to_string(),
        }];

        Self {
            owner,
            token_contract,
            junior_holder,
            junior: junior.0,
            senior: 0,
            senior_shares: 0,
            fees_earned: 0,
            claims_paid: 0,
            withdraw_delay_days: withdraw_delay_days.unwrap_or(7),
            large_claim_threshold: large_claim_threshold.map(|v| v.0).unwrap_or(1_000_000_000),
            max_claim_bps: max_claim_bps.unwrap_or(1_000),
            trade_url,
            positions: IterableMap::new(StorageKey::Positions),
            withdrawals: IterableMap::new(StorageKey::Withdrawals),
            claims: Vec::new(),
            price_history: initial_history,
            proposals: IterableMap::new(StorageKey::Proposals),
            proposal_votes: IterableMap::new(StorageKey::ProposalVotes),
            proposal_snapshots: IterableMap::new(StorageKey::ProposalSnapshots),
            meter_contract,
            coverage_multiplier_bps: 10_000,
            fee_bps_bronze: 200,
            fee_bps_silver: 150,
            fee_bps_gold: 100,
        }
    }

    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        #[near(serializers = [borsh])]
        struct OldCoverPoolContractWithGov {
            owner: AccountId,
            token_contract: AccountId,
            junior_holder: AccountId,
            junior: u128,
            senior: u128,
            senior_shares: u128,
            fees_earned: u128,
            claims_paid: u128,
            withdraw_delay_days: u32,
            large_claim_threshold: u128,
            max_claim_bps: u64,
            trade_url: Option<String>,
            positions: IterableMap<AccountId, u128>,
            withdrawals: IterableMap<String, StoredWithdrawal>,
            claims: Vec<ClaimView>,
            price_history: Vec<WardPricePoint>,
            proposals: IterableMap<u32, StoredProposal>,
            proposal_votes: IterableMap<(u32, AccountId), String>,
        }

        #[near(serializers = [borsh])]
        struct OldCoverPoolContractPreGov {
            owner: AccountId,
            token_contract: AccountId,
            junior_holder: AccountId,
            junior: u128,
            senior: u128,
            senior_shares: u128,
            fees_earned: u128,
            claims_paid: u128,
            withdraw_delay_days: u32,
            large_claim_threshold: u128,
            max_claim_bps: u64,
            trade_url: Option<String>,
            positions: IterableMap<AccountId, u128>,
            withdrawals: IterableMap<String, StoredWithdrawal>,
            claims: Vec<ClaimView>,
            price_history: Vec<WardPricePoint>,
        }

        // Already the current shape: nothing to migrate (kept from Tharun's 276b5ab).
        if let Some(state) = env::state_read::<Self>() {
            return state;
        }

        if let Some(old) = env::state_read::<OldCoverPoolContractWithGov>() {
            let mut proposal_snapshots = IterableMap::new(StorageKey::ProposalSnapshots);
            for (acc, &bal) in old.positions.iter() {
                if bal > 0 {
                    proposal_snapshots.insert((3, acc.clone()), bal);
                }
            }
            Self {
                owner: old.owner,
                token_contract: old.token_contract,
                junior_holder: old.junior_holder,
                junior: old.junior,
                senior: old.senior,
                senior_shares: old.senior_shares,
                fees_earned: old.fees_earned,
                claims_paid: old.claims_paid,
                withdraw_delay_days: 7,
                large_claim_threshold: old.large_claim_threshold,
                max_claim_bps: old.max_claim_bps,
                trade_url: old.trade_url,
                positions: old.positions,
                withdrawals: old.withdrawals,
                claims: old.claims,
                price_history: old.price_history,
                proposals: old.proposals,
                proposal_votes: old.proposal_votes,
                proposal_snapshots,
                meter_contract: Some("meter.wardline-labs.testnet".parse().unwrap()),
                coverage_multiplier_bps: 11_000,
                fee_bps_bronze: 200,
                fee_bps_silver: 125,
                fee_bps_gold: 100,
            }
        } else if let Some(old) = env::state_read::<OldCoverPoolContractPreGov>() {
            Self {
                owner: old.owner,
                token_contract: old.token_contract,
                junior_holder: old.junior_holder,
                junior: old.junior,
                senior: old.senior,
                senior_shares: old.senior_shares,
                fees_earned: old.fees_earned,
                claims_paid: old.claims_paid,
                withdraw_delay_days: 7,
                large_claim_threshold: old.large_claim_threshold,
                max_claim_bps: old.max_claim_bps,
                trade_url: old.trade_url,
                positions: old.positions,
                withdrawals: old.withdrawals,
                claims: old.claims,
                price_history: old.price_history,
                proposals: IterableMap::new(StorageKey::Proposals),
                proposal_votes: IterableMap::new(StorageKey::ProposalVotes),
                proposal_snapshots: IterableMap::new(StorageKey::ProposalSnapshots),
                meter_contract: Some("meter.wardline-labs.testnet".parse().unwrap()),
                coverage_multiplier_bps: 11_000,
                fee_bps_bronze: 200,
                fee_bps_silver: 125,
                fee_bps_gold: 100,
            }
        } else {
            env::state_read::<Self>().expect("Failed to deserialize state")
        }
    }

    fn price(&self) -> u128 {
        if self.senior_shares == 0 {
            SCALE
        } else {
            (self.senior.saturating_mul(SCALE)) / self.senior_shares
        }
    }

    fn mark(&mut self, event: &str, now_ns: u64) {
        self.price_history.push(WardPricePoint {
            at: format!("{}ns", now_ns),
            price: self.price().to_string(),
            event: event.to_string(),
        });
    }

    fn mint(&mut self, account: &AccountId, amount: u128) -> u128 {
        let price = self.price();
        let shares = (amount.saturating_mul(SCALE)) / price;
        self.senior = self.senior.saturating_add(amount);
        self.senior_shares = self.senior_shares.saturating_add(shares);
        let existing = self.positions.get(account).copied().unwrap_or(0);
        self.positions.insert(account.clone(), existing.saturating_add(shares));
        if shares > 0 {
            events::ft_mint_event(account.as_str(), &shares.to_string(), None);
        }
        shares
    }

    // NEP-141 View Methods
    pub fn ft_total_supply(&self) -> U128 {
        U128(self.senior_shares)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.positions.get(&account_id).copied().unwrap_or(0))
    }

    pub fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: "ft-1.0.0".to_string(),
            name: "Wardline Mutual share".to_string(),
            symbol: "WARD".to_string(),
            icon: env::storage_read(WARD_ICON_KEY).and_then(|b| String::from_utf8(b).ok()),
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }

    /// Owner only: WARD's wallet icon, a data:image URL (the Horizon mark). None clears it. Kept in its own
    /// storage key, outside the contract state, so it can change without a migration.
    pub fn set_icon(&mut self, icon: Option<String>) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner can set the icon");
        match icon {
            Some(icon) => {
                require!(icon.starts_with("data:image/"), "The icon must be a data:image URL");
                require!(icon.len() <= WARD_ICON_MAX, "The icon must be 16 KB or less");
                env::storage_write(WARD_ICON_KEY, icon.as_bytes());
                events::param_set("icon", &format!("{} bytes", icon.len()));
            }
            None => {
                env::storage_remove(WARD_ICON_KEY);
                events::param_set("icon", "cleared");
            }
        }
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(
            env::attached_deposit().as_yoctonear() >= 1,
            "Requires attached deposit of at least 1 yoctoNEAR"
        );
        let sender_id = env::predecessor_account_id();
        require!(sender_id != receiver_id, "Cannot transfer to self");
        require!(amount.0 > 0, "Transfer amount must be positive");

        let held = self.positions.get(&sender_id).copied().unwrap_or(0);
        let locked: u128 = self
            .withdrawals
            .values()
            .filter(|w| w.account == sender_id)
            .map(|w| w.shares)
            .sum();
        let free = held.saturating_sub(locked);
        require!(amount.0 <= free, "Not enough free WARD to transfer");

        let new_sender_bal = held - amount.0;
        self.positions.insert(sender_id.clone(), new_sender_bal);

        let receiver_held = self.positions.get(&receiver_id).copied().unwrap_or(0);
        self.positions.insert(receiver_id.clone(), receiver_held.saturating_add(amount.0));

        events::ft_transfer_event(
            sender_id.as_str(),
            receiver_id.as_str(),
            &amount.0.to_string(),
            memo.as_deref(),
        );
    }

    // NEP-145 Storage Management
    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        let _ = registration_only;
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        let deposit = env::attached_deposit();
        let min = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
        require!(deposit >= min, "Attached deposit is less than storage min");

        if !self.positions.contains_key(&account) {
            self.positions.insert(account.clone(), 0);
        }

        let refund = deposit.saturating_sub(min);
        if refund > NearToken::from_yoctonear(0) {
            let _ = Promise::new(env::predecessor_account_id()).transfer(refund);
        }

        StorageBalance {
            total: min,
            available: NearToken::from_yoctonear(0),
        }
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        let min = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
        StorageBalanceBounds {
            min,
            max: Some(min),
        }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        if self.positions.contains_key(&account_id) {
            Some(StorageBalance {
                total: NearToken::from_yoctonear(1_250_000_000_000_000_000_000),
                available: NearToken::from_yoctonear(0),
            })
        } else {
            None
        }
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::attached_deposit().as_yoctonear() >= 1,
            "Requires attached deposit of at least 1 yoctoNEAR"
        );
        let sender_id = env::predecessor_account_id();
        require!(sender_id != receiver_id, "Cannot transfer to self");
        require!(amount.0 > 0, "Transfer amount must be positive");

        let held = self.positions.get(&sender_id).copied().unwrap_or(0);
        let locked: u128 = self
            .withdrawals
            .values()
            .filter(|w| w.account == sender_id)
            .map(|w| w.shares)
            .sum();
        let free = held.saturating_sub(locked);
        require!(amount.0 <= free, "Not enough free WARD to transfer");

        self.positions.insert(sender_id.clone(), held - amount.0);
        let receiver_held = self.positions.get(&receiver_id).copied().unwrap_or(0);
        self.positions.insert(receiver_id.clone(), receiver_held.saturating_add(amount.0));

        events::ft_transfer_event(
            sender_id.as_str(),
            receiver_id.as_str(),
            &amount.0.to_string(),
            memo.as_deref(),
        );

        ext_ft_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FT_ON_TRANSFER)
            .ft_on_transfer(sender_id.clone(), amount, msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .ft_resolve_transfer(sender_id, receiver_id, amount),
            )
            .into()
    }

    #[private]
    pub fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let unused: u128 = match env::promise_result_checked(0, 64) {
            Ok(value) => {
                if let Ok(unused_amount) = near_sdk::serde_json::from_slice::<U128>(&value) {
                    unused_amount.0.min(amount.0)
                } else {
                    amount.0
                }
            }
            Err(_) => amount.0,
        };

        if unused > 0 {
            let receiver_bal = self.positions.get(&receiver_id).copied().unwrap_or(0);
            let to_refund = unused.min(receiver_bal);
            self.positions.insert(receiver_id.clone(), receiver_bal.saturating_sub(to_refund));
            let sender_bal = self.positions.get(&sender_id).copied().unwrap_or(0);
            self.positions.insert(sender_id.clone(), sender_bal.saturating_add(to_refund));
            // The refund is a transfer back, as NEP-141's own implementation logs it.
            if to_refund > 0 {
                events::ft_transfer_event(receiver_id.as_str(), sender_id.as_str(), &to_refund.to_string(), Some("refund"));
            }
        }

        U128(unused)
    }

    // NEP-141 Receiver for USDC deposits
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.token_contract {
            return PromiseOrValue::Value(amount);
        }
        if amount.0 == 0 {
            return PromiseOrValue::Value(amount);
        }

        let is_first_loss = msg.contains("\"first_loss\":true")
            || msg.contains("\"first_loss\": true")
            || msg.contains("first_loss");

        let is_fee = msg.contains("\"fee\"") || msg.contains("\"action\":\"fee\"");

        if is_first_loss {
            require!(
                sender_id == self.junior_holder || sender_id == self.owner,
                "E_NOT_AUTHORIZED: Only Wardline junior holder can deposit first-loss"
            );
            self.junior = self.junior.saturating_add(amount.0);
            let now_ns = env::block_timestamp();
            self.mark("first_loss", now_ns);
            events::pool_deposited(sender_id.as_str(), &amount.0.to_string(), "0");
            return PromiseOrValue::Value(U128(0));
        }

        if is_fee {
            self.senior = self.senior.saturating_add(amount.0);
            self.fees_earned = self.fees_earned.saturating_add(amount.0);
            let now_ns = env::block_timestamp();
            self.mark("fees", now_ns);
            events::fees_added(&amount.0.to_string(), &self.fees_earned.to_string());
            return PromiseOrValue::Value(U128(0));
        }

        let shares = self.mint(&sender_id, amount.0);
        let now_ns = env::block_timestamp();
        self.mark("deposit", now_ns);
        events::pool_deposited(sender_id.as_str(), &amount.0.to_string(), &shares.to_string());
        PromiseOrValue::Value(U128(0))
    }

    pub fn get_pool(&self) -> PoolView {
        let tvl = self.junior.saturating_add(self.senior);
        let coverage_capacity = (tvl.saturating_mul(self.max_claim_bps as u128)) / 10_000;
        let p = self.price().to_string();

        PoolView {
            tvl: tvl.to_string(),
            junior: self.junior.to_string(),
            senior: self.senior.to_string(),
            junior_holder: self.junior_holder.to_string(),
            ward_symbol: "WARD".to_string(),
            ward_name: "Wardline Mutual share".to_string(),
            ward_supply: self.senior_shares.to_string(),
            ward_price: p.clone(),
            launch_price: SCALE.to_string(),
            price_history: self.price_history.clone(),
            fees_earned: self.fees_earned.to_string(),
            claims_paid: self.claims_paid.to_string(),
            coverage_capacity: coverage_capacity.to_string(),
            withdraw_delay_days: self.withdraw_delay_days,
            large_claim_threshold: self.large_claim_threshold.to_string(),
            trade_url: self.trade_url.clone(),
            share_price: p,
            senior_shares: self.senior_shares.to_string(),
        }
    }

    pub fn get_position(&self, account: AccountId) -> PoolPositionView {
        let shares = self.positions.get(&account).copied().unwrap_or(0);
        let price = self.price();
        let value = (shares.saturating_mul(price)) / SCALE;
        let delay_ns = (self.withdraw_delay_days as u64) * ONE_DAY_NS;

        let mut locked: u128 = 0;
        let pending = self
            .withdrawals
            .values()
            .filter(|w| w.account == account)
            .map(|w| {
                locked = locked.saturating_add(w.shares);
                let w_val = (w.shares.saturating_mul(price)) / SCALE;
                PendingWithdrawalView {
                    id: w.id.clone(),
                    shares: w.shares.to_string(),
                    ward: w.shares.to_string(),
                    value: w_val.to_string(),
                    requested_at: format!("{}ns", w.requested_at_ns),
                    available_at: format!("{}ns", w.requested_at_ns + delay_ns),
                }
            })
            .collect();

        let free_ward = shares.saturating_sub(locked);

        PoolPositionView {
            account: account.to_string(),
            shares: shares.to_string(),
            ward: free_ward.to_string(),
            ward_locked: locked.to_string(),
            value: value.to_string(),
            pending_withdrawals: pending,
        }
    }

    pub fn deposit(&mut self, account: AccountId, amount: U128) -> DepositResultView {
        require!(
            env::predecessor_account_id() == self.token_contract,
            "E_NOT_AUTHORIZED: deposit must go through ft_on_transfer on the token contract"
        );
        require!(amount.0 > 0, "Deposit must be positive");
        let shares = self.mint(&account, amount.0);
        let now_ns = env::block_timestamp();
        self.mark("deposit", now_ns);
        let tx = format!("{}:dep:{}", env::current_account_id(), now_ns);
        events::pool_deposited(account.as_str(), &amount.0.to_string(), &shares.to_string());
        DepositResultView {
            tx,
            shares: shares.to_string(),
            ward: shares.to_string(),
        }
    }

    pub fn request_withdraw(
        &mut self,
        account: AccountId,
        shares: Option<U128>,
        ward: Option<U128>,
    ) -> WithdrawResultView {
        require!(
            env::predecessor_account_id() == account,
            "E_NOT_AUTHORIZED: can only request withdrawal for own account"
        );
        let want = ward.or(shares).expect("Shares/ward must be specified");
        require!(want.0 > 0, "Shares must be positive");
        let held = self.positions.get(&account).copied().unwrap_or(0);
        let queued: u128 = self
            .withdrawals
            .values()
            .filter(|w| w.account == account)
            .map(|w| w.shares)
            .sum();

        require!(
            want.0 <= held.saturating_sub(queued),
            "Not enough shares to withdraw"
        );

        let now_ns = env::block_timestamp();
        let delay_ns = (self.withdraw_delay_days as u64) * ONE_DAY_NS;
        let id = format!("wd_{}_{}", account, now_ns);

        self.withdrawals.insert(
            id.clone(),
            StoredWithdrawal {
                id: id.clone(),
                account: account.clone(),
                shares: want.0,
                requested_at_ns: now_ns,
            },
        );

        let avail_str = format!("{}ns", now_ns + delay_ns);
        let tx = format!("{}:wd:{}", env::current_account_id(), now_ns);
        events::pool_withdraw_requested(account.as_str(), &id, &want.0.to_string(), &avail_str);

        WithdrawResultView {
            tx,
            id,
            available_at: avail_str,
        }
    }

    pub fn request_redeem(&mut self, amount: U128) -> WithdrawResultView {
        let caller = env::predecessor_account_id();
        self.request_withdraw(caller, Some(amount), Some(amount))
    }

    pub fn redeem(&mut self, account: AccountId, id: String) -> PromiseOrValue<RedeemResultView> {
        require!(
            env::predecessor_account_id() == account,
            "E_NOT_AUTHORIZED: can only redeem for own account"
        );
        let withdrawal = self
            .withdrawals
            .get(&id)
            .cloned()
            .expect("No such redemption");
        require!(
            withdrawal.account == account,
            "Withdrawal belongs to different account"
        );

        let now_ns = env::block_timestamp();
        let delay_ns = (self.withdraw_delay_days as u64) * ONE_DAY_NS;
        require!(
            now_ns >= withdrawal.requested_at_ns.saturating_add(delay_ns),
            "The 7-day wait is not over yet"
        );

        let price = self.price();
        let usdc_payout = (withdrawal.shares.saturating_mul(price)) / SCALE;

        if cfg!(test) || usdc_payout == 0 {
            self.withdrawals.remove(&id);
            if let Some(held) = self.positions.get_mut(&account) {
                *held = held.saturating_sub(withdrawal.shares);
            }
            self.senior_shares = self.senior_shares.saturating_sub(withdrawal.shares);
            self.senior = self.senior.saturating_sub(usdc_payout);

            self.mark("redeem", now_ns);
            events::pool_redeemed(
                account.as_str(),
                &id,
                &withdrawal.shares.to_string(),
                &usdc_payout.to_string(),
            );
            if withdrawal.shares > 0 {
                events::ft_burn_event(account.as_str(), &withdrawal.shares.to_string(), None);
            }

            return PromiseOrValue::Value(RedeemResultView {
                tx: format!("{}:rd:{}", env::current_account_id(), now_ns),
                usdc: usdc_payout.to_string(),
            });
        }

        ext_ft::ext(self.token_contract.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(
                account.clone(),
                U128(usdc_payout),
                Some("Wardline Mutual Redemption".to_string()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_redeem_transfer(account, id, withdrawal.shares, usdc_payout),
            )
            .into()
    }

    #[private]
    pub fn on_redeem_transfer(
        &mut self,
        account: AccountId,
        id: String,
        shares: u128,
        usdc_payout: u128,
    ) -> RedeemResultView {
        require!(
            read_transfer_outcome(),
            "USDC payout transfer failed; redemption retained in queue"
        );

        let now_ns = env::block_timestamp();
        self.withdrawals.remove(&id);
        if let Some(held) = self.positions.get_mut(&account) {
            *held = held.saturating_sub(shares);
        }
        self.senior_shares = self.senior_shares.saturating_sub(shares);
        self.senior = self.senior.saturating_sub(usdc_payout);

        self.mark("redeem", now_ns);
        events::pool_redeemed(
            account.as_str(),
            &id,
            &shares.to_string(),
            &usdc_payout.to_string(),
        );
        if shares > 0 {
            events::ft_burn_event(account.as_str(), &shares.to_string(), None);
        }

        RedeemResultView {
            tx: format!("{}:rd:{}", env::current_account_id(), now_ns),
            usdc: usdc_payout.to_string(),
        }
    }

    pub fn list_claims(&self) -> Vec<ClaimView> {
        let mut claims = self.claims.clone();
        claims.reverse();
        claims
    }

    pub fn file_claim(
        &mut self,
        subject: String,
        claimant: AccountId,
        amount: U128,
        reason: String,
    ) -> ClaimView {
        require!(
            env::predecessor_account_id() == self.owner,
            "E_NOT_OWNER: only owner can file claims"
        );
        let amt = amount.0;
        let claim_id = format!("clm_{}_{}", subject, self.claims.len() + 1);
        let pool = self.get_pool();
        let capacity: u128 = pool.coverage_capacity.parse().unwrap_or(0);
        let price_before = self.price().to_string();

        let (status, from_junior, from_senior, tx, price_after) = if amt <= self.large_claim_threshold
            && amt <= capacity
        {
            let from_j = amt.min(self.junior);
            let from_s = amt - from_j;
            self.junior = self.junior.saturating_sub(from_j);
            self.senior = self.senior.saturating_sub(from_s);
            self.claims_paid = self.claims_paid.saturating_add(amt);
            let p_after = self.price().to_string();
            let now_ns = env::block_timestamp();
            self.mark("claim", now_ns);
            (
                "paid".to_string(),
                from_j,
                from_s,
                Some(format!("{}:clm:{}", env::current_account_id(), claim_id)),
                p_after,
            )
        } else {
            ("pending_vote".to_string(), 0, 0, None, price_before.clone())
        };

        let view = ClaimView {
            claim_id: claim_id.clone(),
            subject,
            claimant: claimant.to_string(),
            amount: amt.to_string(),
            reason,
            status: status.clone(),
            paid_from_junior: from_junior.to_string(),
            paid_from_senior: from_senior.to_string(),
            ward_price_before: price_before,
            ward_price_after: price_after,
            filed_at: format!("{}ns", env::block_timestamp()),
            tx,
        };

        self.claims.push(view.clone());
        events::claim_filed(&claim_id, claimant.as_str(), &amt.to_string(), &status);
        view
    }

    pub fn approve_claim(&mut self, claim_id: String) {
        require!(
            env::predecessor_account_id() == self.owner,
            "E_NOT_OWNER: only DAO can approve claims"
        );
        let before_price = self.price().to_string();
        let claim_idx = self
            .claims
            .iter()
            .position(|c| c.claim_id == claim_id)
            .expect("Claim not found");
        require!(self.claims[claim_idx].status == "pending_vote", "Claim is not pending vote");

        let amt: u128 = self.claims[claim_idx].amount.parse().expect("Invalid amount");
        let from_j = amt.min(self.junior);
        let from_s = amt - from_j;
        self.junior = self.junior.saturating_sub(from_j);
        self.senior = self.senior.saturating_sub(from_s);
        self.claims_paid = self.claims_paid.saturating_add(amt);

        let after_price = self.price().to_string();
        let now_ns = env::block_timestamp();
        self.mark("claim", now_ns);

        let claim = &mut self.claims[claim_idx];
        claim.status = "paid".to_string();
        claim.paid_from_junior = from_j.to_string();
        claim.paid_from_senior = from_s.to_string();
        claim.ward_price_before = before_price;
        claim.ward_price_after = after_price;
        claim.tx = Some(format!("{}:clm:{}", env::current_account_id(), claim_id));

        events::claim_approved(&claim_id, &from_j.to_string(), &from_s.to_string());
    }

    pub fn set_param(&mut self, name: String, value: String) {
        require!(
            env::predecessor_account_id() == self.owner,
            "E_NOT_OWNER: only DAO can update pool parameters"
        );
        match name.as_str() {
            "large_claim_threshold" => {
                let v: u128 = value.parse().expect("Invalid u128");
                require!(
                    v >= 100_000_000 && v <= 500_000_000_000,
                    "Threshold out of bounds (100-500,000 USDC)"
                );
                self.large_claim_threshold = v;
            }
            "withdraw_delay_days" => {
                let v: u32 = value.parse().expect("Invalid u32");
                require!(v <= 90, "Withdraw delay out of bounds (0-90 days)");
                self.withdraw_delay_days = v;
            }
            "max_claim_bps" => {
                let v: u64 = value.parse().expect("Invalid u64");
                require!(
                    v >= 100 && v <= 5_000,
                    "Max claim bps out of bounds (100-5000 bps)"
                );
                self.max_claim_bps = v;
            }
            "trade_url" => {
                require!(value.len() <= 255, "Trade URL too long");
                self.trade_url = if value.is_empty() { None } else { Some(value.clone()) };
            }
            "coverage_multiplier" | "coverage_multiplier_bps" => {
                let v: u32 = value.parse().expect("Invalid u32");
                require!(
                    v >= 2_500 && v <= 40_000,
                    "Coverage multiplier out of bounds (2500-40000 bps)"
                );
                self.coverage_multiplier_bps = v;
                if let Some(meter) = &self.meter_contract {
                    let _ = ext_meter::ext(meter.clone())
                        .with_static_gas(Gas::from_tgas(10))
                        .set_param("coverage_multiplier".to_string(), value.clone());
                }
            }
            "fee_bps_bronze" => {
                let v: u32 = value.parse().expect("Invalid u32");
                require!(
                    v >= 10 && v <= 1_000,
                    "Fee bps out of bounds (10-1000 bps)"
                );
                self.fee_bps_bronze = v;
                if let Some(meter) = &self.meter_contract {
                    let _ = ext_meter::ext(meter.clone())
                        .with_static_gas(Gas::from_tgas(10))
                        .set_param("fee_bps_bronze".to_string(), value.clone());
                }
            }
            "fee_bps_silver" => {
                let v: u32 = value.parse().expect("Invalid u32");
                require!(
                    v >= 10 && v <= 1_000,
                    "Fee bps out of bounds (10-1000 bps)"
                );
                self.fee_bps_silver = v;
                if let Some(meter) = &self.meter_contract {
                    let _ = ext_meter::ext(meter.clone())
                        .with_static_gas(Gas::from_tgas(10))
                        .set_param("fee_bps_silver".to_string(), value.clone());
                }
            }
            "fee_bps_gold" => {
                let v: u32 = value.parse().expect("Invalid u32");
                require!(
                    v >= 10 && v <= 1_000,
                    "Fee bps out of bounds (10-1000 bps)"
                );
                self.fee_bps_gold = v;
                if let Some(meter) = &self.meter_contract {
                    let _ = ext_meter::ext(meter.clone())
                        .with_static_gas(Gas::from_tgas(10))
                        .set_param("fee_bps_gold".to_string(), value.clone());
                }
            }
            _ => env::panic_str("Unknown parameter"),
        }
        events::param_set(&name, &value);
    }

    pub fn add_fees(&mut self, amount: U128) {
        if amount.0 == 0 {
            return;
        }
        self.fees_earned = self.fees_earned.saturating_add(amount.0);
        self.senior = self.senior.saturating_add(amount.0);
        let now_ns = env::block_timestamp();
        self.mark("fees", now_ns);
        events::fees_added(&amount.0.to_string(), &self.fees_earned.to_string());
    }

    // WARD-holder Governance
    pub fn propose(&mut self, description: String, action: MutualAction) -> u32 {
        let proposer = env::predecessor_account_id();
        let balance = self.positions.get(&proposer).copied().unwrap_or(0);
        require!(
            balance > 0 || proposer == self.owner,
            "Only WARD holders can propose. Deposit USDC to get WARD first."
        );
        let trimmed = description.trim();
        require!(
            trimmed.len() >= 4 && trimmed.len() <= 200,
            "Describe the proposal in 4 to 200 characters."
        );

        let id = self.proposals.len() as u32;
        let now_ns = env::block_timestamp();
        let voting_days_ns = 3 * 24 * 60 * 60 * 1_000_000_000;
        let closes_at_ns = now_ns.saturating_add(voting_days_ns);

        // Snapshot all current WARD holders' balances at proposal creation
        for (account, &bal) in self.positions.iter() {
            if bal > 0 {
                self.proposal_snapshots.insert((id, account.clone()), bal);
            }
        }

        let proposal = StoredProposal {
            id,
            proposer,
            description: trimmed.to_string(),
            action,
            snapshot_supply: self.senior_shares,
            votes_for: 0,
            votes_against: 0,
            voters: 0,
            opens_at_ns: now_ns,
            closes_at_ns,
            executed_at_ns: None,
        };
        self.proposals.insert(id, proposal);
        id
    }

    pub fn vote(&mut self, id: u32, support: String) {
        let voter = env::predecessor_account_id();
        let key = (id, voter.clone());
        require!(
            !self.proposal_votes.contains_key(&key),
            "Already voted on this proposal"
        );
        let mut p = self.proposals.get(&id).cloned().expect("No proposal found");
        require!(
            p.executed_at_ns.is_none(),
            "Proposal was already executed"
        );
        let now_ns = env::block_timestamp();
        require!(
            now_ns < p.closes_at_ns,
            "Voting window has closed"
        );

        let weight = self.weight_of(id, voter.clone()).0;
        require!(weight > 0, "No voting weight: zero WARD balance at snapshot");

        if support == "for" {
            p.votes_for = p.votes_for.saturating_add(weight);
        } else if support == "against" {
            p.votes_against = p.votes_against.saturating_add(weight);
        } else {
            env::panic_str("Vote support must be 'for' or 'against'");
        }
        p.voters = p.voters.saturating_add(1);

        self.proposal_votes.insert(key, support);
        self.proposals.insert(id, p);
    }

    fn proposal_status(&self, p: &StoredProposal) -> &'static str {
        if p.executed_at_ns.is_some() {
            return "executed";
        }
        if p.votes_for.saturating_mul(2) > p.snapshot_supply {
            return "passed";
        }
        if p.votes_against.saturating_mul(2) >= p.snapshot_supply && p.snapshot_supply > 0 {
            return "rejected";
        }
        let now_ns = env::block_timestamp();
        if now_ns < p.closes_at_ns {
            return "open";
        }
        let quorum = (p.snapshot_supply * 2000) / 10_000;
        let total_votes = p.votes_for.saturating_add(p.votes_against);
        if total_votes >= quorum && p.votes_for > p.votes_against {
            "passed"
        } else {
            "rejected"
        }
    }

    pub fn execute(&mut self, id: u32) -> MutualProposalView {
        let mut p = self.proposals.get(&id).cloned().expect("No proposal found");
        let status = self.proposal_status(&p);
        require!(
            status == "passed",
            "Proposal has not passed"
        );
        require!(
            p.executed_at_ns.is_none(),
            "Proposal was already executed"
        );

        let now_ns = env::block_timestamp();
        p.executed_at_ns = Some(now_ns);

        match &p.action {
            MutualAction::ApprovePayout { claim_id } => {
                self.approve_claim(claim_id.clone());
            }
            MutualAction::SetCoverageMultiplier { multiplier_bps } => {
                require!(
                    *multiplier_bps >= 2_500 && *multiplier_bps <= 40_000,
                    "Coverage multiplier out of bounds (2500-40000 bps)"
                );
                self.coverage_multiplier_bps = *multiplier_bps;
                events::param_set("coverage_multiplier", &multiplier_bps.to_string());
                if let Some(meter) = &self.meter_contract {
                    let _ = ext_meter::ext(meter.clone())
                        .with_static_gas(Gas::from_tgas(10))
                        .set_param("coverage_multiplier".to_string(), multiplier_bps.to_string());
                }
            }
            MutualAction::SetFeeBps { tier, fee_bps } => {
                require!(
                    *fee_bps >= 10 && *fee_bps <= 1_000,
                    "Fee bps out of bounds (10-1000 bps)"
                );
                match tier.as_str() {
                    "bronze" => self.fee_bps_bronze = *fee_bps,
                    "silver" => self.fee_bps_silver = *fee_bps,
                    "gold" => self.fee_bps_gold = *fee_bps,
                    _ => env::panic_str("Unknown tier for fee change"),
                }
                events::param_set(&format!("fee_bps_{}", tier), &fee_bps.to_string());
                if let Some(meter) = &self.meter_contract {
                    let _ = ext_meter::ext(meter.clone())
                        .with_static_gas(Gas::from_tgas(10))
                        .set_param(format!("fee_bps_{}", tier), fee_bps.to_string());
                }
            }
            MutualAction::CoverModel { model_id, signing_address } => {
                events::param_set(&format!("cover_model_{}", model_id), signing_address);
            }
            MutualAction::UncoverModel { model_id } => {
                events::param_set(&format!("uncover_model_{}", model_id), "uncovered");
            }
            MutualAction::SetWithdrawDelay { days } => {
                require!(
                    *days <= 90,
                    "Withdraw delay out of bounds (0-90 days)"
                );
                self.withdraw_delay_days = *days;
                events::param_set("withdraw_delay_days", &days.to_string());
            }
        }

        self.proposals.insert(id, p.clone());
        self.view_proposal(&p)
    }

    fn view_proposal(&self, p: &StoredProposal) -> MutualProposalView {
        let quorum = (p.snapshot_supply * 2000) / 10_000;
        MutualProposalView {
            id: p.id,
            proposer: p.proposer.clone(),
            description: p.description.clone(),
            action: p.action.clone(),
            snapshot_at: format!("{}ns", p.opens_at_ns),
            snapshot_supply: p.snapshot_supply.to_string(),
            votes_for: p.votes_for.to_string(),
            votes_against: p.votes_against.to_string(),
            voters: p.voters,
            quorum: quorum.to_string(),
            opens_at: format!("{}ns", p.opens_at_ns),
            closes_at: format!("{}ns", p.closes_at_ns),
            status: self.proposal_status(p).to_string(),
            executed_at: p.executed_at_ns.map(|t| format!("{}ns", t)),
            tx: Some(format!("{}:proposal:{}", env::current_account_id(), p.id)),
        }
    }

    pub fn get_proposal(&self, id: u32) -> Option<MutualProposalView> {
        self.proposals.get(&id).map(|p| self.view_proposal(p))
    }

    pub fn list_proposals(&self) -> Vec<MutualProposalView> {
        (0..self.proposals.len() as u32)
            .rev()
            .filter_map(|id| self.get_proposal(id))
            .collect()
    }

    pub fn weight_of(&self, id: u32, voter: AccountId) -> U128 {
        U128(self.proposal_snapshots.get(&(id, voter)).copied().unwrap_or(0))
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

    pub fn governance_params(&self) -> GovernanceParamsView {
        GovernanceParamsView {
            quorum_bps: 2000,
            voting_days: 3,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    #[test]
    fn test_pool_deposit_shares_and_junior_first_loss() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let junior_holder: AccountId = "wardline.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            "token.testnet".parse().unwrap(),
            junior_holder.clone(),
            U128(5_000_000_000), // 5,000 USDC junior
            Some(7),
            Some(U128(1_000_000_000)), // 1,000 USDC large threshold
            Some(1_000), // 10%
            None,
            None,
        );

        let lp1: AccountId = "lp1.testnet".parse().unwrap();
        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id("token.testnet".parse().unwrap())
            .build();
        testing_env!(dep_ctx);
        let dep = pool.deposit(lp1.clone(), U128(10_000_000_000));
        assert_eq!(dep.shares, "10000000000");
        assert_eq!(dep.ward, "10000000000");

        let p = pool.get_pool();
        assert_eq!(p.tvl, "15000000000"); // 15,000 USDC
        assert_eq!(p.coverage_capacity, "1500000000"); // 10% = 1,500 USDC
        assert_eq!(p.ward_symbol, "WARD");
        assert_eq!(p.ward_name, "Wardline Mutual share");
        assert_eq!(p.launch_price, "1000000");
        assert_eq!(p.ward_price, "1000000");
        assert_eq!(p.ward_supply, "10000000000");

        // Small claim (under threshold) automatically paid junior first (caller must be owner)
        let claim_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(claim_ctx);
        let claim = pool.file_claim(
            "call_test".to_string(),
            lp1.clone(),
            U128(500_000_000), // 500 USDC
            "wrong output".to_string(),
        );
        assert_eq!(claim.status, "paid");
        assert_eq!(claim.paid_from_junior, "500000000");
        assert_eq!(claim.paid_from_senior, "0");
        assert_eq!(claim.ward_price_before, "1000000");
        assert_eq!(claim.ward_price_after, "1000000");

        let p_after = pool.get_pool();
        assert_eq!(p_after.junior, "4500000000"); // junior absorbed 100% of loss
        assert_eq!(p_after.senior, "10000000000"); // senior untouched!
        assert_eq!(p_after.ward_price, "1000000");
    }

    #[test]
    fn test_ward_token_views_and_ft_transfer() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let junior_holder: AccountId = "wardline.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            "token.testnet".parse().unwrap(),
            junior_holder.clone(),
            U128(20_000_000), // 20 USDC
            Some(7),
            Some(U128(30_000_000)),
            Some(2_500),
            Some("https://app.ref.finance/#/pool/123".to_string()),
            None,
        );

        let lp1: AccountId = "lp1.testnet".parse().unwrap();
        let lp2: AccountId = "lp2.testnet".parse().unwrap();

        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id("token.testnet".parse().unwrap())
            .build();
        testing_env!(dep_ctx);
        pool.deposit(lp1.clone(), U128(50_000_000));
        assert_eq!(pool.ft_total_supply().0, 50_000_000);
        assert_eq!(pool.ft_balance_of(lp1.clone()).0, 50_000_000);

        let meta = pool.ft_metadata();
        assert_eq!(meta.symbol, "WARD");
        assert_eq!(meta.decimals, 6);

        // Test NEP-141 transfer from lp1 to lp2
        let transfer_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(lp1.clone())
            .attached_deposit(near_sdk::NearToken::from_yoctonear(1))
            .build();
        testing_env!(transfer_ctx);

        pool.ft_transfer(lp2.clone(), U128(20_000_000), Some("gift".to_string()));
        assert_eq!(pool.ft_balance_of(lp1.clone()).0, 30_000_000);
        assert_eq!(pool.ft_balance_of(lp2.clone()).0, 20_000_000);
        assert_eq!(pool.ft_total_supply().0, 50_000_000);
    }

    #[test]
    fn test_ward_redeem_with_7day_delay_and_fees() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let junior_holder: AccountId = "wardline.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let start_time_ns = 1_000_000_000_000_000;

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .block_timestamp(start_time_ns)
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            junior_holder.clone(),
            U128(20_000_000),
            Some(7),
            Some(U128(30_000_000)),
            Some(2_500),
            None,
            None,
        );

        let lp: AccountId = "lp.testnet".parse().unwrap();

        // Deposit via ft_on_transfer
        let transfer_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token.clone())
            .block_timestamp(start_time_ns)
            .build();
        testing_env!(transfer_ctx);

        let res = pool.ft_on_transfer(lp.clone(), U128(100_000_000), "".to_string());
        match res {
            PromiseOrValue::Value(val) => assert_eq!(val.0, 0),
            _ => panic!("Expected Value(0)"),
        }

        assert_eq!(pool.ft_balance_of(lp.clone()).0, 100_000_000);
        assert_eq!(pool.price(), 1_000_000);

        // Add 10 USDC fees: raises WARD price to 1.10
        pool.add_fees(U128(10_000_000));
        assert_eq!(pool.price(), 1_100_000);

        // Request withdraw 50 WARD (must be called by lp)
        let withdraw_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(lp.clone())
            .block_timestamp(start_time_ns)
            .build();
        testing_env!(withdraw_ctx);
        let req = pool.request_withdraw(lp.clone(), Some(U128(50_000_000)), None);

        // Fast forward 7 days + 1 second
        let seven_days_ns = 7 * ONE_DAY_NS;
        let redeem_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(lp.clone())
            .block_timestamp(start_time_ns + seven_days_ns + 1_000_000_000)
            .build();
        testing_env!(redeem_ctx);

        let redeem_res = match pool.redeem(lp.clone(), req.id.clone()) {
            PromiseOrValue::Value(v) => v,
            _ => panic!("Expected Value"),
        };
        // 50 WARD at 1.10 USDC = 55 USDC
        assert_eq!(redeem_res.usdc, "55000000");

        assert_eq!(pool.ft_balance_of(lp.clone()).0, 50_000_000);
        assert_eq!(pool.senior_shares, 50_000_000);
        assert_eq!(pool.senior, 55_000_000);
        assert_eq!(pool.price(), 1_100_000); // Price remains constant after redemption
    }

    #[test]
    #[should_panic(expected = "The 7-day wait is not over yet")]
    fn test_ward_early_redeem_panics() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let junior_holder: AccountId = "wardline.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let start_time_ns = 1_000_000_000_000_000;

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .block_timestamp(start_time_ns)
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            junior_holder.clone(),
            U128(20_000_000),
            Some(7),
            Some(U128(30_000_000)),
            Some(2_500),
            None,
            None,
        );

        let lp: AccountId = "lp.testnet".parse().unwrap();
        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token.clone())
            .block_timestamp(start_time_ns)
            .build();
        testing_env!(dep_ctx);
        pool.deposit(lp.clone(), U128(100_000_000));

        let withdraw_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(lp.clone())
            .block_timestamp(start_time_ns)
            .build();
        testing_env!(withdraw_ctx);
        let req = pool.request_withdraw(lp.clone(), Some(U128(50_000_000)), None);

        // Attempting to redeem immediately fails (7 days delay)
        let early_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(lp.clone())
            .block_timestamp(start_time_ns + 100)
            .build();
        testing_env!(early_ctx);

        let _ = pool.redeem(lp.clone(), req.id.clone());
    }

    #[test]
    fn test_ft_on_transfer_first_loss_fees_and_wrong_token() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let junior_holder: AccountId = "wardline.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let wrong_token: AccountId = "fake.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            junior_holder.clone(),
            U128(20_000_000),
            Some(7),
            Some(U128(30_000_000)),
            Some(2_500),
            None,
            None,
        );

        // 1. Wrong token rejection -> refunds full amount
        let wrong_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(wrong_token)
            .build();
        testing_env!(wrong_ctx);
        let refund = match pool.ft_on_transfer("lp.testnet".parse().unwrap(), U128(50_000_000), "".to_string()) {
            PromiseOrValue::Value(v) => v,
            _ => panic!("Expected Value"),
        };
        assert_eq!(refund.0, 50_000_000);
        assert_eq!(pool.ft_total_supply().0, 0);

        // 2. First-loss stake via ft_on_transfer
        let fl_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token.clone())
            .build();
        testing_env!(fl_ctx);
        let fl_refund = match pool.ft_on_transfer(junior_holder.clone(), U128(10_000_000), r#"{"first_loss":true}"#.to_string()) {
            PromiseOrValue::Value(v) => v,
            _ => panic!("Expected Value"),
        };
        assert_eq!(fl_refund.0, 0);
        assert_eq!(pool.junior, 30_000_000); // 20 + 10 = 30 USDC
        assert_eq!(pool.ft_total_supply().0, 0); // No WARD minted for junior equity

        // 3. Regular deposit mints WARD at 1.00 USDC
        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token.clone())
            .build();
        testing_env!(dep_ctx);
        let dep_refund = match pool.ft_on_transfer("lp.testnet".parse().unwrap(), U128(50_000_000), "".to_string()) {
            PromiseOrValue::Value(v) => v,
            _ => panic!("Expected Value"),
        };
        assert_eq!(dep_refund.0, 0);
        assert_eq!(pool.ft_total_supply().0, 50_000_000);
        assert_eq!(pool.price(), 1_000_000);

        // 4. Fee inflow raises WARD price
        let fee_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token.clone())
            .build();
        testing_env!(fee_ctx);
        let fee_refund = match pool.ft_on_transfer("meter.testnet".parse().unwrap(), U128(5_000_000), r#"{"action":"fee"}"#.to_string()) {
            PromiseOrValue::Value(v) => v,
            _ => panic!("Expected Value"),
        };
        assert_eq!(fee_refund.0, 0);
        assert_eq!(pool.senior, 55_000_000);
        assert_eq!(pool.price(), 1_100_000);
    }

    #[test]
    fn test_storage_deposit_and_request_redeem() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let junior_holder: AccountId = "wardline.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            junior_holder.clone(),
            U128(20_000_000),
            Some(7),
            Some(U128(30_000_000)),
            Some(2_500),
            None,
            None,
        );

        let user: AccountId = "user.testnet".parse().unwrap();

        // Storage deposit
        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(user.clone())
            .attached_deposit(NearToken::from_millinear(2000))
            .build();
        testing_env!(dep_ctx);

        let sb = pool.storage_deposit(Some(user.clone()), None);
        assert_eq!(sb.total, NearToken::from_yoctonear(1_250_000_000_000_000_000_000));

        let sbo = pool.storage_balance_of(user.clone()).unwrap();
        assert_eq!(sbo.total, NearToken::from_yoctonear(1_250_000_000_000_000_000_000));

        // Mint WARD and request_redeem
        let mint_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token.clone())
            .build();
        testing_env!(mint_ctx);
        pool.deposit(user.clone(), U128(10_000_000));

        let user_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(user.clone())
            .build();
        testing_env!(user_ctx);

        let wdr = pool.request_redeem(U128(5_000_000));
        assert!(wdr.id.starts_with("wd_user.testnet"));

        let pos = pool.get_position(user);
        assert_eq!(pos.ward_locked, "5000000");
        assert_eq!(pos.ward, "5000000");
    }

    #[test]
    fn test_ward_holder_governance_lifecycle() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let junior_holder: AccountId = "wardline.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let alice: AccountId = "alice.testnet".parse().unwrap();
        let bob: AccountId = "bob.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            junior_holder.clone(),
            U128(20_000_000),
            Some(7),
            Some(U128(30_000_000)),
            Some(2_500),
            None,
            Some("meter.testnet".parse().unwrap()),
        );

        // Deposit and mint WARD via token contract: Alice gets 40 WARD, Bob gets 60 WARD (total 100 WARD)
        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token.clone())
            .build();
        testing_env!(dep_ctx);
        pool.deposit(alice.clone(), U128(40_000_000));
        pool.deposit(bob.clone(), U128(60_000_000));

        assert_eq!(pool.ft_total_supply().0, 100_000_000);

        // 1. Alice proposes lowering Silver fee to 125 bps
        let alice_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(alice.clone())
            .build();
        testing_env!(alice_ctx);

        let prop_id = pool.propose(
            "Lower the Silver fee to 1.25%".to_string(),
            MutualAction::SetFeeBps {
                tier: "silver".to_string(),
                fee_bps: 125,
            },
        );
        assert_eq!(prop_id, 0);

        let p = pool.get_proposal(prop_id).unwrap();
        assert_eq!(p.status, "open");
        assert_eq!(p.snapshot_supply, "100000000");
        assert_eq!(p.quorum, "20000000"); // 20%

        // 2. Alice votes for (40 WARD = 40% of supply, reaches quorum but not > 50%)
        pool.vote(prop_id, "for".to_string());
        let p_voted = pool.get_proposal(prop_id).unwrap();
        assert_eq!(p_voted.votes_for, "40000000");
        assert_eq!(p_voted.status, "open");

        // 3. Bob votes for (60 WARD = 60%, total 100 WARD > 50%, passes early!)
        let bob_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(bob.clone())
            .build();
        testing_env!(bob_ctx);

        pool.vote(prop_id, "for".to_string());
        let p_passed = pool.get_proposal(prop_id).unwrap();
        assert_eq!(p_passed.status, "passed");
        assert_eq!(p_passed.votes_for, "100000000");
        assert_eq!(p_passed.voters, 2);

        // 4. Anyone can execute a passed proposal
        let exec_view = pool.execute(prop_id);
        assert_eq!(exec_view.status, "executed");
        assert!(exec_view.executed_at.is_some());
        assert_eq!(pool.get_fee_bps("silver".to_string()), 125);

        // 5. Governance params
        let params = pool.governance_params();
        assert_eq!(params.quorum_bps, 2000);
        assert_eq!(params.voting_days, 3);

        // 6. List proposals
        let props = pool.list_proposals();
        assert_eq!(props.len(), 1);
        assert_eq!(props[0].id, 0);
    }

    #[test]
    #[should_panic(expected = "E_NOT_AUTHORIZED")]
    fn test_hole1_caller_checks_deposit_unauthorized() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let attacker: AccountId = "attacker.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(7),
            None,
            None,
            None,
            None,
        );

        let attacker_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(attacker.clone())
            .build();
        testing_env!(attacker_ctx);

        // Attacker calling deposit directly without USDC must panic with E_NOT_AUTHORIZED
        pool.deposit(attacker, U128(10_000_000));
    }

    #[test]
    #[should_panic(expected = "E_NOT_OWNER")]
    fn test_hole1_caller_checks_file_claim_unauthorized() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let attacker: AccountId = "attacker.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            "usdc.testnet".parse().unwrap(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(7),
            None,
            None,
            None,
            None,
        );

        let attacker_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(attacker.clone())
            .build();
        testing_env!(attacker_ctx);

        // Attacker calling file_claim must panic with E_NOT_OWNER
        pool.file_claim(
            "fake_subject".to_string(),
            attacker,
            U128(1_000_000),
            "fraud".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "E_NOT_AUTHORIZED")]
    fn test_hole1_caller_checks_request_withdraw_unauthorized() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let victim: AccountId = "victim.testnet".parse().unwrap();
        let attacker: AccountId = "attacker.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(7),
            None,
            None,
            None,
            None,
        );

        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token)
            .build();
        testing_env!(dep_ctx);
        pool.deposit(victim.clone(), U128(50_000_000));

        let attacker_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(attacker)
            .build();
        testing_env!(attacker_ctx);

        // Attacker attempting to request withdraw for victim's account must panic
        pool.request_withdraw(victim, Some(U128(25_000_000)), None);
    }

    #[test]
    #[should_panic(expected = "E_NOT_AUTHORIZED")]
    fn test_hole1_caller_checks_redeem_unauthorized() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let victim: AccountId = "victim.testnet".parse().unwrap();
        let attacker: AccountId = "attacker.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(0), // 0 delay for test
            None,
            None,
            None,
            None,
        );

        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token)
            .build();
        testing_env!(dep_ctx);
        pool.deposit(victim.clone(), U128(50_000_000));

        let victim_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(victim.clone())
            .build();
        testing_env!(victim_ctx);
        let req = pool.request_withdraw(victim.clone(), Some(U128(25_000_000)), None);

        let attacker_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(attacker)
            .build();
        testing_env!(attacker_ctx);

        // Attacker calling redeem for victim must panic
        let _ = pool.redeem(victim, req.id);
    }

    #[test]
    #[should_panic(expected = "No voting weight")]
    fn test_hole2_voting_snapshot_weight_cannot_be_gamed() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let alice: AccountId = "alice.testnet".parse().unwrap();
        let bob: AccountId = "bob.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(7),
            None,
            None,
            None,
            None,
        );

        // Alice gets 100 WARD, Bob gets 0
        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token)
            .build();
        testing_env!(dep_ctx);
        pool.deposit(alice.clone(), U128(100_000_000));

        // Alice creates proposal
        let alice_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(alice.clone())
            .build();
        testing_env!(alice_ctx);

        let prop_id = pool.propose(
            "Set coverage multiplier to 1.25x".to_string(),
            MutualAction::SetCoverageMultiplier { multiplier_bps: 12500 },
        );

        // Alice votes with 100 weight
        pool.vote(prop_id, "for".to_string());
        let p = pool.get_proposal(prop_id).unwrap();
        assert_eq!(p.votes_for, "100000000");

        // Alice transfers all 100 WARD to Bob after proposal creation
        let transfer_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(alice.clone())
            .attached_deposit(NearToken::from_yoctonear(1))
            .build();
        testing_env!(transfer_ctx);
        pool.ft_transfer(bob.clone(), U128(100_000_000), None);
        assert_eq!(pool.ft_balance_of(bob.clone()).0, 100_000_000);

        // Bob tries to vote on the proposal
        // Because snapshot weight for Bob at proposal creation was 0, Bob cannot vote!
        let bob_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(bob.clone())
            .build();
        testing_env!(bob_ctx);

        // This must panic with "No voting weight: zero WARD balance at snapshot"
        pool.vote(prop_id, "for".to_string());
    }

    #[test]
    fn test_hole3_execute_updates_parameters_and_enforces_bounds() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let alice: AccountId = "alice.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(7),
            None,
            None,
            None,
            Some("meter.testnet".parse().unwrap()),
        );

        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token)
            .build();
        testing_env!(dep_ctx);
        pool.deposit(alice.clone(), U128(100_000_000));

        let alice_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(alice.clone())
            .build();
        testing_env!(alice_ctx);

        let prop_id = pool.propose(
            "Set gold fee to 80 bps".to_string(),
            MutualAction::SetFeeBps { tier: "gold".to_string(), fee_bps: 80 },
        );
        pool.vote(prop_id, "for".to_string());

        let p = pool.get_proposal(prop_id).unwrap();
        assert_eq!(p.status, "passed");

        let exec = pool.execute(prop_id);
        assert_eq!(exec.status, "executed");
        assert_eq!(pool.get_fee_bps("gold".to_string()), 80);
    }

    #[test]
    #[should_panic(expected = "Fee bps out of bounds")]
    fn test_hole3_execute_out_of_bounds_fee_panics() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let alice: AccountId = "alice.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(7),
            None,
            None,
            None,
            None,
        );

        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token)
            .build();
        testing_env!(dep_ctx);
        pool.deposit(alice.clone(), U128(100_000_000));

        let alice_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(alice.clone())
            .build();
        testing_env!(alice_ctx);

        let prop_id = pool.propose(
            "Crazy fee".to_string(),
            MutualAction::SetFeeBps { tier: "gold".to_string(), fee_bps: 5000 },
        );
        pool.vote(prop_id, "for".to_string());
        pool.execute(prop_id);
    }

    #[test]
    #[should_panic(expected = "Coverage multiplier out of bounds")]
    fn test_hole3_execute_out_of_bounds_multiplier_panics() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let alice: AccountId = "alice.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(7),
            None,
            None,
            None,
            None,
        );

        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token)
            .build();
        testing_env!(dep_ctx);
        pool.deposit(alice.clone(), U128(100_000_000));

        let alice_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(alice.clone())
            .build();
        testing_env!(alice_ctx);

        let prop_id = pool.propose(
            "Crazy multiplier".to_string(),
            MutualAction::SetCoverageMultiplier { multiplier_bps: 50000 },
        );
        pool.vote(prop_id, "for".to_string());
        pool.execute(prop_id);
    }

    #[test]
    fn test_execute_set_withdraw_delay_proposal() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let alice: AccountId = "alice.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(7),
            None,
            None,
            None,
            None,
        );

        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token)
            .build();
        testing_env!(dep_ctx);
        let _ = pool.ft_on_transfer(alice.clone(), U128(10_000_000), "".to_string());

        let alice_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(alice.clone())
            .build();
        testing_env!(alice_ctx);

        let prop_id = pool.propose(
            "Change withdraw delay to 14 days".to_string(),
            MutualAction::SetWithdrawDelay { days: 14 },
        );
        pool.vote(prop_id, "for".to_string());
        let view = pool.execute(prop_id);
        assert_eq!(view.status, "executed");
        assert_eq!(pool.get_pool().withdraw_delay_days, 14);
    }

    #[test]
    #[should_panic(expected = "Withdraw delay out of bounds")]
    fn test_execute_set_withdraw_delay_out_of_bounds() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let alice: AccountId = "alice.testnet".parse().unwrap();

        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            token.clone(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(7),
            None,
            None,
            None,
            None,
        );

        let dep_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(token)
            .build();
        testing_env!(dep_ctx);
        let _ = pool.ft_on_transfer(alice.clone(), U128(10_000_000), "".to_string());

        let alice_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(alice.clone())
            .build();
        testing_env!(alice_ctx);

        let prop_id = pool.propose(
            "Set delay to 100 days".to_string(),
            MutualAction::SetWithdrawDelay { days: 100 },
        );
        pool.vote(prop_id, "for".to_string());
        pool.execute(prop_id);
    }

    #[test]
    fn test_hole4_set_param_redemption_delay_and_bounds() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            "usdc.testnet".parse().unwrap(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(0),
            None,
            None,
            None,
            None,
        );
        assert_eq!(pool.get_pool().withdraw_delay_days, 0);

        pool.set_param("withdraw_delay_days".to_string(), "7".to_string());
        assert_eq!(pool.get_pool().withdraw_delay_days, 7);
    }

    #[test]
    #[should_panic(expected = "Withdraw delay out of bounds")]
    fn test_hole4_set_param_withdraw_delay_out_of_bounds() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            "usdc.testnet".parse().unwrap(),
            "wardline.testnet".parse().unwrap(),
            U128(20_000_000),
            Some(7),
            None,
            None,
            None,
            None,
        );

        pool.set_param("withdraw_delay_days".to_string(), "100".to_string());
    }

    // NEP-141 events and the WARD icon (A18).

    fn ctx(predecessor: &AccountId, ts: u64, deposit: u128) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(predecessor.clone())
            .block_timestamp(ts)
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .build());
    }

    fn fresh_pool(owner: &AccountId, token: &AccountId) -> CoverPoolContract {
        ctx(owner, 0, 0);
        CoverPoolContract::new(owner.clone(), token.clone(), "wardline.testnet".parse().unwrap(), U128(20_000_000), Some(7), None, None, None, None)
    }

    /// The one nep141 event in the logs with this name, parsed.
    fn nep141(event: &str) -> near_sdk::serde_json::Value {
        let logs = get_logs();
        let found: Vec<near_sdk::serde_json::Value> = logs
            .iter()
            .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
            .map(|j| near_sdk::serde_json::from_str::<near_sdk::serde_json::Value>(j).unwrap())
            .filter(|v| v["standard"] == "nep141" && v["event"] == event)
            .collect();
        assert_eq!(found.len(), 1, "exactly one {} event in {:?}", event, logs);
        found.into_iter().next().unwrap()
    }

    #[test]
    fn a_deposit_logs_ft_mint_with_the_spec_fields() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let lp: AccountId = "lp1.testnet".parse().unwrap();
        let mut pool = fresh_pool(&owner, &token);
        ctx(&token, 1_000, 0);
        let _ = pool.ft_on_transfer(lp.clone(), U128(10_000_000), "".to_string());
        assert_eq!(
            nep141("ft_mint"),
            near_sdk::serde_json::json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_mint", "data": [{ "owner_id": "lp1.testnet", "amount": "10000000" }] })
        );
    }

    #[test]
    fn fees_and_first_loss_mint_no_ward_so_log_no_ft_mint() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let mut pool = fresh_pool(&owner, &token);
        ctx(&token, 1_000, 0);
        let _ = pool.ft_on_transfer("meter.testnet".parse().unwrap(), U128(1_000), "{\"fee\":true}".to_string());
        assert!(get_logs().iter().all(|l| !l.contains("\"ft_mint\"")));
    }

    #[test]
    fn ft_transfer_logs_ft_transfer_with_and_without_memo() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let a: AccountId = "lp1.testnet".parse().unwrap();
        let b: AccountId = "lp2.testnet".parse().unwrap();
        let mut pool = fresh_pool(&owner, &token);
        ctx(&token, 1_000, 0);
        let _ = pool.ft_on_transfer(a.clone(), U128(10_000_000), "".to_string());

        ctx(&a, 2_000, 1);
        pool.ft_transfer(b.clone(), U128(3_000_000), Some("thanks".to_string()));
        assert_eq!(
            nep141("ft_transfer"),
            near_sdk::serde_json::json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_transfer", "data": [{ "old_owner_id": "lp1.testnet", "new_owner_id": "lp2.testnet", "amount": "3000000", "memo": "thanks" }] })
        );

        ctx(&a, 3_000, 1);
        pool.ft_transfer(b.clone(), U128(2_000_000), None);
        assert_eq!(
            nep141("ft_transfer"),
            near_sdk::serde_json::json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_transfer", "data": [{ "old_owner_id": "lp1.testnet", "new_owner_id": "lp2.testnet", "amount": "2000000" }] })
        );
    }

    #[test]
    fn ft_transfer_call_logs_ft_transfer() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let a: AccountId = "lp1.testnet".parse().unwrap();
        let mut pool = fresh_pool(&owner, &token);
        ctx(&token, 1_000, 0);
        let _ = pool.ft_on_transfer(a.clone(), U128(10_000_000), "".to_string());
        ctx(&a, 2_000, 1);
        let _ = pool.ft_transfer_call("market.testnet".parse().unwrap(), U128(1_500_000), None, "".to_string());
        assert_eq!(
            nep141("ft_transfer"),
            near_sdk::serde_json::json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_transfer", "data": [{ "old_owner_id": "lp1.testnet", "new_owner_id": "market.testnet", "amount": "1500000" }] })
        );
    }

    #[test]
    fn a_redemption_logs_ft_burn_when_it_pays_out() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let a: AccountId = "lp1.testnet".parse().unwrap();
        let mut pool = fresh_pool(&owner, &token);
        ctx(&token, 1_000, 0);
        let _ = pool.ft_on_transfer(a.clone(), U128(10_000_000), "".to_string());
        ctx(&a, 2_000_000_000, 0);
        let req = pool.request_redeem(U128(4_000_000));
        // Locking is not a burn: the WARD is still the holder's until it pays out.
        assert!(get_logs().iter().all(|l| !l.contains("\"ft_burn\"")));
        ctx(&a, 2_000_000_000 + 7 * 86_400 * 1_000_000_000 + 1, 0);
        let _ = pool.redeem(a.clone(), req.id);
        assert_eq!(
            nep141("ft_burn"),
            near_sdk::serde_json::json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_burn", "data": [{ "owner_id": "lp1.testnet", "amount": "4000000" }] })
        );
    }

    #[test]
    fn ft_metadata_returns_the_icon_the_owner_set() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let mut pool = fresh_pool(&owner, &token);
        assert_eq!(pool.ft_metadata().icon, None);
        let icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E".to_string();
        ctx(&owner, 1_000, 0);
        pool.set_icon(Some(icon.clone()));
        let meta = pool.ft_metadata();
        assert_eq!(meta.icon, Some(icon));
        assert_eq!((meta.symbol.as_str(), meta.decimals), ("WARD", 6));
        pool.set_icon(None);
        assert_eq!(pool.ft_metadata().icon, None);
    }

    #[test]
    #[should_panic(expected = "Only the owner can set the icon")]
    fn a_non_owner_cannot_change_the_icon() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let mut pool = fresh_pool(&owner, &token);
        ctx(&"mallory.testnet".parse().unwrap(), 1_000, 0);
        pool.set_icon(Some("data:image/svg+xml,x".to_string()));
    }

    #[test]
    #[should_panic(expected = "The icon must be a data:image URL")]
    fn the_icon_must_be_a_data_image_url() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let token: AccountId = "usdc.testnet".parse().unwrap();
        let mut pool = fresh_pool(&owner, &token);
        ctx(&owner, 1_000, 0);
        pool.set_icon(Some("https://example.com/ward.png".to_string()));
    }
}
