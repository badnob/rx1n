// src/lib/airdropLogic.ts
import { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { DEV_WALLET, DEV_FEE_PER_BATCH_XNT } from './constants';

/**
 * Sends a single pre-chunked batch of recipients in one transaction.
 *
 * NOTE: The caller (App.tsx) is responsible for chunking the full holder list
 * into slices of CHUNK_SIZE before calling this function. Do NOT pass the
 * full holder list here — pass one chunk at a time.
 */
export async function executeBatchedAirdrop(
  connection: Connection,
  wallet: PublicKey,
  sendTransaction: (tx: Transaction, conn: Connection) => Promise<string>,
  dropMint: string,
  decimals: number,
  dropAmount: string,
  chunk: string[],         // ← a single pre-sliced chunk, NOT the full list
  setStatus: (status: string) => void,
  batchLabel: string       // e.g. "3 of 12" — supplied by caller for status messages
): Promise<void> {
  const dropMintPubkey = new PublicKey(dropMint);
  const amountPerUser = BigInt(Math.floor(parseFloat(dropAmount) * Math.pow(10, decimals)));

  // Detect whether the mint belongs to standard SPL Token or Token-2022
  const mintInfo = await connection.getAccountInfo(dropMintPubkey);
  if (!mintInfo) throw new Error('Mint account not found on-chain');

  const programId = mintInfo.owner;
  const isStandard = programId.equals(TOKEN_PROGRAM_ID);
  const is2022 = programId.equals(TOKEN_2022_PROGRAM_ID);
  if (!isStandard && !is2022) throw new Error('Unknown token program ID');

  // Sender's associated token account
  const senderAta = getAssociatedTokenAddressSync(
    dropMintPubkey,
    wallet,
    false,
    programId
  );

  const tx = new Transaction();

  // Per-batch dev fee (SOL / XNT)
  tx.add(
    SystemProgram.transfer({
      fromPubkey: wallet,
      toPubkey: DEV_WALLET,
      lamports: Math.round(DEV_FEE_PER_BATCH_XNT * LAMPORTS_PER_SOL),
    })
  );

  // Check which recipients already have an ATA — only create accounts for those that don't.
  // This avoids unnecessary ATA creation instructions that can cause blocks.
  setStatus(`Checking accounts for batch ${batchLabel}...`);
  const ataChecks = await Promise.all(
    chunk.map(async (recipient) => {
      const recipientPubkey = new PublicKey(recipient);

      // Skip off-curve addresses (PDAs) — they cannot own ATAs
      if (!PublicKey.isOnCurve(recipientPubkey.toBytes())) {
        console.warn(`[airdrop] Skipping off-curve address: ${recipient}`);
        return null;
      }

      const recipientAta = getAssociatedTokenAddressSync(
        dropMintPubkey,
        recipientPubkey,
        false,
        programId
      );

      const ataInfo = await connection.getAccountInfo(recipientAta);
      return { recipientPubkey, recipientAta, ataExists: ataInfo !== null };
    })
  );

  const validRecipients = ataChecks.filter((r): r is NonNullable<typeof r> => r !== null);

  // If every recipient in this chunk was off-curve, skip the transaction entirely
  if (validRecipients.length === 0) {
    setStatus(`Batch ${batchLabel} skipped — all recipients were program accounts.`);
    return;
  }

  for (const { recipientPubkey, recipientAta, ataExists } of validRecipients) {
    // Only add ATA creation if the account doesn't exist yet
    if (!ataExists) {
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          wallet,
          recipientAta,
          recipientPubkey,
          dropMintPubkey,
          programId
        )
      );
    }

    // Always add the transfer
    tx.add(
      createTransferInstruction(
        senderAta,
        recipientAta,
        wallet,
        amountPerUser,
        [],
        programId
      )
    );
  }

  setStatus(`Sending batch ${batchLabel}...`);
  let signature: string;
  try {
    signature = await sendTransaction(tx, connection);
  } catch (err: any) {
    const msg = err?.message || err?.toString() || JSON.stringify(err);
    // Backpack keyring session expiry
    if (msg.includes('UserKeyring not found') || msg.includes('invariant violation')) {
      throw new Error('Wallet session expired. Unlock your wallet and click CONTINUE SEQUENCE.');
    }
    // User rejected the transaction
    if (msg.includes('User rejected') || msg.includes('Transaction cancelled')) {
      throw new Error('Transaction rejected. Click CONTINUE SEQUENCE to retry this batch.');
    }
    throw new Error(`Send failed: ${msg}`);
  }

  setStatus(`Confirming batch ${batchLabel}...`);
  try {
    await connection.confirmTransaction(signature, 'processed');
  } catch (err: any) {
    const msg = err?.message || err?.toString() || JSON.stringify(err);
    throw new Error(`Confirmation failed: ${msg}`);
  }
}
