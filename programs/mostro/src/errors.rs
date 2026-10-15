//! Program errors. Anchor numbers them from 6000 in declaration order; the table in
//! `docs/FRONTEND.md` must match this order.

use anchor_lang::prelude::*;

#[error_code]
pub enum MostroError {
    #[msg("Curve buys are paused")]
    BuysPaused, // 6000
    #[msg("Perk redemptions are paused")]
    RedeemsPaused, // 6001
    #[msg("Signer is not authorized")]
    Unauthorized, // 6002
    #[msg("Sale has not started yet")]
    SaleNotStarted, // 6003
    #[msg("Perk is inactive")]
    PerkInactive, // 6004
    #[msg("Perk is sold out")]
    PerkSoldOut, // 6005
    #[msg("Slippage limit exceeded")]
    SlippageExceeded, // 6006
    #[msg("Curve supply cap reached")]
    CurveSoldOut, // 6007
    #[msg("Curve is complete; the primary market is closed")]
    CurveComplete, // 6008
    #[msg("Insufficient balance in the source vault")]
    InsufficientReserves, // 6009
    #[msg("Arithmetic overflow")]
    MathOverflow, // 6010
    #[msg("Invalid amount")]
    InvalidAmount, // 6011
    #[msg("Invalid basis points")]
    InvalidBps, // 6012
    #[msg("Invalid tier")]
    InvalidTier, // 6013
    #[msg("Invalid curve parameters")]
    InvalidCurveParams, // 6014
    #[msg("String too long")]
    StringTooLong, // 6015
    #[msg("Price account does not match config")]
    InvalidPriceAccount, // 6016
    #[msg("Price feed id mismatch")]
    PriceFeedMismatch, // 6017
    #[msg("Price is too old")]
    PriceTooOld, // 6018
    #[msg("Price is not positive")]
    PriceNonPositive, // 6019
    #[msg("Price not set")]
    PriceNotSet, // 6020
    #[msg("Price confidence interval too wide")]
    PriceUncertain, // 6021
    #[msg("Admin transfer not ready")]
    AdminTransferNotReady, // 6022
    #[msg("No pending admin transfer")]
    NoPendingAdmin, // 6023
    #[msg("Collection does not match perk")]
    InvalidCollection, // 6024
    #[msg("Mint does not match")]
    InvalidMint, // 6025
    #[msg("Receipt already fulfilled")]
    AlreadyFulfilled, // 6026
    #[msg("Artist is inactive")]
    ArtistInactive, // 6027
    #[msg("Wallet is blacklisted")]
    Blacklisted, // 6028
    #[msg("Monthly SOL spend cap exceeded for this artist")]
    SpendCapExceeded, // 6029
    #[msg("Artist already has a token")]
    ArtistHasCurve, // 6030
    #[msg("Perk must be priced in tokens or in SOL, not both or neither")]
    InvalidPerkPrice, // 6031
    #[msg("Perk is not payable with this instruction")]
    WrongPerkPayment, // 6032
    #[msg("Signer is not a governance member")]
    NotAMember, // 6033
    #[msg("Invalid member role")]
    InvalidRole, // 6034
    #[msg("Cannot remove the last voting weight")]
    LastMember, // 6035
    #[msg("Invalid proposal kind")]
    InvalidProposalKind, // 6036
    #[msg("Invalid vault for this proposal")]
    InvalidVault, // 6037
    #[msg("Proposal is executed or cancelled")]
    ProposalClosed, // 6038
    #[msg("Proposal has expired")]
    ProposalExpired, // 6039
    #[msg("Proposal has not reached the approval threshold")]
    ThresholdNotMet, // 6040
    #[msg("Account does not match the proposal")]
    ProposalMismatch, // 6041
}
