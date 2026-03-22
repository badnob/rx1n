// src/lib/metadataFetcher.tsx
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';

// Cache is keyed by network so switching mainnet↔testnet always fetches fresh data
const xdexTokensCache = new Map<string, Map<string, any>>();

async function getXdexTokens(network: string): Promise<Map<string, any>> {
  if (xdexTokensCache.has(network)) return xdexTokensCache.get(network)!;

  try {
    const res = await axios.get('https://api.xdex.xyz/api/xendex/pool/list', {
      params: { network: network === 'mainnet' ? 'X1 Mainnet' : 'X1 Testnet' },
    });
    const map = new Map<string, any>();
    const pools = Array.isArray(res.data?.data) ? res.data.data : [];
    pools.forEach((p: any) => {
      if (p.token1_address) {
        map.set(p.token1_address, {
          symbol: p.token1_symbol,
          name: p.token1_name,
          logo: p.token1_logo,
        });
      }
      if (p.token2_address) {
        map.set(p.token2_address, {
          symbol: p.token2_symbol,
          name: p.token2_name,
          logo: p.token2_logo,
        });
      }
    });
    xdexTokensCache.set(network, map);
    return map;
  } catch (e) {
    console.warn('[metadataFetcher] XDEX pool fetch failed', e);
    return new Map();
  }
}

function resolveLogoUrl(logo: string | null | undefined): string | null {
  if (!logo) return null;
  if (logo.startsWith('/')) return `https://app.xdex.xyz${logo}`;
  return logo;
}

export async function fetchTokenMetadata(
  connection: Connection,
  mintStr: string,
  network: string
): Promise<{ symbol: string; name: string; logo: string | null; supply: number }> {
  let finalSymbol = `${mintStr.slice(0, 4).toUpperCase()}..${mintStr.slice(-4).toUpperCase()}`;
  let finalName = 'Unknown Asset';
  let finalLogo: string | null = null;
  let finalSupply = 0;

  try {
    const mint = new PublicKey(mintStr);

    // 1. Total supply directly from RPC
    try {
      const supplyInfo = await connection.getTokenSupply(mint);
      finalSupply = supplyInfo.value.uiAmount || 0;
    } catch (e) {
      console.warn('[metadataFetcher] Supply fetch failed', e);
    }

    // 2. XDEX verified pool list (network-keyed cache)
    const xdexMap = await getXdexTokens(network);
    if (xdexMap.has(mintStr)) {
      const data = xdexMap.get(mintStr)!;
      finalSymbol = data.symbol || finalSymbol;
      finalName = data.name || finalName;
      finalLogo = resolveLogoUrl(data.logo);
      return { symbol: finalSymbol, name: finalName, logo: finalLogo, supply: finalSupply };
    }

    // 3. On-chain Metaplex metadata (browser-safe — no Buffer)
    const METAPLEX = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const [pda] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('metadata'), METAPLEX.toBytes(), mint.toBytes()],
      METAPLEX
    );

    const acc = await connection.getAccountInfo(pda);
    if (acc?.data) {
      const view = new DataView(acc.data.buffer, acc.data.byteOffset, acc.data.byteLength);
      let offset = 65; // key(1) + updateAuthority(32) + mint(32)

      try {
        const nameLen = view.getUint32(offset, true); offset += 4;
        const name = new TextDecoder()
          .decode(acc.data.slice(offset, offset + nameLen))
          .replace(/\0/g, '')
          .trim();
        offset += nameLen;
        if (name) finalName = name;

        const symLen = view.getUint32(offset, true); offset += 4;
        const symbol = new TextDecoder()
          .decode(acc.data.slice(offset, offset + symLen))
          .replace(/\0/g, '')
          .trim();
        offset += symLen;
        if (symbol) finalSymbol = symbol;

        const uriLen = view.getUint32(offset, true); offset += 4;
        const uri = new TextDecoder()
          .decode(acc.data.slice(offset, offset + uriLen))
          .replace(/\0/g, '')
          .trim();

        if (uri) {
          const resolvedUri = uri
            .replace('ipfs://', 'https://ipfs.io/ipfs/')
            .replace('ar://', 'https://arweave.net/');
          try {
            const res = await fetch(resolvedUri);
            if (res.ok) {
              const json = await res.json();
              finalLogo = json.image || json.image_url || null;
            }
          } catch (fetchErr) {
            console.warn('[metadataFetcher] URI fetch failed', fetchErr);
          }
        }
      } catch (parseErr) {
        console.warn('[metadataFetcher] Metaplex parse skipped', parseErr);
      }
    }
  } catch (e) {
    console.warn('[metadataFetcher] Outer error', e);
  }

  return { symbol: finalSymbol, name: finalName, logo: finalLogo, supply: finalSupply };
}
