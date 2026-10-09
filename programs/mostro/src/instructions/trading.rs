use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    burn, mint_to, transfer_checked, Burn, Mint, MintTo, TokenAccount, TokenInterface,
    TransferChecked,
};

use crate::curve;
use crate::errors::MostroError;
use crate::events::*;
use crate::pricing;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateCurveArgs {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub supply_cap: u64,
    pub sale_start_ts: i64,
}

#[derive(Accounts)]
pub struct CreateCurve<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MostroError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = admin,
        space = 8 + Curve::INIT_SPACE,
        seeds = [CURVE_SEED, &config.curve_count.to_le_bytes()],
        bump,
    )]
    pub curve: Box<Account<'info, Curve>>,
    #[account(
        init,
        payer = admin,
        seeds = [MINT_SEED, &config.curve_count.to_le_bytes()],
        bump,
        mint::decimals = MOST_DECIMALS,
        mint::authority = curve,
        mint::token_program = token_program,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: system-owned PDA holding the curve's SOL reserves.
    #[account(mut, seeds = [SOL_VAULT_SEED, curve.key().as_ref()], bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(
        init,
        payer = admin,
        seeds = [REWARDS_SEED, curve.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = curve,
        token::token_program = token_program,
    )]
    pub rewards_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ MostroError::InvalidMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = admin,
        associated_token::mint = usdc_mint,
        associated_token::authority = curve,
        associated_token::token_program = usdc_token_program,
    )]
    pub usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn create_curve(ctx: Context<CreateCurve>, args: CreateCurveArgs) -> Result<()> {
    require!(args.name.len() <= MAX_NAME, MostroError::StringTooLong);
    require!(args.symbol.len() <= MAX_SYMBOL, MostroError::StringTooLong);
    require!(args.uri.len() <= MAX_URI, MostroError::StringTooLong);
    require!(
        args.virtual_sol_reserves > 0
            && args.virtual_token_reserves > 0
            && args.supply_cap > 0
            && args.supply_cap < args.virtual_token_reserves,
        MostroError::InvalidCurveParams
    );
    // Fund the SOL vault with the rent floor so transfers never close it.
    let floor = Rent::get()?.minimum_balance(0);
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.admin.to_account_info(),
                to: ctx.accounts.sol_vault.to_account_info(),
            },
        ),
        floor,
    )?;

    let config = &mut ctx.accounts.config;
    let c = &mut ctx.accounts.curve;
    c.bump = ctx.bumps.curve;
    c.version = 1;
    c.index = config.curve_count;
    c.mint = ctx.accounts.mint.key();
    c.sol_vault_bump = ctx.bumps.sol_vault;
    c.name = args.name;
    c.symbol = args.symbol;
    c.uri = args.uri;
    c.virtual_sol_reserves = args.virtual_sol_reserves;
    c.virtual_token_reserves = args.virtual_token_reserves;
    c.real_sol_reserves = 0;
    c.real_usdc_reserves = 0;
    c.supply_cap = args.supply_cap;
    c.tokens_sold = 0;
    c.total_burned = 0;
    c.rewards_accrued = 0;
    c.sale_start_ts = args.sale_start_ts;
    c.created_at = Clock::get()?.unix_timestamp;
    c.complete = false;
    config.curve_count += 1;
    emit!(CurveCreated {
        curve: c.key(),
        mint: c.mint,
        index: c.index,
        virtual_sol_reserves: c.virtual_sol_reserves,
        virtual_token_reserves: c.virtual_token_reserves,
        supply_cap: c.supply_cap,
    });
    Ok(())
}

/// Shared accounts for buying on the curve. `kyc` is required only when `config.kyc_required`.
#[derive(Accounts)]
pub struct BuyTokens<'info> {
    /// Pays rent for the buyer's token account. Usually the buyer; can be a sponsor.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Pays the SOL and receives the tokens.
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [CURVE_SEED, &curve.index.to_le_bytes()], bump = curve.bump, has_one = mint @ MostroError::InvalidMint)]
    pub curve: Box<Account<'info, Curve>>,
    #[account(mut)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [SOL_VAULT_SEED, curve.key().as_ref()], bump = curve.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut, seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: SystemAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Optional KYC record; `check_kyc` verifies it belongs to the buyer. No seeds so clients can omit it.
    pub kyc: Option<Box<Account<'info, Kyc>>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// When `config.kyc_required`, the wallet must present its own approved `Kyc` record.
fn check_kyc(config: &Config, kyc: &Option<Box<Account<Kyc>>>, wallet: &Pubkey) -> Result<()> {
    if config.kyc_required {
        let k = kyc.as_ref().ok_or(MostroError::KycRequired)?;
        require!(k.approved && k.wallet == *wallet, MostroError::KycRequired);
    }
    Ok(())
}

