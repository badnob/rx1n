// src/lib/fetchSortedHolders.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

export type Holder = {
  owner: string;
  uiAmount: number;
};

export async function fetchSortedHolders(
  connection: Connection,
  mintAddress: string
): Promise<{ holders: Holder[]; decimals: number }> {
  const mintPk = new PublicKey(mintAddress);

  // Auto-detect which token program owns this mint
  const mintInfo = await connection.getAccountInfo(mintPk);
  if (!mintInfo) throw new Error('Mint account not found');
  const programId = mintInfo.owner;
  const isToken2022 = programId.equals(TOKEN_2022_PROGRAM_ID);

  // Build filters: always filter by mint address at offset 0.
  // For Token-2022 we intentionally omit dataSize because extensions make
  // account size variable — filtering by 165 or 170 would silently drop
  // valid accounts. For standard SPL Token the size is always 165.
  const filters: any[] = [{ memcmp: { offset: 0, bytes: mintAddress } }];
  if (!isToken2022) {
    filters.unshift({ dataSize: 165 });
  }

  const accounts = await connection.getParsedProgramAccounts(programId, { filters });

  let decimals = 9; // Fallback; overwritten by first parsed account

  const holders: Holder[] = accounts
    .map((acc: any) => {
      try {
        const info = acc.account.data.parsed.info;
        decimals = info.tokenAmount.decimals;
        return {
          owner: info.owner as string,
          uiAmount: (info.tokenAmount.uiAmount as number) || 0,
        };
      } catch {
        return null;
      }
    })
    .filter((h): h is Holder => h !== null && h.uiAmount > 0)
    .sort((a, b) => b.uiAmount - a.uiAmount);

  // Deduplicate owners (one wallet may have multiple ATAs for the same mint)
  const seen = new Set<string>();
  const unique = holders.filter((h) => {
    if (seen.has(h.owner)) return false;
    seen.add(h.owner);
    return true;
  });

  return { holders: unique, decimals };
}
