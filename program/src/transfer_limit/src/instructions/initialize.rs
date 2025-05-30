use crate::state::Config;
use anchor_lang::prelude::*;

pub fn initialize(ctx: Context<Initialize>, lazorkit_author: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = lazorkit_author;

    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}
