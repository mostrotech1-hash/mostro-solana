use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::errors::MostroError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct CreateArtist<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ MostroError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = admin,
        space = 8 + Artist::INIT_SPACE,
        seeds = [ARTIST_SEED, &config.artist_count.to_le_bytes()],
        bump,
    )]
    pub artist: Account<'info, Artist>,
    pub system_program: Program<'info, System>,
}

pub fn create_artist(
    ctx: Context<CreateArtist>,
    authority: Pubkey,
    name: String,
    uri: String,
) -> Result<()> {
    require!(name.len() <= MAX_NAME, MostroError::StringTooLong);
    require!(uri.len() <= MAX_URI, MostroError::StringTooLong);
    let config = &mut ctx.accounts.config;
    let a = &mut ctx.accounts.artist;
    a.bump = ctx.bumps.artist;
    a.version = 1;
    a.index = config.artist_count;
    a.authority = authority;
    a.name = name.clone();
    a.uri = uri;
    a.perk_count = 0;
    a.revenue_tokens = 0;
    a.active = true;
    config.artist_count += 1;
    emit!(ArtistCreated {
        artist: a.key(),
        index: a.index,
        authority,
        name,
    });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct SetArtistArgs {
    pub authority: Option<Pubkey>,
    pub name: Option<String>,
    pub uri: Option<String>,
    pub active: Option<bool>,
}

/// Signed by the artist authority or the protocol admin.
#[derive(Accounts)]
pub struct ManageArtist<'info> {
    pub signer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [ARTIST_SEED, &artist.index.to_le_bytes()],
        bump = artist.bump,
        constraint = signer.key() == artist.authority || signer.key() == config.admin @ MostroError::Unauthorized,
    )]
    pub artist: Account<'info, Artist>,
}

pub fn set_artist(ctx: Context<ManageArtist>, args: SetArtistArgs) -> Result<()> {
    if args.authority.is_some() {
        // Only the current authority can hand the artist over; the admin cannot reach artist vaults this way.
        require_keys_eq!(
            ctx.accounts.signer.key(),
            ctx.accounts.artist.authority,
            MostroError::Unauthorized
        );
    }
    let a = &mut ctx.accounts.artist;
    if let Some(v) = args.authority {
        a.authority = v;
    }
    if let Some(v) = args.name {
        require!(v.len() <= MAX_NAME, MostroError::StringTooLong);
        a.name = v;
    }
    if let Some(v) = args.uri {
        require!(v.len() <= MAX_URI, MostroError::StringTooLong);
        a.uri = v;
    }
    if let Some(v) = args.active {
        a.active = v;
    }
    emit!(ArtistUpdated {
        artist: a.key(),
        authority: a.authority,
        active: a.active,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawArtistVault<'info> {
    /// Only the artist authority can withdraw; the protocol admin cannot touch artist vaults.
    pub authority: Signer<'info>,
    #[account(
        seeds = [ARTIST_SEED, &artist.index.to_le_bytes()],
        bump = artist.bump,
        has_one = authority @ MostroError::Unauthorized,
    )]
    pub artist: Box<Account<'info, Artist>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        seeds = [ARTIST_VAULT_SEED, artist.key().as_ref(), mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = artist,
        token::token_program = token_program,
    )]
    pub artist_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn withdraw_artist_vault(ctx: Context<WithdrawArtistVault>, amount: u64) -> Result<()> {
    let a = &ctx.accounts.artist;
    let index = a.index.to_le_bytes();
    let seeds: &[&[u8]] = &[ARTIST_SEED, &index, &[a.bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.artist_vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: a.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;
    emit!(ArtistVaultWithdrawn {
        artist: a.key(),
        mint: ctx.accounts.mint.key(),
        destination: ctx.accounts.destination.key(),
        amount,
    });
    Ok(())
}
