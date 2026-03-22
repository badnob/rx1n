import React, { Fragment } from 'react';
import { Listbox, Transition } from '@headlessui/react';
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid';
import { TokenData } from '../lib/x1-api';

export default function TokenSelect({ tokens, selected, onChange, filterType }: { tokens: TokenData[], selected: TokenData | null, onChange: (t: TokenData) => void, filterType: 'token' | 'nft' }) {
  const filteredTokens = tokens.filter(t => filterType === 'nft' ? t.decimals === 0 : t.decimals > 0);

  return (
    <Listbox value={selected} onChange={onChange}>
      <div className="relative mt-1 z-[100] font-mono">
        <Listbox.Button className="relative w-full cursor-pointer bg-[#000a00] py-3 pl-3 pr-10 text-left border border-[#004400] focus:outline-none focus:border-[#00ff41] shadow-[0_0_8px_rgba(0,255,65,0.2)] transition-all hover:border-[#00aa22]">
          {selected ? (
            <span className="flex items-center truncate">
              {selected.logo ? (
                <img src={selected.logo} alt="" className="h-6 w-6 flex-shrink-0 mr-3 border border-[#00ff41]" />
              ) : (
                <div className={`h-6 w-6 flex-shrink-0 mr-3 border border-[#00ff41] flex items-center justify-center text-[10px] font-bold text-[#00ff41] bg-black`}>
                  {filterType === 'nft' ? 'NFT' : selected.symbol.charAt(0)}
                </div>
              )}
              <span className="truncate font-bold text-[#00ff41]">{selected.name}</span>
              <span className="ml-auto text-[#00aa22] text-xs pl-2">BAL: {selected.balance.toLocaleString()}</span>
            </span>
          ) : (
            <span className="block truncate text-[#004400] font-bold">SELECT_ASSET()</span>
          )}
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon className="h-5 w-5 text-[#00ff41]" aria-hidden="true" />
          </span>
        </Listbox.Button>

        <Transition as={Fragment} leave="transition ease-in duration-100" leaveFrom="opacity-100" leaveTo="opacity-0">
          <Listbox.Options className="absolute mt-1 max-h-60 w-full overflow-auto bg-[#000500] py-1 shadow-[0_0_15px_rgba(0,255,65,0.3)] border border-[#00ff41] focus:outline-none z-[100]">
            {filteredTokens.length === 0 ? (
              <div className="px-4 py-3 text-sm text-[#004400] text-center italic">NULL_RECORDS_FOUND</div>
            ) : (
              filteredTokens.map((token) => (
                <Listbox.Option key={token.mint} className={({ active }) => `relative cursor-pointer select-none py-2.5 pl-10 pr-4 transition-colors ${active ? 'bg-[#003300] text-[#00ff41]' : 'text-[#00aa22]'}`} value={token}>
                  {({ selected }) => (
                    <>
                      <div className="flex items-center">
                        {token.logo ? (
                          <img src={token.logo} alt="" className="h-6 w-6 flex-shrink-0 mr-3 border border-[#004400]" />
                        ) : (
                          <div className="h-6 w-6 flex-shrink-0 mr-3 border border-[#004400] bg-black flex items-center justify-center text-[10px] font-bold">{filterType === 'nft' ? 'NFT' : token.symbol.charAt(0)}</div>
                        )}
                        <span className={`block truncate ${selected ? 'font-bold text-[#00ff41]' : 'font-normal'}`}>{token.name}</span>
                        <span className="ml-auto text-xs font-mono">{filterType === 'nft' ? `x${token.balance}` : token.balance.toLocaleString()}</span>
                      </div>
                      {selected && <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-[#00ff41]"><CheckIcon className="h-5 w-5" aria-hidden="true" /></span>}
                    </>
                  )}
                </Listbox.Option>
              ))
            )}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}
