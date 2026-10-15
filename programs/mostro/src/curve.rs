//! Pure bonding-curve math on virtual reserves (pump.fun style, buy side only) plus the fixed
//! redeem split. Integer formulas follow the MIT-licensed `@pump-fun/pump-sdk` so a TypeScript
//! quote and the on-chain result agree to the unit.
//!
//! All intermediates are `u128`, all operations checked. Nothing here touches accounts.
//! There is deliberately no sell formula: the primary market only accepts buys.

use crate::errors::MostroError;
use crate::state::{BPS_DENOMINATOR, BURN_BPS};
use anchor_lang::prelude::*;

const BPS: u128 = BPS_DENOMINATOR as u128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuyQuote {
    /// Quote that goes into the reserves (after fee).
    pub net_in: u64,
    /// Fee paid to the treasury.
    pub fee: u64,
    pub tokens_out: u64,
}

fn to_u64(v: u128) -> Result<u64> {
    u64::try_from(v).map_err(|_| error!(MostroError::MathOverflow))
}

fn ceil_div(a: u128, b: u128) -> Result<u128> {
    require!(b > 0, MostroError::MathOverflow);
    a.checked_add(b - 1)
        .and_then(|x| x.checked_div(b))
        .ok_or_else(|| error!(MostroError::MathOverflow))
}

/// Spot price in quote-per-token, scaled by 1e9. Informational only.
pub fn spot_price_e9(virtual_quote: u64, virtual_tokens: u64) -> Result<u128> {
    (virtual_quote as u128)
        .checked_mul(1_000_000_000)
        .and_then(|x| x.checked_div(virtual_tokens as u128))
        .ok_or_else(|| error!(MostroError::MathOverflow))
}

/// Buy with an exact quote amount. `net = (q - 1) * 10000 / (10000 + fee_bps)`,
/// `out = net * VT / (VQ + net)`.
pub fn buy_exact_in(
    virtual_quote: u64,
    virtual_tokens: u64,
    quote_in: u64,
    fee_bps: u16,
) -> Result<BuyQuote> {
    require!(quote_in > 1, MostroError::InvalidAmount);
    let q = quote_in as u128;
    let net = (q - 1)
        .checked_mul(BPS)
        .and_then(|x| x.checked_div(BPS + fee_bps as u128))
        .ok_or_else(|| error!(MostroError::MathOverflow))?;
    require!(net > 0, MostroError::InvalidAmount);
    let vq = virtual_quote as u128;
    let vt = virtual_tokens as u128;
    let out = net
        .checked_mul(vt)
        .and_then(|x| x.checked_div(vq.checked_add(net)?))
        .ok_or_else(|| error!(MostroError::MathOverflow))?;
    Ok(BuyQuote {
        net_in: to_u64(net)?,
        fee: to_u64(q - net)?,
        tokens_out: to_u64(out)?,
    })
}

/// Buy an exact token amount. `cost = t * VQ / (VT - t) + 1`, `fee = ceil(cost * fee_bps / 10000)`.
pub fn buy_exact_out(
    virtual_quote: u64,
    virtual_tokens: u64,
    tokens_out: u64,
    fee_bps: u16,
) -> Result<BuyQuote> {
    require!(tokens_out > 0, MostroError::InvalidAmount);
    require!(tokens_out < virtual_tokens, MostroError::CurveSoldOut);
    let t = tokens_out as u128;
    let vq = virtual_quote as u128;
    let vt = virtual_tokens as u128;
    let cost = t
        .checked_mul(vq)
        .and_then(|x| x.checked_div(vt - t))
        .and_then(|x| x.checked_add(1))
        .ok_or_else(|| error!(MostroError::MathOverflow))?;
    let fee = ceil_div(
        cost.checked_mul(fee_bps as u128)
            .ok_or_else(|| error!(MostroError::MathOverflow))?,
        BPS,
    )?;
    Ok(BuyQuote {
        net_in: to_u64(cost)?,
        fee: to_u64(fee)?,
        tokens_out,
    })
}

/// Quote needed (before fees) to sell out the curve from genesis. Derived, never stored.
pub fn quote_to_complete(vq0: u64, vt0: u64, supply_cap: u64) -> Result<u64> {
    require!(supply_cap < vt0, MostroError::InvalidCurveParams);
    let v = (vq0 as u128)
        .checked_mul(vt0 as u128)
        .and_then(|x| x.checked_div((vt0 - supply_cap) as u128))
        .and_then(|x| x.checked_sub(vq0 as u128))
        .ok_or_else(|| error!(MostroError::MathOverflow))?;
    to_u64(v)
}

