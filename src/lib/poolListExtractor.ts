// src/lib/poolListExtractor.ts
import { Connection, PublicKey } from '@solana/web3.js';
import { getCachedMetadata, setCachedMetadata } from './tokenMetadataCache';

export interface PoolTokenMeta {
  symbol: string;
  name?: string;
  logo: string | null;
}

// In-memory pool cache keyed by network string
const poolCache = new Map<string, Map<string, PoolTokenMeta>>();

function resolveLogo(logo: string | null | undefined): string | null {
  if (!logo) return null;
  if (logo.startsWith('/')) return `https://app.xdex.xyz${logo}`;
  return logo;
}

export async function loadPoolMetadata(
  network: 'mainnet' | 'testnet' = 'mainnet'
): Promise<Map<string, PoolTokenMeta>> {
  if (poolCache.has(network)) return poolCache.get(network)!;

  const networkParam = network === 'mainnet' ? 'X1%20Mainnet' : 'X1%20Testnet';
  const url = `https://api.xdex.xyz/api/xendex/pool/list?network=${networkParam}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Pool API error: ${res.status}`);
    const json = await res.json();
    const map = new Map<string, PoolTokenMeta>();
    const pools = Array.isArray(json?.data) ? json.data : [];

    pools.forEach((pool: any) => {
      if (pool.token1_address) {
        map.set(pool.token1_address, {
          symbol: pool.token1_symbol || 'UNK',
          name: pool.token1_name || pool.token1_symbol || undefined,
          logo: resolveLogo(pool.token1_logo),
        });
      }
      if (pool.token2_address) {
        map.set(pool.token2_address, {
          symbol: pool.token2_symbol || 'UNK',
          name: pool.token2_name || pool.token2_symbol || undefined,
          logo: resolveLogo(pool.token2_logo),
        });
      }
    });

    poolCache.set(network, map);
    console.log(`[poolListExtractor] Loaded ${map.size} tokens for ${network}`);
    return map;
  } catch (e) {
    console.warn('[poolListExtractor] Live API call failed', e);
    return new Map();
  }
}

export async function getOnChainMetadata(
  connection: Connection,
  mint: string
): Promise<{ name: string; symbol: string; uri: string | null } | null> {
  try {
    const mintPubkey = new PublicKey(mint);
    const METAPLEX_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('metadata'), METAPLEX_PROGRAM_ID.toBuffer(), mintPubkey.toBuffer()],
      METAPLEX_PROGRAM_ID
    );

    const acc = await connection.getAccountInfo(metadataPDA);
    if (!acc) return null;

    let offset = 1 + 32 + 32; // key + updateAuthority + mint
    const nameLen = acc.data.readUInt32LE(offset); offset += 4;
    const name = acc.data.toString('utf8', offset, offset + nameLen).replace(/\0/g, '').trim();
    offset += nameLen;
    const symbolLen = acc.data.readUInt32LE(offset); offset += 4;
    const symbol = acc.data.toString('utf8', offset, offset + symbolLen).replace(/\0/g, '').trim();
    offset += symbolLen;
    const uriLen = acc.data.readUInt32LE(offset); offset += 4;
    const uri = acc.data.toString('utf8', offset, offset + uriLen).replace(/\0/g, '').trim();

    return { name: name || 'Unknown', symbol: symbol || 'UNK', uri: uri || null };
  } catch (e) {
    console.warn(`[poolListExtractor] getOnChainMetadata failed for ${mint}`, e);
    return null;
  }
}

export async function extractTokenMetadata(
  connection: Connection,
  mint: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
  kind?: string // pass 'nft' to skip pool lookup
): Promise<{ symbol: string; name: string; logo: string | null; uri?: string }> {
  // 1. localStorage cache
  const cached = getCachedMetadata(mint);
  if (cached) {
    return { symbol: cached.symbol, name: cached.name, logo: cached.logo, uri: cached.uri };
  }

  // 2. XDEX pool list (tokens only)
  if (kind !== 'nft') {
    const poolMap = await loadPoolMetadata(network);
    const poolMeta = poolMap.get(mint);
    if (poolMeta) {
      const meta = { symbol: poolMeta.symbol, name: poolMeta.name || 'Unknown', logo: poolMeta.logo };
      setCachedMetadata(mint, meta);
      return meta;
    }
  }

  // 3. On-chain Metaplex (tokens + NFTs)
  const onChain = await getOnChainMetadata(connection, mint);
  if (onChain) {
    let logo: string | null = null;
    if (onChain.uri) {
      try {
        let jsonUrl = onChain.uri.trim().replace(/\0/g, '');
        if (jsonUrl.startsWith('ipfs://')) jsonUrl = jsonUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
        else if (jsonUrl.startsWith('ar://')) jsonUrl = jsonUrl.replace('ar://', 'https://arweave.net/');
        const jsonRes = await fetch(jsonUrl);
        if (jsonRes.ok) {
          const json = await jsonRes.json();
          let img: string | null =
            json.image || json.image_url || json.properties?.files?.[0]?.uri || null;
          if (img) {
            img = img.trim();
            if (img.startsWith('ipfs://')) img = img.replace('ipfs://', 'https://ipfs.io/ipfs/');
            else if (img.startsWith('ar://')) img = img.replace('ar://', 'https://arweave.net/');
          }
          logo = img;
        }
      } catch (e) {
        console.warn(`[poolListExtractor] URI fetch failed for ${mint}`, e);
      }
    }
    const meta = {
      symbol: onChain.symbol,
      name: onChain.name,
      logo,
      uri: onChain.uri || undefined,
    };
    setCachedMetadata(mint, meta);
    return meta;
  }

  // 4. Unknown fallback
  const unknown = { symbol: 'UNK', name: 'Unknown Token', logo: null };
  setCachedMetadata(mint, unknown);
  return unknown;
}
