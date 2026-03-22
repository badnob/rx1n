// src/lib/constants.ts
// Single source of truth for shared config values

import { PublicKey } from '@solana/web3.js';

/** Number of recipients packed into each airdrop transaction */
export const CHUNK_SIZE = 7;

/** SOL fee sent to dev wallet per batch transaction */
export const DEV_FEE_PER_BATCH_XNT = 0.001;

/** Dev wallet that receives the per-batch fee */
export const DEV_WALLET = new PublicKey('25WjVij1ebBtiu85dTQGP1Gu1htUrFLnwtEDgzpztGZ6');

/** Estimated Solana network fee per transaction in SOL */
export const ESTIMATED_TX_FEE_SOL = 0.00003;

/** Rent-exempt deposit required to open a new ATA, in SOL */
export const RENT_EXEMPT_ATA_SOL = 0.002039;

/** Fraction of recipients estimated to need a new ATA created */
export const TYPICAL_ATA_CREATION_RATE = 0.4;

/** Maximum holders fetched from chain in a single scan */
export const MAX_HOLDERS = 5000;