fn check_can_buy(
    config: &Config,
    curve: &Curve,
    kyc: &Option<Box<Account<Kyc>>>,
    buyer: &Pubkey,
    now: i64,
) -> Result<()> {
    require!(!config.paused, MostroError::Paused);
    require!(!curve.complete, MostroError::CurveComplete);
    require!(now >= curve.sale_start_ts, MostroError::SaleNotStarted);
    check_kyc(config, kyc, buyer)
}

fn mint_tokens<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    curve: &Account<'info, Curve>,
    amount: u64,
) -> Result<()> {
    let index = curve.index.to_le_bytes();
    let seeds: &[&[u8]] = &[CURVE_SEED, &index, &[curve.bump]];
    mint_to(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            MintTo {
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: curve.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}

fn apply_buy(curve: &mut Curve, net: u64, tokens_out: u64) -> Result<()> {
    let sold = curve
        .tokens_sold
        .checked_add(tokens_out)
        .ok_or(MostroError::MathOverflow)?;
    require!(sold <= curve.supply_cap, MostroError::CurveSoldOut);
    curve.virtual_sol_reserves = curve
        .virtual_sol_reserves
        .checked_add(net)
        .ok_or(MostroError::MathOverflow)?;
    curve.virtual_token_reserves = curve
        .virtual_token_reserves
        .checked_sub(tokens_out)
        .ok_or(MostroError::MathOverflow)?;
    curve.tokens_sold = sold;
    curve.complete = sold == curve.supply_cap;
    Ok(())
}

/// Buy with an exact amount of SOL.
pub fn buy_tokens_sol(
    ctx: Context<BuyTokens>,
    lamports_in: u64,
    min_tokens_out: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    check_can_buy(
        &ctx.accounts.config,
        &ctx.accounts.curve,
        &ctx.accounts.kyc,
        &ctx.accounts.buyer.key(),
        now,
    )?;
    let fee_bps = ctx.accounts.config.fee_bps;
    let q = curve::buy_exact_in(
        ctx.accounts.curve.virtual_sol_reserves,
        ctx.accounts.curve.virtual_token_reserves,
        lamports_in,
        fee_bps,
    )?;
    require!(
        q.tokens_out >= min_tokens_out,
        MostroError::SlippageExceeded
    );
    settle_sol_buy(ctx, q.net_in, q.fee, q.tokens_out)
}

/// Buy an exact number of tokens, paying at most `max_lamports_in` (cost + fee).
pub fn buy_tokens_exact_out_sol(
    ctx: Context<BuyTokens>,
    tokens_out: u64,
    max_lamports_in: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    check_can_buy(
        &ctx.accounts.config,
        &ctx.accounts.curve,
        &ctx.accounts.kyc,
        &ctx.accounts.buyer.key(),
        now,
    )?;
    let fee_bps = ctx.accounts.config.fee_bps;
    let q = curve::buy_exact_out(
        ctx.accounts.curve.virtual_sol_reserves,
        ctx.accounts.curve.virtual_token_reserves,
        tokens_out,
        fee_bps,
    )?;
    let total = q
        .net_in
        .checked_add(q.fee)
        .ok_or(MostroError::MathOverflow)?;
    require!(total <= max_lamports_in, MostroError::SlippageExceeded);
    settle_sol_buy(ctx, q.net_in, q.fee, q.tokens_out)
}

fn settle_sol_buy(ctx: Context<BuyTokens>, net: u64, fee: u64, tokens_out: u64) -> Result<()> {
    let sys = ctx.accounts.system_program.to_account_info();
    transfer(
        CpiContext::new(
            sys.clone(),
            Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.sol_vault.to_account_info(),
            },
        ),
        net,
    )?;
    if fee > 0 {
        transfer(
            CpiContext::new(
                sys,
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            fee,
        )?;
    }
    mint_tokens(
        &ctx.accounts.token_program,
        &ctx.accounts.mint,
        &ctx.accounts.buyer_ata,
        &ctx.accounts.curve,
        tokens_out,
    )?;
    let curve = &mut ctx.accounts.curve;
    apply_buy(curve, net, tokens_out)?;
    curve.real_sol_reserves = curve
        .real_sol_reserves
        .checked_add(net)
        .ok_or(MostroError::MathOverflow)?;
    emit!(TokensBought {
        curve: curve.key(),
        mint: ctx.accounts.mint.key(),
        buyer: ctx.accounts.buyer.key(),
        quote_kind: 0,
        quote_in: net + fee,
        quote_net: net,
        fee,
        tokens_out,
        virtual_sol_reserves: curve.virtual_sol_reserves,
        virtual_token_reserves: curve.virtual_token_reserves,
    });
    Ok(())
}

/// Buy with USDC. The USDC amount is converted to its SOL equivalent at the configured
/// SOL/USD price (admin or Pyth) and applied to the SOL-quoted curve. USDC is kept in the
/// curve's USDC vault; sells pay out only from real SOL reserves.
#[derive(Accounts)]
pub struct BuyTokensUsdc<'info> {
    /// Pays rent for the buyer's token account. Usually the buyer; can be a sponsor.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// Owns the USDC and receives the tokens.
    pub buyer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = usdc_mint @ MostroError::InvalidMint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [CURVE_SEED, &curve.index.to_le_bytes()], bump = curve.bump, has_one = mint @ MostroError::InvalidMint)]
    pub curve: Box<Account<'info, Curve>>,
    #[account(mut)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = usdc_mint, token::authority = buyer, token::token_program = usdc_token_program)]
    pub buyer_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = curve,
        associated_token::token_program = usdc_token_program,
    )]
    pub usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = config,
        associated_token::token_program = usdc_token_program,
    )]
    pub treasury_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: Pyth PriceUpdateV2 account; validated in `pricing::sol_usd` when `price_mode == 1`.
    pub price_update: UncheckedAccount<'info>,
    /// Optional KYC record; `check_kyc` verifies it belongs to the buyer. No seeds so clients can omit it.
    pub kyc: Option<Box<Account<'info, Kyc>>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn buy_tokens_usdc(
    ctx: Context<BuyTokensUsdc>,
    usdc_in: u64,
    min_tokens_out: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    check_can_buy(
        &ctx.accounts.config,
        &ctx.accounts.curve,
        &ctx.accounts.kyc,
        &ctx.accounts.buyer.key(),
        now,
    )?;
    let price = pricing::sol_usd(&ctx.accounts.config, &ctx.accounts.price_update, now)?;
    let lamports_equiv = pricing::usd_e6_to_lamports(usdc_in, price.price_e6)?;
    let fee_bps = ctx.accounts.config.fee_bps;
    let q = curve::buy_exact_in(
        ctx.accounts.curve.virtual_sol_reserves,
        ctx.accounts.curve.virtual_token_reserves,
        lamports_equiv,
        fee_bps,
    )?;
    require!(
        q.tokens_out >= min_tokens_out,
        MostroError::SlippageExceeded
    );
    // Split the USDC the same way: fee share to treasury, rest to the curve vault.
    let usdc_fee = ((usdc_in as u128) * (q.fee as u128) / (lamports_equiv as u128)) as u64;
    let usdc_net = usdc_in
        .checked_sub(usdc_fee)
        .ok_or(MostroError::MathOverflow)?;
    let decimals = ctx.accounts.usdc_mint.decimals;
    transfer_checked(
        CpiContext::new(
            ctx.accounts.usdc_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.buyer_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.usdc_vault.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        usdc_net,
        decimals,
    )?;
    if usdc_fee > 0 {
        transfer_checked(
            CpiContext::new(
                ctx.accounts.usdc_token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.treasury_usdc.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            usdc_fee,
            decimals,
        )?;
    }
    mint_tokens(
        &ctx.accounts.token_program,
        &ctx.accounts.mint,
        &ctx.accounts.buyer_ata,
        &ctx.accounts.curve,
        q.tokens_out,
    )?;
    let curve = &mut ctx.accounts.curve;
    apply_buy(curve, q.net_in, q.tokens_out)?;
    curve.real_usdc_reserves = curve
        .real_usdc_reserves
        .checked_add(usdc_net)
        .ok_or(MostroError::MathOverflow)?;
    emit!(TokensBought {
        curve: curve.key(),
        mint: ctx.accounts.mint.key(),
        buyer: ctx.accounts.buyer.key(),
        quote_kind: 1,
        quote_in: usdc_in,
        quote_net: usdc_net,
        fee: usdc_fee,
        tokens_out: q.tokens_out,
        virtual_sol_reserves: curve.virtual_sol_reserves,
        virtual_token_reserves: curve.virtual_token_reserves,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SellTokens<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [CURVE_SEED, &curve.index.to_le_bytes()], bump = curve.bump, has_one = mint @ MostroError::InvalidMint)]
    pub curve: Box<Account<'info, Curve>>,
    #[account(mut)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [SOL_VAULT_SEED, curve.key().as_ref()], bump = curve.sol_vault_bump)]
    pub sol_vault: SystemAccount<'info>,
    #[account(mut, seeds = [TREASURY_SEED], bump = config.treasury_bump)]
    pub treasury: SystemAccount<'info>,
    #[account(mut, token::mint = mint, token::authority = seller, token::token_program = token_program)]
    pub seller_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Optional KYC record; `check_kyc` verifies it belongs to the seller. No seeds so clients can omit it.
    pub kyc: Option<Box<Account<'info, Kyc>>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn sell_tokens(ctx: Context<SellTokens>, tokens_in: u64, min_lamports_out: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, MostroError::Paused);
    check_kyc(
        &ctx.accounts.config,
        &ctx.accounts.kyc,
        &ctx.accounts.seller.key(),
    )?;
    let fee_bps = ctx.accounts.config.fee_bps;
    let q = curve::sell_exact_in(
        ctx.accounts.curve.virtual_sol_reserves,
        ctx.accounts.curve.virtual_token_reserves,
        tokens_in,
        fee_bps,
    )?;
    require!(q.net_out >= min_lamports_out, MostroError::SlippageExceeded);
    require!(
        q.gross_out <= ctx.accounts.curve.real_sol_reserves,
        MostroError::InsufficientReserves
    );
    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.seller_ata.to_account_info(),
                authority: ctx.accounts.seller.to_account_info(),
            },
        ),
        tokens_in,
    )?;
    let curve_key = ctx.accounts.curve.key();
    let bump = ctx.accounts.curve.sol_vault_bump;
    let seeds: &[&[u8]] = &[SOL_VAULT_SEED, curve_key.as_ref(), &[bump]];
    let sys = ctx.accounts.system_program.to_account_info();
    transfer(
        CpiContext::new_with_signer(
            sys.clone(),
            Transfer {
                from: ctx.accounts.sol_vault.to_account_info(),
                to: ctx.accounts.seller.to_account_info(),
            },
            &[seeds],
        ),
        q.net_out,
    )?;
    if q.fee > 0 {
        transfer(
            CpiContext::new_with_signer(
                sys,
                Transfer {
                    from: ctx.accounts.sol_vault.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
                &[seeds],
            ),
            q.fee,
        )?;
    }
    let curve = &mut ctx.accounts.curve;
    curve.virtual_sol_reserves = curve
        .virtual_sol_reserves
        .checked_sub(q.gross_out)
        .ok_or(MostroError::MathOverflow)?;
    curve.virtual_token_reserves = curve
        .virtual_token_reserves
        .checked_add(tokens_in)
        .ok_or(MostroError::MathOverflow)?;
    curve.real_sol_reserves = curve
        .real_sol_reserves
        .checked_sub(q.gross_out)
        .ok_or(MostroError::MathOverflow)?;
    curve.tokens_sold = curve
        .tokens_sold
        .checked_sub(tokens_in)
        .ok_or(MostroError::MathOverflow)?;
    curve.complete = false;
    emit!(TokensSold {
        curve: curve.key(),
        mint: ctx.accounts.mint.key(),
        seller: ctx.accounts.seller.key(),
        tokens_in,
        lamports_out: q.net_out,
        fee: q.fee,
        virtual_sol_reserves: curve.virtual_sol_reserves,
        virtual_token_reserves: curve.virtual_token_reserves,
    });
    Ok(())
}

