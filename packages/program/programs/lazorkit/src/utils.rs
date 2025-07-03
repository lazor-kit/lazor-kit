use crate::constants::SECP256R1_ID;
use crate::{error::LazorKitError, ID};
use anchor_lang::solana_program::{
    instruction::Instruction,
    program::{invoke, invoke_signed},
};
use anchor_lang::{prelude::*, solana_program::hash::hash};

// Constants for Secp256r1 signature verification
const SECP_HEADER_SIZE: u16 = 14;
const SECP_DATA_START: u16 = 2 + SECP_HEADER_SIZE;
const SECP_PUBKEY_SIZE: u16 = 33;
const SECP_SIGNATURE_SIZE: u16 = 64;
const SECP_HEADER_TOTAL: usize = 16;

/// Convenience wrapper to pass PDA seeds & bump into [`execute_cpi`].
///
/// Anchor expects PDA seeds as `&[&[u8]]` when calling `invoke_signed`.  Generating that slice of
/// byte-slices at every call-site is error-prone, so we hide the details behind this struct.  The
/// helper converts the `Vec<Vec<u8>>` into the required `&[&[u8]]` on the stack just before the
/// CPI.
#[derive(Clone)]
pub struct PdaSigner {
    /// PDA derivation seeds **without** the trailing bump.
    pub seeds: Vec<Vec<u8>>,
    /// The bump associated with the PDA.
    pub bump: u8,
}

/// Helper to check if a slice matches a pattern
#[inline]
pub fn slice_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| x == y)
}

/// Execute a Cross-Program Invocation (CPI).
///
/// * `accounts` – slice of `AccountInfo` that will be forwarded to the target program.
/// * `data` – raw instruction data **as a slice**; passing a slice removes the need for the
///   caller to allocate a new `Vec<u8>` every time a CPI is performed.  A single allocation is
///   still required internally when constructing the `Instruction`, but this change avoids an
///   additional clone at every call-site.
/// * `program` – account info of the program to invoke.
/// * `signer` – optional PDA signer information.  When provided, the seeds are appended with the
///   bump and the CPI is invoked with `invoke_signed`.
pub fn execute_cpi(
    accounts: &[AccountInfo],
    data: &[u8],
    program: &AccountInfo,
    signer: Option<PdaSigner>,
) -> Result<()> {
    // Allocate a single Vec<u8> for the instruction – unavoidable because the SDK expects owned
    // data.  This keeps the allocation inside the helper and eliminates clones at the call-site.
    let ix = create_cpi_instruction(accounts, data.to_vec(), program, &signer);

    match signer {
        Some(s) => {
            // Build seed slice **once** to avoid repeated heap allocations.
            let mut seed_slices: Vec<&[u8]> = s.seeds.iter().map(|s| s.as_slice()).collect();
            let bump_slice = [s.bump];
            seed_slices.push(&bump_slice);
            invoke_signed(&ix, accounts, &[&seed_slices])
        }
        None => invoke(&ix, accounts),
    }
    .map_err(Into::into)
}

/// Create a CPI instruction with proper account meta configuration
fn create_cpi_instruction(
    accounts: &[AccountInfo],
    data: Vec<u8>,
    program: &AccountInfo,
    pda_signer: &Option<PdaSigner>,
) -> Instruction {
    let pda_pubkey = pda_signer.as_ref().map(|pda| {
        let seed_slices: Vec<&[u8]> = pda.seeds.iter().map(|s| s.as_slice()).collect();
        Pubkey::find_program_address(&seed_slices, &ID).0
    });

    Instruction {
        program_id: program.key(),
        accounts: accounts
            .iter()
            .map(|acc| {
                let is_signer = if let Some(pda_key) = pda_pubkey {
                    acc.is_signer || *acc.key == pda_key
                } else {
                    acc.is_signer
                };

                AccountMeta {
                    pubkey: *acc.key,
                    is_signer,
                    is_writable: acc.is_writable,
                }
            })
            .collect(),
        data,
    }
}

