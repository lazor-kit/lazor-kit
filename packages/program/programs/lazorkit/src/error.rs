use anchor_lang::error_code;

/// Custom errors for the Lazor Kit program
#[error_code]
pub enum LazorKitError {
    // === Authentication & Passkey Errors ===
    #[msg("Passkey public key mismatch with stored authenticator")]
    PasskeyMismatch,
    #[msg("Smart wallet address mismatch with authenticator")]
    SmartWalletMismatch,
    #[msg("Smart wallet authenticator account not found or invalid")]
    AuthenticatorNotFound,

    // === Signature Verification Errors ===
    #[msg("Secp256r1 instruction has invalid data length")]
    Secp256r1InvalidLength,
    #[msg("Secp256r1 instruction header validation failed")]
    Secp256r1HeaderMismatch,
    #[msg("Secp256r1 signature data validation failed")]
    Secp256r1DataMismatch,
    #[msg("Secp256r1 instruction not found at specified index")]
    Secp256r1InstructionNotFound,
    #[msg("Invalid signature provided for passkey verification")]
    InvalidSignature,

    // === Client Data & Challenge Errors ===
    #[msg("Client data JSON is not valid UTF-8")]
    ClientDataInvalidUtf8,
    #[msg("Client data JSON parsing failed")]
    ClientDataJsonParseError,
    #[msg("Challenge field missing from client data JSON")]
    ChallengeMissing,
    #[msg("Challenge base64 decoding failed")]
    ChallengeBase64DecodeError,
    #[msg("Challenge message deserialization failed")]
    ChallengeDeserializationError,

    // === Timestamp & Nonce Errors ===
    #[msg("Message timestamp is too far in the past")]
    TimestampTooOld,
    #[msg("Message timestamp is too far in the future")]
    TimestampTooNew,
    #[msg("Nonce mismatch: expected different value")]
    NonceMismatch,
    #[msg("Nonce overflow: cannot increment further")]
    NonceOverflow,

    // === Rule Program Errors ===
    #[msg("Rule program not found in whitelist")]
    RuleProgramNotWhitelisted,
    #[msg("Invalid instruction discriminator for check_rule")]
    InvalidCheckRuleDiscriminator,
    #[msg("Invalid instruction discriminator for destroy")]
    InvalidDestroyDiscriminator,
    #[msg("Invalid instruction discriminator for init_rule")]
    InvalidInitRuleDiscriminator,
    #[msg("Old and new rule programs are identical")]
    RuleProgramsIdentical,
    #[msg("Neither old nor new rule program is the default")]
    NoDefaultRuleProgram,

    // === Account & CPI Errors ===
    #[msg("CPI data is required but not provided")]
    CpiDataMissing,
    #[msg("Insufficient remaining accounts for rule instruction")]
    InsufficientRuleAccounts,
    #[msg("Insufficient remaining accounts for CPI instruction")]
    InsufficientCpiAccounts,
    #[msg("Account slice index out of bounds")]
    AccountSliceOutOfBounds,
    #[msg("SOL transfer requires at least 2 remaining accounts")]
    SolTransferInsufficientAccounts,
    #[msg("New authenticator account is required but not provided")]
    NewAuthenticatorMissing,
    #[msg("New authenticator passkey is required but not provided")]
    NewAuthenticatorPasskeyMissing,

    // === Financial Errors ===
    #[msg("Insufficient lamports for requested transfer")]
    InsufficientLamports,
    #[msg("Transfer amount would cause arithmetic overflow")]
    TransferAmountOverflow,

    // === Validation Errors ===
    #[msg("Invalid bump seed for PDA derivation")]
    InvalidBumpSeed,
    #[msg("Account owner verification failed")]
    InvalidAccountOwner,
    #[msg("Account discriminator mismatch")]
    InvalidAccountDiscriminator,
}
