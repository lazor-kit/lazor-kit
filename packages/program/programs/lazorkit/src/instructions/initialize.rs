use anchor_lang::prelude::*;

use crate::state::{Config, SmartWalletSeq, WhitelistRulePrograms};

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let whitelist_rule_programs = &mut ctx.accounts.whitelist_rule_programs;
    whitelist_rule_programs.list = vec![ctx.accounts.default_rule_program.key()];

    let smart_wallet_seq = &mut ctx.accounts.smart_wallet_seq;
    smart_wallet_seq.seq = 0;

    let config: &mut Box<Account<'_, Config>> = &mut ctx.accounts.config;
    config.authority = ctx.accounts.signer.key();
    config.create_smart_wallet_fee = 0; // LAMPORTS
    config.default_rule_program = ctx.accounts.default_rule_program.key();
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
        seeds = [Config::PREFIX_SEED],
        bump,
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + WhitelistRulePrograms::INIT_SPACE,
        seeds = [WhitelistRulePrograms::PREFIX_SEED],
        bump
    )]
    pub whitelist_rule_programs: Box<Account<'info, WhitelistRulePrograms>>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + SmartWalletSeq::INIT_SPACE,
        seeds = [SmartWalletSeq::PREFIX_SEED],
        bump
    )]
    pub smart_wallet_seq: Box<Account<'info, SmartWalletSeq>>,

    /// CHECK:
    pub default_rule_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}
