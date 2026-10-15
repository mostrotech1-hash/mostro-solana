//! Artists. An artist is onboarded by the admin, gets one token through `create_curve`, opens
//! perks with its `authority` wallet and receives the artist half of hybrid perk sales in SOL on
//! that wallet. Its 50 % token reserve is a cold vault that only governance can move.

use anchor_lang::prelude::*;

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
    a.version = 2;
    a.index = config.artist_count;
    a.authority = authority;
    a.curve = Pubkey::default();
    a.name = name.clone();
    a.uri = uri;
    a.perk_count = 0;
    a.revenue_lamports = 0;
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
        // Only the current authority can hand the artist over: the admin cannot redirect the
        // artist's SOL income by rotating the key.
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
