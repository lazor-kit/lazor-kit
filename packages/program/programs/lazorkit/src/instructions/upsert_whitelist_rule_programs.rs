use anchor_lang::prelude::*;

use crate::{
    state::{Config, WhitelistRulePrograms},
    ID,
};

pub fn upsert_whitelist_rule_programs(
    ctx: Context<UpsertWhitelistRulePrograms>,
    program_id: Pubkey,
) -> Result<()> {
    let whitelist = &mut ctx.accounts.whitelist_rule_programs;

    if !whitelist.list.contains(&program_id) {
        whitelist.list.push(program_id);
    }

    Ok(())
}

#[derive(Accounts)]
pub struct UpsertWhitelistRulePrograms<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [Config::PREFIX_SEED],
        bump,
        has_one = authority
    )]
    pub config: Box<Account<'info, Config>>,

    #[account(
        mut,
        seeds = [WhitelistRulePrograms::PREFIX_SEED],
        bump,
        owner = ID,
    )]
    pub whitelist_rule_programs: Account<'info, WhitelistRulePrograms>,
}
