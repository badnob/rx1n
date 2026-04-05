// src/App.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { PublicKey } from '@solana/web3.js';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

import styles from './page.module.css';
import MatrixRain from './components/MatrixRain';
import ConnectButtons from './components/ConnectButtons';
import TokenCard from './components/TokenCard';
import TokenSelect from './components/TokenSelect';
import { useTokenMetadata } from './hooks/useTokenMetadata';
import { executeBatchedAirdrop, BatchResult } from './lib/airdropLogic';
import { getTokenAccounts } from './lib/getTokenAccounts';
import { fetchTokenMetadata } from './lib/metadataFetcher';
import {
  CHUNK_SIZE,
  DEV_FEE_PER_BATCH_XNT,
  ESTIMATED_TX_FEE_SOL,
  RENT_EXEMPT_ATA_SOL,
  TYPICAL_ATA_CREATION_RATE,
  MAX_HOLDERS,
} from './lib/constants';

interface AppProps {
  network: 'mainnet' | 'testnet';
  setNetwork: (network: 'mainnet' | 'testnet') => void;
}

function getSafePubKey(mintStr: string): string {
  try {
    if (!mintStr) return '';
    const clean = mintStr.replace(/[\s\uFEFF\xA0]+/g, '').trim();
    const isValidBase58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
    if (!isValidBase58) return '';
    const pk = new PublicKey(clean);
    return pk.toBase58();
  } catch {
    return '';
  }
}

