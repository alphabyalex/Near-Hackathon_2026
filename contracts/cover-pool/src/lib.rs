use near_sdk::json_types::U128;
use near_sdk::store::IterableMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault, PromiseOrValue};

pub mod events;

const SCALE: u128 = 1_000_000;
const ONE_DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;

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

#[near]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Positions,
    Withdrawals,
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
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
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

    // NEP-141 Receiver for USDC deposits
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let _ = msg;
        require!(
            env::predecessor_account_id() == self.token_contract,
            "Only token contract can call ft_on_transfer"
        );
        require!(amount.0 > 0, "Deposit must be positive");
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

    pub fn redeem(&mut self, account: AccountId, id: String) -> RedeemResultView {
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
                self.large_claim_threshold = value.parse().expect("Invalid u128");
            }
            "withdraw_delay_days" => {
                self.withdraw_delay_days = value.parse().expect("Invalid u32");
            }
            "max_claim_bps" => {
                self.max_claim_bps = value.parse().expect("Invalid u64");
            }
            "trade_url" => {
                self.trade_url = if value.is_empty() { None } else { Some(value.clone()) };
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
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
        );

        let lp1: AccountId = "lp1.testnet".parse().unwrap();
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

        // Small claim (under threshold) automatically paid junior first
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
        );

        let lp1: AccountId = "lp1.testnet".parse().unwrap();
        let lp2: AccountId = "lp2.testnet".parse().unwrap();

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

        // Request withdraw 50 WARD
        let req = pool.request_withdraw(lp.clone(), Some(U128(50_000_000)), None);

        // Fast forward 7 days + 1 second
        let seven_days_ns = 7 * ONE_DAY_NS;
        let redeem_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(lp.clone())
            .block_timestamp(start_time_ns + seven_days_ns + 1_000_000_000)
            .build();
        testing_env!(redeem_ctx);

        let redeem_res = pool.redeem(lp.clone(), req.id.clone());
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
        );

        let lp: AccountId = "lp.testnet".parse().unwrap();
        pool.deposit(lp.clone(), U128(100_000_000));

        let req = pool.request_withdraw(lp.clone(), Some(U128(50_000_000)), None);

        // Attempting to redeem immediately fails (7 days delay)
        let early_ctx = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(lp.clone())
            .block_timestamp(start_time_ns + 100)
            .build();
        testing_env!(early_ctx);

        pool.redeem(lp.clone(), req.id.clone());
    }
}
