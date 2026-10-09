//! SOL/USD pricing used to accept USDC on a SOL-quoted curve and to express USD prices.
//! Mode 0: admin-set price. Mode 1: Pyth `PriceUpdateV2` decoded by hand (no SDK dependency).

use anchor_lang::prelude::*;

use crate::errors::MostroError;
use crate::state::{Config, PRICE_MODE_ADMIN, PRICE_MODE_PYTH};

/// Pyth Solana receiver program (same on devnet and mainnet).
pub const PYTH_RECEIVER_PROGRAM: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

/// Reject Pyth prices whose confidence interval exceeds this share of the price (bps).
pub const MAX_CONF_BPS: u128 = 200;

/// Layout of `PriceUpdateV2` (verification level `Full` only):
///   @0 discriminator(8) @8 write_authority(32) @40 verification tag u8 (1 = Full)
///   @41 feed_id[32] @73 price i64 @81 conf u64 @89 exponent i32 @93 publish_time i64
const OFF_TAG: usize = 40;
const OFF_FEED: usize = 41;
const OFF_PRICE: usize = 73;
const OFF_CONF: usize = 81;
const OFF_EXPO: usize = 89;
const OFF_PUBLISH: usize = 93;
const MIN_LEN: usize = 133;

pub struct SolUsd {
    /// USD per SOL with 6 decimals.
    pub price_e6: u64,
}

/// Returns the SOL/USD price (6 decimals) according to `config.price_mode`.
/// `price_update` is always passed by the client; it is only read in Pyth mode.
pub fn sol_usd(config: &Config, price_update: &AccountInfo, now: i64) -> Result<SolUsd> {
    match config.price_mode {
        PRICE_MODE_ADMIN => {
            require!(config.sol_usd_price_e6 > 0, MostroError::PriceNotSet);
            require!(
                now.saturating_sub(config.price_updated_ts)
                    <= config.admin_price_max_age_secs as i64,
                MostroError::PriceTooOld
            );
            Ok(SolUsd {
                price_e6: config.sol_usd_price_e6,
            })
        }
        PRICE_MODE_PYTH => {
            require_keys_eq!(
                price_update.key(),
                config.pyth_sol_usd_account,
                MostroError::InvalidPriceAccount
            );
            require_keys_eq!(
                *price_update.owner,
                PYTH_RECEIVER_PROGRAM,
                MostroError::InvalidPriceAccount
            );
            let data = price_update.try_borrow_data()?;
            require!(data.len() >= MIN_LEN, MostroError::InvalidPriceAccount);
            require!(data[OFF_TAG] == 1, MostroError::InvalidPriceAccount);
            require!(
                data[OFF_FEED..OFF_FEED + 32] == config.pyth_feed_id,
                MostroError::PriceFeedMismatch
            );
            let price = i64::from_le_bytes(data[OFF_PRICE..OFF_PRICE + 8].try_into().unwrap());
            let conf = u64::from_le_bytes(data[OFF_CONF..OFF_CONF + 8].try_into().unwrap());
            let expo = i32::from_le_bytes(data[OFF_EXPO..OFF_EXPO + 4].try_into().unwrap());
            let publish_time =
                i64::from_le_bytes(data[OFF_PUBLISH..OFF_PUBLISH + 8].try_into().unwrap());
            require!(price > 0, MostroError::PriceNonPositive);
            require!(
                (conf as u128) * 10_000 <= (price as u128) * MAX_CONF_BPS,
                MostroError::PriceUncertain
            );
            require!(
                now.saturating_sub(publish_time) <= config.max_price_age_secs as i64,
                MostroError::PriceTooOld
            );
            Ok(SolUsd {
                price_e6: scale_to_e6(price as u64, expo)?,
            })
        }
        _ => err!(MostroError::InvalidPriceAccount),
    }
}

/// price * 10^(6 + expo) as u64, checked.
pub fn scale_to_e6(price: u64, expo: i32) -> Result<u64> {
    let shift = 6 + expo;
    let pow = |e: u32| {
        10u128
            .checked_pow(e)
            .ok_or_else(|| error!(MostroError::MathOverflow))
    };
    let v: u128 = if shift >= 0 {
        (price as u128)
            .checked_mul(pow(shift as u32)?)
            .ok_or_else(|| error!(MostroError::MathOverflow))?
    } else {
        (price as u128) / pow((-shift) as u32)?
    };
    u64::try_from(v).map_err(|_| error!(MostroError::MathOverflow))
}

/// USD (6 dp) -> lamports at `price_e6` USD per SOL. `lamports = usd_e6 * 1e9 / price_e6`.
pub fn usd_e6_to_lamports(usd_e6: u64, price_e6: u64) -> Result<u64> {
    require!(price_e6 > 0, MostroError::PriceNotSet);
    let v = (usd_e6 as u128)
        .checked_mul(1_000_000_000)
        .and_then(|x| x.checked_div(price_e6 as u128))
        .ok_or_else(|| error!(MostroError::MathOverflow))?;
    u64::try_from(v).map_err(|_| error!(MostroError::MathOverflow))
}

/// lamports -> USD (6 dp). `usd_e6 = lamports * price_e6 / 1e9`.
pub fn lamports_to_usd_e6(lamports: u64, price_e6: u64) -> Result<u64> {
    let v = (lamports as u128)
        .checked_mul(price_e6 as u128)
        .and_then(|x| x.checked_div(1_000_000_000))
        .ok_or_else(|| error!(MostroError::MathOverflow))?;
    u64::try_from(v).map_err(|_| error!(MostroError::MathOverflow))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pyth_scaling() {
        // Observed devnet value: price 11_217_309_341, expo -8 => $112.173093
        assert_eq!(scale_to_e6(11_217_309_341, -8).unwrap(), 112_173_093);
        assert_eq!(scale_to_e6(112, 0).unwrap(), 112_000_000);
        assert_eq!(scale_to_e6(1, -6).unwrap(), 1);
    }

    #[test]
    fn usd_lamports_roundtrip() {
        let price = 112_173_093; // $112.17
        let lamports = usd_e6_to_lamports(1_000_000, price).unwrap(); // $1
        assert_eq!(lamports, 8_914_793);
        let back = lamports_to_usd_e6(lamports, price).unwrap();
        assert!(back >= 999_999 && back <= 1_000_000);
        assert!(usd_e6_to_lamports(1, 0).is_err());
    }
}