/// Attaches Metaplex Token Metadata to a curve mint so wallets and explorers show its name/symbol.
/// Admin-only and idempotent-by-failure (the metadata account can only be created once).
#[derive(Accounts)]
pub struct SetCurveMetadata<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MostroError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [CURVE_SEED, &curve.index.to_le_bytes()], bump = curve.bump, has_one = mint @ MostroError::InvalidMint)]
    pub curve: Box<Account<'info, Curve>>,
    #[account(mut)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: Token Metadata PDA, validated by the metadata program CPI.
    #[account(
        mut,
        seeds = [b"metadata", token_metadata_program.key().as_ref(), mint.key().as_ref()],
        bump,
        seeds::program = token_metadata_program.key(),
    )]
    pub metadata: UncheckedAccount<'info>,
    pub token_metadata_program: Program<'info, anchor_spl::metadata::Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn set_curve_metadata(ctx: Context<SetCurveMetadata>) -> Result<()> {
    use anchor_spl::metadata::{
        create_metadata_accounts_v3, mpl_token_metadata::types::DataV2, CreateMetadataAccountsV3,
    };
    let curve = &ctx.accounts.curve;
    let index = curve.index.to_le_bytes();
    let seeds: &[&[u8]] = &[CURVE_SEED, &index, &[curve.bump]];
    create_metadata_accounts_v3(
        CpiContext::new_with_signer(
            ctx.accounts.token_metadata_program.to_account_info(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                mint_authority: curve.to_account_info(),
                payer: ctx.accounts.admin.to_account_info(),
                update_authority: curve.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &[seeds],
        ),
        DataV2 {
            name: curve.name.clone(),
            symbol: curve.symbol.clone(),
            uri: curve.uri.clone(),
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        },
        true,
        true,
        None,
    )
}
