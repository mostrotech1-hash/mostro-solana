//! Pure constant-product bonding-curve math on virtual reserves (pump.fun style).
//! Integer formulas follow the MIT-licensed `@pump-fun/pump-sdk` so a TypeScript
//! quote and the on-chain result agree to the unit.
//!
//! All intermediates are `u128`, all operations checked. Nothing here touches accounts.

use crate::errors::MostroError;
use crate::state::BPS_DENOMINATOR;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SellQuote {
    /// Gross quote leaving the reserves.
    pub gross_out: u64,
    pub fee: u64,
    /// What the seller receives.
    pub net_out: u64,
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

/// Spot price in quote-per-token, scaled by 1e9 (lamports per whole token when both have 6 decimals
/// the caller rescales). Informational only.
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

/// Sell an exact token amount. `out = t * VQ / (VT + t)`, `fee = ceil(out * fee_bps / 10000)`.
pub fn sell_exact_in(
    virtual_quote: u64,
    virtual_tokens: u64,
    tokens_in: u64,
    fee_bps: u16,
) -> Result<SellQuote> {
    require!(tokens_in > 0, MostroError::InvalidAmount);
    let t = tokens_in as u128;
    let vq = virtual_quote as u128;
    let vt = virtual_tokens as u128;
    let out = t
        .checked_mul(vq)
        .and_then(|x| x.checked_div(vt.checked_add(t)?))
        .ok_or_else(|| error!(MostroError::MathOverflow))?;
    let fee = ceil_div(
        out.checked_mul(fee_bps as u128)
            .ok_or_else(|| error!(MostroError::MathOverflow))?,
        BPS,
    )?;
    require!(out >= fee, MostroError::InvalidAmount);
    Ok(SellQuote {
        gross_out: to_u64(out)?,
        fee: to_u64(fee)?,
        net_out: to_u64(out - fee)?,
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

/// Split a redeemed amount into burn / rewards / artist shares. Remainder goes to the artist.
pub fn split_redeem(amount: u64, burn_bps: u16, rewards_bps: u16) -> Result<(u64, u64, u64)> {
    require!(
        burn_bps as u64 + rewards_bps as u64 <= BPS_DENOMINATOR,
        MostroError::InvalidBps
    );
    let a = amount as u128;
    let burn = to_u64(a * burn_bps as u128 / BPS)?;
    let rewards = to_u64(a * rewards_bps as u128 / BPS)?;
    let artist = amount
        .checked_sub(burn)
        .and_then(|x| x.checked_sub(rewards))
        .ok_or_else(|| error!(MostroError::MathOverflow))?;
    Ok((burn, rewards, artist))
}

/// Apply a basis-point discount, rounding the discount down.
pub fn apply_discount(price: u64, discount_bps: u16) -> Result<u64> {
    require!(
        discount_bps as u64 <= BPS_DENOMINATOR,
        MostroError::InvalidBps
    );
    let d = to_u64((price as u128) * (discount_bps as u128) / BPS)?;
    price
        .checked_sub(d)
        .ok_or_else(|| error!(MostroError::InvalidDiscount))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Demo "set B": 30 SOL virtual quote, 1,000,000 tokens (6 dp) virtual, cap 800,000.
    const VQ0: u64 = 30_000_000_000;
    const VT0: u64 = 1_000_000_000_000;
    const CAP: u64 = 800_000_000_000;
    const FEE: u16 = 100;

    #[test]
    fn genesis_buy_matches_pump_sdk_formula() {
        // 0.1 SOL in: net = (1e8 - 1) * 10000 / 10100 = 99_009_900; out = net * VT / (VQ + net)
        let q = buy_exact_in(VQ0, VT0, 100_000_000, FEE).unwrap();
        assert_eq!(q.net_in, 99_009_900);
        assert_eq!(q.fee, 990_100);
        let expected = 99_009_900u128 * VT0 as u128 / (VQ0 as u128 + 99_009_900);
        assert_eq!(q.tokens_out as u128, expected);
        // ~3,290 tokens
        assert!(q.tokens_out > 3_289_000_000 && q.tokens_out < 3_291_000_000);
    }

    #[test]
    fn exact_out_costs_at_least_exact_in_for_same_tokens() {
        let q = buy_exact_in(VQ0, VT0, 1_000_000_000, FEE).unwrap();
        let eo = buy_exact_out(VQ0, VT0, q.tokens_out, FEE).unwrap();
        // Paying cost+fee via exact-out must be >= what exact-in paid net, and buy back same tokens.
        assert!(eo.net_in + eo.fee >= q.net_in);
        assert!(eo.net_in + eo.fee <= q.net_in + q.fee + 2);
    }

    #[test]
    fn buy_then_sell_never_profits() {
        let mut vq = VQ0;
        let mut vt = VT0;
        for lamports in [10_000_000u64, 500_000_000, 5_000_000_000] {
            let b = buy_exact_in(vq, vt, lamports, FEE).unwrap();
            vq += b.net_in;
            vt -= b.tokens_out;
            let s = sell_exact_in(vq, vt, b.tokens_out, FEE).unwrap();
            assert!(s.net_out < lamports);
            vq -= s.gross_out;
            vt += b.tokens_out;
        }
        assert!(vq <= VQ0 + 3);
        assert_eq!(vt, VT0);
    }

    #[test]
    fn price_is_monotonic() {
        let mut vq = VQ0;
        let mut vt = VT0;
        let mut last = 0u128;
        for _ in 0..20 {
            let b = buy_exact_in(vq, vt, 1_000_000_000, FEE).unwrap();
            vq += b.net_in;
            vt -= b.tokens_out;
            let p = spot_price_e9(vq, vt).unwrap();
            assert!(p > last);
            last = p;
        }
    }

    #[test]
    fn graduation_is_derived() {
        let g = quote_to_complete(VQ0, VT0, CAP).unwrap();
        assert_eq!(g, 120_000_000_000); // 120 SOL
        assert!(quote_to_complete(VQ0, VT0, VT0).is_err());
    }

    #[test]
    fn exact_out_rejects_more_than_virtual() {
        assert!(buy_exact_out(VQ0, VT0, VT0, FEE).is_err());
        assert!(buy_exact_out(VQ0, VT0, 0, FEE).is_err());
    }

    #[test]
    fn overflow_is_an_error_not_a_panic() {
        assert!(buy_exact_in(u64::MAX, u64::MAX, u64::MAX, FEE).is_ok());
        assert!(spot_price_e9(u64::MAX, 1).is_ok());
        assert!(sell_exact_in(u64::MAX, u64::MAX, u64::MAX, 0).is_ok());
    }

    #[test]
    fn split_and_discount() {
        assert_eq!(
            split_redeem(1_200_000_000, 8000, 2000).unwrap(),
            (960_000_000, 240_000_000, 0)
        );
        assert_eq!(split_redeem(1_000, 5000, 2500).unwrap(), (500, 250, 250));
        assert!(split_redeem(1_000, 8000, 3000).is_err());
        assert_eq!(apply_discount(1_000_000, 500).unwrap(), 950_000);
        assert_eq!(apply_discount(1_000_000, 1500).unwrap(), 850_000);
        assert_eq!(apply_discount(1_000_000, 0).unwrap(), 1_000_000);
        assert!(apply_discount(1_000_000, 10_001).is_err());
    }

    #[test]
    fn small_amounts_fail_cleanly() {
        assert!(buy_exact_in(VQ0, VT0, 1, FEE).is_err());
        assert!(buy_exact_in(VQ0, VT0, 0, FEE).is_err());
        assert!(sell_exact_in(VQ0, VT0, 0, FEE).is_err());
    }
}
