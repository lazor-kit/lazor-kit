use anchor_lang::prelude::*;

use crate::{state::WhitelistRulePrograms, ID};

pub fn upsert_whitelist_rule_programs(
    ctx: Context<UpsertWhitelistRulePrograms>,
    hook: Pubkey,
) -> Result<()> {
    let whitelist_rule_programs = &mut ctx.accounts.whitelist_rule_programs;

    whitelist_rule_programs.list.push(hook);
    Ok(())
}

#[derive(Accounts)]
pub struct UpsertWhitelistRulePrograms<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [WhitelistRulePrograms::PREFIX_SEED],
        bump,
        owner = ID,
    )]
    pub whitelist_rule_programs: Account<'info, WhitelistRulePrograms>,

    pub system_program: Program<'info, System>,
}