/// The fixed redeem split: `(burned, to_rewards)` with burn 80 % (floor) and the remainder to the
/// rewards vault, so the two always add up to `amount` and nothing is left for anyone else.
pub fn split_redeem(amount: u64) -> Result<(u64, u64)> {
    let burn = to_u64((amount as u128) * (BURN_BPS as u128) / BPS)?;
    // 20 % plus the rounding remainder of the burn: REWARDS_BPS is the floor of this share.
    let rewards = amount
        .checked_sub(burn)
        .ok_or_else(|| error!(MostroError::MathOverflow))?;
    Ok((burn, rewards))
}

/// Hybrid perk: the SOL price is split in two halves, `(curve_half, artist_half)`. The odd lamport
/// goes to the artist.
pub fn hybrid_halves(price_lamports: u64) -> (u64, u64) {
    let curve_half = price_lamports / 2;
    (curve_half, price_lamports - curve_half)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::CURVE_ALLOCATION;

    // Demo params: 30 SOL virtual quote, 379,000,000 tokens virtual, cap = CURVE_ALLOCATION (280M).
    const VQ0: u64 = 30_000_000_000;
    const VT0: u64 = 379_000_000 * 1_000_000;
    const CAP: u64 = CURVE_ALLOCATION;
    const FEE: u16 = 100;

    #[test]
    fn genesis_buy_matches_pump_sdk_formula() {
        // 0.1 SOL in: net = (1e8 - 1) * 10000 / 10100 = 99_009_900; out = net * VT / (VQ + net)
        let q = buy_exact_in(VQ0, VT0, 100_000_000, FEE).unwrap();
        assert_eq!(q.net_in, 99_009_900);
        assert_eq!(q.fee, 990_100);
        let expected = 99_009_900u128 * VT0 as u128 / (VQ0 as u128 + 99_009_900);
        assert_eq!(q.tokens_out as u128, expected);
        // ~1,246,217 tokens at genesis
        assert!(q.tokens_out > 1_246_000_000_000 && q.tokens_out < 1_247_000_000_000);
    }

    #[test]
    fn exact_out_costs_at_least_exact_in_quote() {
        let t = 1_000 * 1_000_000;
        let q = buy_exact_out(VQ0, VT0, t, FEE).unwrap();
        // Paying the exact-out total through exact-in gets the same tokens minus rounding
        // (one or two lamports of fee rounding, ~12,600 base units per lamport at genesis).
        let back = buy_exact_in(VQ0, VT0, q.net_in + q.fee, FEE).unwrap();
        assert!(back.tokens_out <= t && back.tokens_out + 50_000 >= t);
        assert!(q.fee * 10_000 >= q.net_in * FEE as u64);
    }

    #[test]
    fn completing_the_curve_from_genesis() {
        // VQ0 * VT0 / (VT0 - CAP) - VQ0 = 30 * 379 / 99 - 30 = 84.84... SOL
        let needed = quote_to_complete(VQ0, VT0, CAP).unwrap();
        assert!(needed > 84_000_000_000 && needed < 85_000_000_000);
        assert!(quote_to_complete(VQ0, VT0, VT0).is_err());
    }

    #[test]
    fn fixed_split_burns_80_and_rewards_20() {
        assert_eq!(
            split_redeem(1_000_000_000).unwrap(),
            (800_000_000, 200_000_000)
        );
        assert_eq!(split_redeem(1).unwrap(), (0, 1));
        assert_eq!(split_redeem(0).unwrap(), (0, 0));
        let (b, r) = split_redeem(u64::MAX).unwrap();
        assert_eq!(b as u128 + r as u128, u64::MAX as u128);
    }

    #[test]
    fn halves() {
        assert_eq!(hybrid_halves(2_000_000_000), (1_000_000_000, 1_000_000_000));
        assert_eq!(hybrid_halves(3), (1, 2));
        assert_eq!(hybrid_halves(0), (0, 0));
    }

    #[test]
    fn rejects_dust() {
        assert!(buy_exact_in(VQ0, VT0, 1, FEE).is_err());
        assert!(buy_exact_out(VQ0, VT0, 0, FEE).is_err());
        assert!(buy_exact_out(VQ0, VT0, VT0, FEE).is_err());
    }
}
