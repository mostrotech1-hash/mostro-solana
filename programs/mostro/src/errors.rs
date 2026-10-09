use anchor_lang::prelude::*;

#[error_code]
pub enum MostroError {
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Signer is not authorized")]
    Unauthorized,
    #[msg("Sale has not started yet")]
    SaleNotStarted,
    #[msg("Perk is inactive")]
    PerkInactive,
    #[msg("Perk is sold out")]
    PerkSoldOut,
    #[msg("Slippage limit exceeded")]
    SlippageExceeded,
    #[msg("Curve supply cap reached")]
    CurveSoldOut,
    #[msg("Curve is complete; trading is closed")]
    CurveComplete,
    #[msg("Insufficient real reserves to pay out")]
    InsufficientReserves,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid basis points")]
    InvalidBps,
    #[msg("Invalid tier")]
    InvalidTier,
    #[msg("Invalid curve parameters")]
    InvalidCurveParams,
    #[msg("String too long")]
    StringTooLong,
    #[msg("Price account does not match config")]
    InvalidPriceAccount,
    #[msg("Price feed id mismatch")]
    PriceFeedMismatch,
    #[msg("Price is too old")]
    PriceTooOld,
    #[msg("Price is not positive")]
    PriceNonPositive,
    #[msg("Price not set")]
    PriceNotSet,
    #[msg("Admin transfer not ready")]
    AdminTransferNotReady,
    #[msg("No pending admin transfer")]
    NoPendingAdmin,
    #[msg("Collection does not match perk")]
    InvalidCollection,
    #[msg("Mint does not match")]
    InvalidMint,
    #[msg("KYC approval required")]
    KycRequired,
    #[msg("Perk is VIP-only")]
    VipOnly,
    #[msg("Pass asset is not valid for this buyer")]
    InvalidPass,
    #[msg("Pass perk and pass asset do not match")]
    PassMismatch,
    #[msg("Receipt already fulfilled")]
    AlreadyFulfilled,
    #[msg("Artist is inactive")]
    ArtistInactive,
    #[msg("Discount exceeds price")]
    InvalidDiscount,
    #[msg("Price confidence interval too wide")]
    PriceUncertain,
}