export default function App({ network, setNetwork }: AppProps) {
  const { connection } = useConnection();
  const { publicKey: wallet, sendTransaction } = useWallet();

  const [activeStep, setActiveStep] = useState(1);
  const [status, setStatus] = useState('');
  const [batchProgress, setBatchProgress] = useState<number | null>(null);
  // Prevents double-triggering the airdrop while one is already running
  const [isProcessing, setIsProcessing] = useState(false);

  // ── Transaction log ──────────────────────────────────────────────────────────
  interface TxRecord {
    batch: number;
    timestamp: string;
    amountPerRecipient: number;
    symbol: string;
    mint: string;
    network: string;
    result: BatchResult;
  }
  const [txLog, setTxLog] = useState<TxRecord[]>([]);
  const [airdropComplete, setAirdropComplete] = useState(false);

  // Tracks all-PDA batches that were fully skipped (no charge)
  interface PdaSkipRecord {
    batch: number;
    addresses: string[];
  }
  const [pdaSkipLog, setPdaSkipLog] = useState<PdaSkipRecord[]>([]);

  // ── Cost calculator ──────────────────────────────────────────────────────────
  const [estimatedHolders, setEstimatedHolders] = useState<number>(0);
  const [costLocked, setCostLocked] = useState<boolean>(false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState<boolean>(false);

  const batchCount = estimatedHolders > 0 ? Math.ceil(estimatedHolders / CHUNK_SIZE) : 0;
  const devFeeTotalXNT = (batchCount * DEV_FEE_PER_BATCH_XNT).toFixed(4);
  const estimatedNetworkFeesSOL = (batchCount * ESTIMATED_TX_FEE_SOL).toFixed(6);
  const worstCaseAtaRentSOL = (estimatedHolders * RENT_EXEMPT_ATA_SOL).toFixed(4);
  const typicalAtaRentSOL = (estimatedHolders * RENT_EXEMPT_ATA_SOL * TYPICAL_ATA_CREATION_RATE).toFixed(4);
  const totalTypicalSOL = (parseFloat(estimatedNetworkFeesSOL) + parseFloat(typicalAtaRentSOL)).toFixed(4);

  // ── Fail-safe resume queue ───────────────────────────────────────────────────
  const [remainingHolders, setRemainingHolders] = useState<string[]>([]);
  const [isResuming, setIsResuming] = useState(false);

  // ── Mint / holder state ──────────────────────────────────────────────────────
  const [sourceMint, setSourceMint] = useState('');
  const [holders, setHolders] = useState<string[]>([]);

  const validatedMintString = useMemo(() => getSafePubKey(sourceMint), [sourceMint]);
  const isValidMint = validatedMintString !== '';

  const sourceMeta = useTokenMetadata(connection, validatedMintString, network);

  // ── Wallet token list ────────────────────────────────────────────────────────
  const [walletTokens, setWalletTokens] = useState<any[]>([]);
  const [selectedToken, setSelectedToken] = useState<any | null>(null);
  const [dropAmount, setDropAmount] = useState('');
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);
  const [assetType, setAssetType] = useState<'token' | 'nft'>('token');

  // Load tokens whenever the connected wallet or network changes
  useEffect(() => {
    if (!wallet) {
      setWalletTokens([]);
      setSelectedToken(null);
      return;
    }

    setIsLoadingTokens(true);
    getTokenAccounts(connection, wallet)
      .then(async (rpcTokens) => {
        const activeTokens = rpcTokens.filter((t) => t.uiAmount > 0);
        const tokensWithMeta = await Promise.all(
          activeTokens.map(async (t) => {
            let meta = { symbol: 'UNK', name: 'Unknown', logo: null as string | null };
            try {
              meta = await fetchTokenMetadata(connection, t.mint, network);
            } catch {}
            return {
              mint: t.mint,
              symbol: meta.symbol || 'UNK',
              name: meta.name || 'Unknown',
              logo: meta.logo || null,
              balance: t.uiAmount,
              decimals: t.decimals,
            };
          })
        );
        setWalletTokens(tokensWithMeta.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch((e) => console.error('Wallet RPC scan failed:', e))
      .finally(() => setIsLoadingTokens(false));
  }, [wallet, network, connection]);

  // Reset token selection and drop amount when asset type switches.
  // Setting dropAmount here (not in JSX) avoids the side-effect-in-render bug.
  useEffect(() => {
    setSelectedToken(null);
    setDropAmount(assetType === 'nft' ? '1' : '');
  }, [assetType]);

  // Resume detection: check localStorage for a partial airdrop in progress
  useEffect(() => {
    if (validatedMintString && costLocked) {
      const saved = localStorage.getItem(`xender_remaining_${validatedMintString}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.remaining) && parsed.remaining.length > 0) {
            setRemainingHolders(parsed.remaining);
            setHolders(parsed.remaining);
            setIsResuming(true);
            setStatus(`Resuming – ${parsed.remaining.length} holders left`);
          }
        } catch {}
      }
    }
  }, [validatedMintString, costLocked]);

  // ── Holder scan ──────────────────────────────────────────────────────────────
  const fetchHolders = async () => {
    try {
      setStatus('Validating target mint address...');
      const rawString = sourceMint || '';
      const cleanMintStr = rawString.replace(/[\s\uFEFF\xA0]+/g, '').trim();

      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cleanMintStr)) {
        setStatus('Error: Invalid Solana address. Ensure no special characters are present.');
        return;
      }

      let mintPubKey: PublicKey;
      try {
        mintPubKey = new PublicKey(cleanMintStr);
      } catch {
        setStatus('Error: Cryptographically invalid target address.');
        return;
      }

      setStatus('Scanning ledger for holders... Please wait.');
      let accounts: any[] = [];

      try {
        accounts = await connection.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
          filters: [
            { dataSize: 165 },
            { memcmp: { offset: 0, bytes: mintPubKey.toBase58() } },
          ],
        });
      } catch (e) {
        console.warn('Standard token query failed:', e);
      }

      // If nothing found under SPL Token, try Token-2022 (no dataSize filter — extensions vary)
      if (!accounts || accounts.length === 0) {
        try {
          accounts = await connection.getParsedProgramAccounts(TOKEN_2022_PROGRAM_ID, {
            filters: [{ memcmp: { offset: 0, bytes: mintPubKey.toBase58() } }],
          });
        } catch (e) {
          console.warn('Token-2022 query failed:', e);
        }
      }

      // Parse accounts into { owner, uiAmount } pairs for sorting
      const holderMap = new Map<string, number>();
      for (const a of accounts || []) {
        try {
          const parsedData = (a.account.data as any)?.parsed?.info;
          if (
            parsedData?.owner &&
            parsedData.tokenAmount?.uiAmount > 0 &&
            typeof parsedData.owner === 'string' &&
            parsedData.owner.length > 30
          ) {
            const owner = parsedData.owner as string;
            const amount = parsedData.tokenAmount.uiAmount as number;
            // Keep the highest balance if owner has multiple ATAs
            if (!holderMap.has(owner) || holderMap.get(owner)! < amount) {
              holderMap.set(owner, amount);
            }
          }
        } catch {
          try {
            if (Buffer.isBuffer(a.account.data)) {
              const bufferSlice = a.account.data.slice(32, 64);
              if (bufferSlice.length === 32) {
                const owner = new PublicKey(bufferSlice).toBase58();
                if (!holderMap.has(owner)) holderMap.set(owner, 0);
              }
            }
          } catch {}
        }
      }

      // Sort highest balance first, then filter out any unparseable addresses
      const onCurveHolders = [...holderMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([owner]) => owner)
        .filter((addr) => {
          try {
            new PublicKey(addr); // just validate it parses — X1 addresses are valid even if isOnCurve returns false
            return true;
          } catch {
            return false;
          }
        });

      if (onCurveHolders.length === 0) {
        setStatus('No active holders found. Is the mint address correct?');
        setHolders([]);
        return;
      }

      // Respect the user's estimated holder count as a hard cap
      const userCap = estimatedHolders > 0 ? estimatedHolders : MAX_HOLDERS;
      const cap = Math.min(userCap, MAX_HOLDERS);
      const truncated = onCurveHolders.length > cap;
      const finalHolders = onCurveHolders.slice(0, cap);
      setHolders(finalHolders);
      setRemainingHolders(finalHolders);
      setStatus(
        truncated
          ? `Found ${onCurveHolders.length.toLocaleString()} holders — sending to first ${cap.toLocaleString()} as estimated.`
          : `Found ${finalHolders.length} active holders.`
      );
      setActiveStep(2);
    } catch (error: any) {
      console.error('Holder fetch error:', error);
      setStatus(`Error during scan: ${error?.message || 'Network timeout'}`);
    }
  };

  // ── Airdrop execution ────────────────────────────────────────────────────────
  const handleAirdrop = async () => {
    if (isProcessing) return; // Guard against double-trigger
    if (!wallet || !selectedToken) return alert('Select an asset first');

    const requiredTotal = parseFloat(dropAmount) * holders.length;
    if (requiredTotal > selectedToken.balance) return alert('Insufficient balance!');

    setIsProcessing(true);
    setBatchProgress(0);
    setAirdropComplete(false);
    setTxLog([]);
    setStatus('Preparing batches... Please do not close the window.');

    // Work on a stable copy of the list for this run
    let remaining = [...holders];
    const totalHolders = remaining.length;
    const totalBatches = Math.ceil(totalHolders / CHUNK_SIZE);
    let batchIndex = 0;
    const sessionLog: TxRecord[] = [];
    const sessionPdaSkips: PdaSkipRecord[] = [];
    setPdaSkipLog([]);

    try {
      // Process one chunk at a time using while + slice(0, CHUNK_SIZE)
      // so advancing the list doesn't interfere with the loop counter
      while (remaining.length > 0) {
        const chunk = remaining.slice(0, CHUNK_SIZE);
        batchIndex++;
        const batchLabel = `${batchIndex} of ${totalBatches}`;

        const result = await executeBatchedAirdrop(
          connection,
          wallet,
          sendTransaction,
          selectedToken.mint,
          selectedToken.decimals,
          dropAmount,
          chunk,
          setStatus,
          batchLabel
        );

        // Only record batches that actually sent — skip nulls / empty / malformed results
        const sentCount = result?.recipientsSent?.length ?? 0;
        if (sentCount === 0) {
          // No tokens were sent — log as PDA-skipped batch (user not charged)
          const skippedAddresses: string[] = result?.recipientsSkipped ?? chunk;
          const pdaRecord: PdaSkipRecord = { batch: batchIndex, addresses: skippedAddresses };
          sessionPdaSkips.push(pdaRecord);
          setPdaSkipLog([...sessionPdaSkips]);
        } else if (sentCount > 0) {
          const record: TxRecord = {
            batch: batchIndex,
            timestamp: new Date().toISOString(),
            amountPerRecipient: parseFloat(dropAmount),
            symbol: selectedToken.symbol,
            mint: selectedToken.mint,
            network,
            result,
          };
          sessionLog.push(record);
          setTxLog([...sessionLog]);
        }

        // Advance the remaining list
        remaining = remaining.slice(CHUNK_SIZE);
        setHolders(remaining);
        setRemainingHolders(remaining);

        // Persist progress so the user can resume if the browser closes
        if (remaining.length > 0) {
          localStorage.setItem(
            `xender_remaining_${validatedMintString}`,
            JSON.stringify({ remaining })
          );
        }

        // Update progress bar
        const processed = totalHolders - remaining.length;
        setBatchProgress(Math.round((processed / totalHolders) * 100));

        // Brief pause between batches to avoid rate-limiting
        if (remaining.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      setBatchProgress(100);
      setIsResuming(false);
      localStorage.removeItem(`xender_remaining_${validatedMintString}`);
      setTimeout(() => setBatchProgress(null), 4000);
      // Set complete AFTER all state is stable
      setAirdropComplete(true);
      setStatus('Airdrop complete! All holders processed.');

    } catch (error: any) {
      console.error('Airdrop batch error:', error);
      setBatchProgress(null);
      const errMsg = error?.message || error?.toString() || JSON.stringify(error) || 'Unknown error';
      setStatus(`Batch failed: ${errMsg}. ${remaining.length} holders remaining.`);
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className={`${styles.matrixBg} relative z-0 min-h-screen flex flex-col items-center p-4 md:p-8`}>
      <MatrixRain />
      <div className={styles.scanlines}></div>

      <div className={`relative w-full max-w-lg ${styles.neonContainer} pb-4 z-10 mt-8`}>

        {/* Network selector */}
        <div className="absolute top-4 left-4 z-20">
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as 'mainnet' | 'testnet')}
            className="bg-black text-[#00aa22] border border-[#004400] text-[10px] font-mono p-1 outline-none cursor-pointer hover:border-[#00ff41] hover:text-[#00ff41] transition-colors uppercase tracking-widest focus:border-[#00ff41]"
          >
            <option value="mainnet">X1 MAINNET</option>
            <option value="testnet">X1 TESTNET</option>
          </select>
        </div>

        {/* Author tag */}
        <div className="absolute top-4 right-4 text-[10px] text-[#00aa22] font-mono tracking-widest z-20">
          // by{' '}
          <a
            href="https://t.me/ironmanmk2"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#00ff41] hover:bg-[#00ff41] hover:text-black px-1 transition-all border border-transparent hover:border-[#00ff41] font-bold"
          >
            tony
          </a>
        </div>

        {/* Header */}
        <div className="p-6 text-center relative">
          <h1 className={`text-4xl font-black tracking-widest ${styles.glowText} mx-auto`}>RX1N</h1>
          <p className="text-xs text-[#00aa22] mt-2 font-bold tracking-[0.3em]">FETCH & DROP PROTOCOL</p>
          <div className="flex items-center justify-center gap-4 mt-5">
            <a href="https://x1nerator.xyz" target="_blank" rel="noopener noreferrer" className="text-[#00ff41] hover:underline text-xs font-bold">🔥 Burn</a>
            <span className="text-[#003300]">|</span>
            <a href="https://github.com/badnob" target="_blank" rel="noopener noreferrer" className="text-[#00ff41] hover:underline text-xs font-bold">⚡ Git</a>
            <span className="text-[#003300]">|</span>
            <a href="https://t.me/rx1ndrop" target="_blank" rel="noopener noreferrer" className="text-[#00ff41] hover:underline text-xs font-bold">✈️ Gram</a>
          </div>
        </div>

        <div className="px-5 pt-0 space-y-5">

          {/* Wallet connection */}
          <div className="flex flex-col items-center mb-6 p-4 border border-[#004400] bg-black shadow-inner">
            <ConnectButtons />
            {wallet && (
              <div className="mt-4 px-4 py-2 border border-[#00ff41] bg-[#001100] text-xs font-mono text-[#00ff41] flex items-center gap-3 shadow-[0_0_10px_rgba(0,255,65,0.2)]">
                <span className="w-2 h-2 bg-[#00ff41] animate-pulse"></span>
                SYS_ADMIN: {wallet.toBase58().slice(0, 6)}...{wallet.toBase58().slice(-4)}
              </div>
            )}
          </div>

          {/* ── COST CALCULATOR ── */}
          {!costLocked && (
            <div className="mb-12 p-6 border border-[#004400] bg-black/80 backdrop-blur-sm shadow-[0_0_15px_rgba(0,255,65,0.15)]">
              <h2 className="text-xl font-black text-[#00ff41] mb-4 tracking-widest">
                &gt; RECIPIENTS & COST
              </h2>

              <input
                type="number"
                min="1"
                value={estimatedHolders || ''}
                onChange={(e) =>
                  setEstimatedHolders(Math.max(0, parseInt(e.target.value) || 0))
                }
                placeholder="max number of recipients to send to"
                className="w-full bg-[#000a00] border border-[#004400] p-4 text-[#00ff41] font-mono focus:border-[#00ff41] mb-6"
              />

              {estimatedHolders > 0 && (
                <div className="bg-[#000500] p-5 border border-[#003300] text-sm space-y-2">
                  <div className="flex justify-between">
                    <span>Batches:</span>
                    <span className="text-[#00ff41]">{batchCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Dev fee:</span>
                    <span className="text-[#00ff41]">{devFeeTotalXNT} XNT</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Network est:</span>
                    <span className="text-[#00ff41]">≈ {estimatedNetworkFeesSOL} XNT</span>
                  </div>
                  <div className="flex justify-between">
                    <span>ATA worst-case deposit:</span>
                    <span className="text-[#00ff41]">{worstCaseAtaRentSOL} XNT</span>
                  </div>
                  <div className="flex justify-between font-bold text-[#00ff41] pt-2 border-t border-[#003300]">
                    <span>Typical total:</span>
                    <span>
                      ≈{totalTypicalSOL} XNT
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={() => (estimatedHolders >= 1 ? setShowDisclaimerModal(true) : null)}
                disabled={estimatedHolders < 1}
                className={`w-full mt-6 p-4 font-black ${styles.neonButton} ${
                  estimatedHolders < 1 ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                LOCK IN ESTIMATE & CONTINUE
              </button>
            </div>
          )}

          {/* ── DISCLAIMER MODAL ── */}
          {showDisclaimerModal && (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 backdrop-blur-md">
              <div className="bg-[#000a00] border-2 border-[#00ff41] p-8 max-w-lg w-11/12 shadow-[0_0_30px_rgba(0,255,65,0.4)] text-center font-mono">
                <h3 className="text-2xl font-black text-[#00ff41] mb-6 tracking-widest">
                  RESOURCE NOTICE
                </h3>
                <div className="text-sm text-[#00cc33] mb-8 leading-relaxed">
                  Fetching the actual holder list requires multiple RPC queries to the X1 blockchain.
                  <br />
                  <br />
                  This consumes network resources and may take several seconds to minutes.
                  <br />
                  <br />
                  Only proceed if acceptable.
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => {
                      setShowDisclaimerModal(false);
                      setCostLocked(true);
                    }}
                    className={`flex-1 py-4 font-black ${styles.neonButton}`}
                  >
                    I UNDERSTAND & PROCEED
                  </button>
                  <button
                    onClick={() => setShowDisclaimerModal(false)}
                    className="flex-1 py-4 border border-red-700 text-red-400 hover:bg-red-950 font-bold"
                  >
                    CANCEL / CHANGE ESTIMATE
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── STEPS ── */}
          {costLocked && (
            <div className="px-5 pt-5 space-y-5">

              {/* Step 1 — Target audience */}
              <div className={`${activeStep === 1 ? styles.stepWrapperActive : styles.stepWrapper} ${activeStep === 1 ? '' : 'overflow-hidden'}`}>
                <button
                  onClick={() => setActiveStep(activeStep === 1 ? 0 : 1)}
                  className="w-full p-4 text-left font-bold flex justify-between items-center hover:bg-[#001100] transition-colors text-[#00ff41] uppercase tracking-wider text-sm"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-6 h-6 bg-[#00ff41] text-black font-black">
                      1
                    </span>
                    Target_Audience
                    {holders.length > 0 && (
                      <span className="text-[#00aa22] ml-2">[{holders.length}]</span>
                    )}
                  </span>
                  <span className="text-[#004400]">{activeStep === 1 ? '[-]' : '[+]'}</span>
                </button>

                {activeStep === 1 && (
                  <div className="p-4 pt-0 space-y-4">
                    <p className="text-xs text-[#00aa22] font-mono tracking-widest uppercase">Fetch holders</p>
                    <input
                      type="text"
                      placeholder="Enter token address here"
                      className={`w-full p-3 ${styles.neonInput}`}
                      value={sourceMint}
                      onChange={(e) => setSourceMint(e.target.value)}
                    />
                    <TokenCard meta={sourceMeta} />
                    <button
                      onClick={fetchHolders}
                      disabled={!isValidMint}
                      className={`w-full p-3 font-bold ${styles.neonButton} ${
                        !isValidMint ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      EXECUTE_SCAN()
                    </button>
                  </div>
                )}
              </div>

              {/* Step 2 — Payload config */}
              <div className={`${activeStep === 2 ? styles.stepWrapperActive : styles.stepWrapper} ${activeStep === 2 ? '' : 'overflow-hidden'}`}>
                <button
                  onClick={() => setActiveStep(activeStep === 2 ? 0 : 2)}
                  className="w-full p-4 text-left font-bold flex justify-between items-center hover:bg-[#001100] transition-colors text-[#00ff41] uppercase tracking-wider text-sm"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-6 h-6 bg-[#00ff41] text-black font-black">
                      2
                    </span>
                    Payload_Config
                  </span>
                  <span className="text-[#004400]">{activeStep === 2 ? '[-]' : '[+]'}</span>
                </button>

                {activeStep === 2 && (
                  <div className="p-4 pt-0 space-y-4">
                    <p className="text-xs text-[#00aa22] font-mono tracking-widest uppercase">Distribute token select</p>
                    <div className="flex border border-[#004400]">
                      <button
                        onClick={() => setAssetType('token')}
                        className={`flex-1 py-2 text-xs font-bold transition-all uppercase tracking-widest ${
                          assetType === 'token' ? 'bg-[#00ff41] text-black' : 'text-[#00aa22] hover:bg-[#001100]'
                        }`}
                      >
                        Fungible
                      </button>
                      <button
                        onClick={() => setAssetType('nft')}
                        className={`flex-1 py-2 text-xs font-bold transition-all uppercase tracking-widest ${
                          assetType === 'nft' ? 'bg-[#00ff41] text-black' : 'text-[#00aa22] hover:bg-[#001100]'
                        }`}
                      >
                        NFTs
                      </button>
                    </div>

                    <div className="relative">
                      {wallet ? (
                        isLoadingTokens ? (
                          <div className="p-4 bg-black border border-[#004400] text-sm text-center text-[#00aa22] animate-pulse">
                            &gt; QUERYING_LEDGER...
                          </div>
                        ) : (
                          <TokenSelect
                            tokens={walletTokens}
                            selected={selectedToken}
                            onChange={setSelectedToken}
                            filterType={assetType}
                          />
                        )
                      ) : (
                        <div className="p-3 bg-black text-sm text-center text-red-500 border border-red-900 font-bold uppercase tracking-widest">
                          ERR: NO_CONNECTION
                        </div>
                      )}
                    </div>

                    {selectedToken && (
                      <div className="pt-2">
                        <input
                          type="number"
                          placeholder={assetType === 'nft' ? '> ALLOC: 1' : '> ENTER_DROP_AMOUNT...'}
                          className={`w-full p-3 ${styles.neonInput}`}
                          value={dropAmount}
                          onChange={(e) => setDropAmount(e.target.value)}
                          disabled={assetType === 'nft'}
                        />
                        <button
                          onClick={() => setActiveStep(3)}
                          disabled={!selectedToken || !dropAmount}
                          className={`w-full mt-4 p-3 font-bold ${styles.neonButton}`}
                        >
                          LOCK_PAYLOAD()
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step 3 — Deploy drop */}
              <div className={`${activeStep === 3 ? styles.stepWrapperActive : styles.stepWrapper} ${activeStep === 3 ? '' : 'overflow-hidden'}`}>
                <button
                  onClick={() => setActiveStep(activeStep === 3 ? 0 : 3)}
                  className="w-full p-4 text-left font-bold flex justify-between items-center hover:bg-[#001100] transition-colors text-[#00ff41] uppercase tracking-wider text-sm"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-6 h-6 bg-[#00ff41] text-black font-black">
                      3
                    </span>
                    Deploy_Drop
                  </span>
                  <span className="text-[#004400]">{activeStep === 3 ? '[-]' : '[+]'}</span>
                </button>

                {activeStep === 3 && (
                  <div className="p-4 pt-0 space-y-4">
                    {/* Summary */}
                    <div className="text-sm bg-black p-4 space-y-3 border border-[#004400]">
                      <div className="flex justify-between items-center border-b border-[#003300] pb-2 text-[#00aa22]">
                        <span>RECIPIENTS:</span>
                        <span className="font-bold text-[#00ff41]">{holders.length}</span>
                      </div>
                      <div className="flex justify-between items-center border-b border-[#003300] pb-2 text-[#00aa22]">
                        <span>SEND_QTY:</span>
                        <span className="font-bold text-[#00ff41]">
                          {dropAmount || 0} {selectedToken?.symbol}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pt-1 font-bold text-[#00ff41]">
                        <span>TOTAL_DEDUCTION:</span>
                        <span>
                          {((parseFloat(dropAmount) || 0) * holders.length).toLocaleString()}{' '}
                          {selectedToken?.symbol}
                        </span>
                      </div>
                    </div>

                    {/* Warning */}
                    <div className="text-xs text-[#ffaa00] border border-[#ffaa00] p-3 bg-black space-y-1.5">
                      <div className="font-black tracking-widest mb-2">TIPS</div>
                      <div>_&gt; Enable auto-sign to avoid manual interaction for every batch if you require sending to large amount of holders.</div>
                      <div>_&gt; Disable auto-lock to avoid wallet from idling mid-airdrop.</div>
                    </div>

                    {/* Progress bar */}
                    {batchProgress !== null && (
                      <div className="mt-4 border border-[#004400] bg-black p-1">
                        <div
                          className="bg-[#00ff41] h-2 transition-all duration-500 ease-out relative overflow-hidden"
                          style={{ width: `${batchProgress}%` }}
                        >
                          <div className="absolute inset-0 bg-white/30 animate-[pulse_1s_infinite]"></div>
                        </div>
                      </div>
                    )}

                    {/* Primary action button */}
                    <button
                      onClick={() => {
                        if (airdropComplete) {
                          // Trigger the export download directly
                          document.getElementById('rx1n-export-btn')?.click();
                        } else {
                          handleAirdrop();
                        }
                      }}
                      disabled={isProcessing}
                      className={`w-full mt-4 p-4 font-black ${styles.neonButton} !text-lg ${
                        isProcessing
                          ? 'opacity-50 cursor-wait'
                          : '!shadow-[0_0_15px_#00ff41] hover:!bg-[#00ff41] hover:!text-black'
                      }`}
                    >
                      {isProcessing
                        ? 'PROCESSING...'
                        : airdropComplete
                        ? 'DWNLD_RCPT'
                        : remainingHolders.length > 0 && isResuming
                        ? 'KEEP_RX1NING'
                        : 'MAKE_IT_RX1N'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Status bar */}
        {status && (
          <div className="m-5 mt-2 p-3 bg-black text-xs text-[#00ff41] font-mono border border-[#00ff41] break-words flex items-start gap-2 shadow-[0_0_8px_rgba(0,255,65,0.3)]">
            <span className="mt-0.5 animate-pulse">_&gt;</span>
            <span>{status}</span>
          </div>
        )}

        {/* Export button — shown after airdrop completes (even if all batches were PDA-skipped) */}
        {airdropComplete && (txLog.length > 0 || pdaSkipLog.length > 0) && (
          <div className="mx-5 mb-5">
            <button
              onClick={() => {
                const report = {
                  title: 'RX1NDROP REPORT',
                  generated: new Date().toUTCString(),
                  batches: txLog.map((r) => ({
                    batch: r.batch,
                    txn_hash: r.result?.signature ?? '',
                    explorer: `https://explorer.${network === 'testnet' ? 'testnet' : 'mainnet'}.x1.xyz/tx/${r.result?.signature ?? ''}`,
                    recipients: (r.result?.recipientsSent ?? []).map((addr, i) => ({
                      [`wallet_${i + 1}`]: addr,
                    })),
                    fees: {
                      network_fee: `${r.result?.networkFeeXNT ?? 0} XNT  — paid to validators`,
                      dev_fee: `${r.result?.devFeeXNT ?? 0} XNT  — paid to RX1N`,
                      ata_rent: `${r.result?.ataRentXNT ?? 0} XNT  — new token accounts opened`,
                      batch_total: `${r.result?.totalXNTSpent ?? 0} XNT`,
                    },
                  })),
                  totals: {
                    network_fees: `${parseFloat(txLog.reduce((s, r) => s + (r.result?.networkFeeXNT ?? 0), 0).toFixed(9))} XNT`,
                    dev_fees: `${parseFloat(txLog.reduce((s, r) => s + (r.result?.devFeeXNT ?? 0), 0).toFixed(9))} XNT`,
                    ata_rent: `${parseFloat(txLog.reduce((s, r) => s + (r.result?.ataRentXNT ?? 0), 0).toFixed(9))} XNT`,
                    total_spent: `${parseFloat(txLog.reduce((s, r) => s + (r.result?.totalXNTSpent ?? 0), 0).toFixed(9))} XNT`,
                    total_recipients: txLog.reduce((s, r) => s + (r.result?.recipientsSent?.length ?? 0), 0),
                    total_batches: txLog.length,
                  },
                };

                const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `rx1n-airdrop-${Date.now()}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              id="rx1n-export-btn"
              className="hidden"
            >
              ⬇ EXPORT_TRANSACTION_LOG()
            </button>
            {txLog.length > 0 && (
              <p className="text-[10px] text-[#00aa22] font-mono text-center mt-2 tracking-widest">
                {txLog.length} BATCHES
                &nbsp;·&nbsp;{txLog.reduce((s, r) => s + (r.result?.recipientsSent?.length ?? 0), 0)} SENT
                &nbsp;·&nbsp;{txLog.reduce((s, r) => s + (r.result?.totalXNTSpent ?? 0), 0).toFixed(6)} XNT TOTAL COST
              </p>
            )}
            {pdaSkipLog.length > 0 && (
              <p className="text-[10px] text-[#ffaa00] font-mono text-center mt-1 tracking-widest">
                ⚠ {pdaSkipLog.reduce((s, r) => s + r.addresses.length, 0)} PDA ADDRESS
                {pdaSkipLog.reduce((s, r) => s + r.addresses.length, 0) !== 1 ? 'ES' : ''} SKIPPED
                &nbsp;·&nbsp;NOT CHARGED
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