/// Verify a Secp256r1 signature instruction
pub fn verify_secp256r1_instruction(
    ix: &Instruction,
    pubkey: [u8; SECP_PUBKEY_SIZE as usize],
    msg: Vec<u8>,
    sig: &[u8],
) -> Result<()> {
    let expected_len =
        (SECP_DATA_START + SECP_PUBKEY_SIZE + SECP_SIGNATURE_SIZE) as usize + msg.len();
    if ix.program_id != SECP256R1_ID || !ix.accounts.is_empty() || ix.data.len() != expected_len {
        return Err(LazorKitError::Secp256r1InvalidLength.into());
    }
    verify_secp256r1_data(&ix.data, pubkey, msg, sig)
}

/// Verify the data portion of a Secp256r1 signature
fn verify_secp256r1_data(
    data: &[u8],
    public_key: [u8; SECP_PUBKEY_SIZE as usize],
    message: Vec<u8>,
    signature: &[u8],
) -> Result<()> {
    let msg_len = message.len() as u16;
    let offsets = calculate_secp_offsets(msg_len);

    if !verify_secp_header(data, &offsets) {
        return Err(LazorKitError::Secp256r1HeaderMismatch.into());
    }

    if !verify_secp_data(data, &public_key, signature, &message) {
        return Err(LazorKitError::Secp256r1DataMismatch.into());
    }

    Ok(())
}

/// Calculate offsets for Secp256r1 signature verification
#[derive(Debug)]
struct SecpOffsets {
    pubkey_offset: u16,
    sig_offset: u16,
    msg_offset: u16,
    msg_len: u16,
}

#[inline]
fn calculate_secp_offsets(msg_len: u16) -> SecpOffsets {
    SecpOffsets {
        pubkey_offset: SECP_DATA_START,
        sig_offset: SECP_DATA_START + SECP_PUBKEY_SIZE,
        msg_offset: SECP_DATA_START + SECP_PUBKEY_SIZE + SECP_SIGNATURE_SIZE,
        msg_len,
    }
}

#[inline]
fn verify_secp_header(data: &[u8], offsets: &SecpOffsets) -> bool {
    data[0] == 1
        && u16::from_le_bytes(data[2..=3].try_into().unwrap()) == offsets.sig_offset
        && u16::from_le_bytes(data[4..=5].try_into().unwrap()) == 0xFFFF
        && u16::from_le_bytes(data[6..=7].try_into().unwrap()) == offsets.pubkey_offset
        && u16::from_le_bytes(data[8..=9].try_into().unwrap()) == 0xFFFF
        && u16::from_le_bytes(data[10..=11].try_into().unwrap()) == offsets.msg_offset
        && u16::from_le_bytes(data[12..=13].try_into().unwrap()) == offsets.msg_len
        && u16::from_le_bytes(data[14..=15].try_into().unwrap()) == 0xFFFF
}

#[inline]
fn verify_secp_data(data: &[u8], public_key: &[u8], signature: &[u8], message: &[u8]) -> bool {
    let pubkey_range = SECP_HEADER_TOTAL..SECP_HEADER_TOTAL + SECP_PUBKEY_SIZE as usize;
    let sig_range = pubkey_range.end..pubkey_range.end + SECP_SIGNATURE_SIZE as usize;
    let msg_range = sig_range.end..;

    data[pubkey_range] == public_key[..]
        && data[sig_range] == signature[..]
        && data[msg_range] == message[..]
}

/// Extension trait for passkey operations
pub trait PasskeyExt {
    fn to_hashed_bytes(&self, wallet: Pubkey) -> [u8; 32];
}

impl PasskeyExt for [u8; SECP_PUBKEY_SIZE as usize] {
    #[inline]
    fn to_hashed_bytes(&self, wallet: Pubkey) -> [u8; 32] {
        let mut buf = [0u8; 65];
        buf[..SECP_PUBKEY_SIZE as usize].copy_from_slice(self);
        buf[SECP_PUBKEY_SIZE as usize..].copy_from_slice(&wallet.to_bytes());
        hash(&buf).to_bytes()
    }
}

#[inline]
pub fn transfer_sol_from_pda(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    // Ensure the 'from' account is owned by this program
    if *from.owner != ID {
        return Err(ProgramError::IllegalOwner.into());
    }
    // Debit from source account
    **from.try_borrow_mut_lamports()? -= amount;
    // Credit to destination account
    **to.try_borrow_mut_lamports()? += amount;
    Ok(())
}
