# Stonklet trading contract verification

Checked 2026-09-06. All 44 stock-side addresses were checked against the sources below and independently queried with `eth_call` (`symbol()`) on BNB mainnet, chain ID 56. Every symbol matched; the XAUT row uses the official bridged XAUT0 deployment. No transactions were submitted.

Trading uses this reviewed allowlist rather than provider-supplied contracts. Unknown symbols have no trade link. All FOMO links use `https://fomo.family/tokens/bnb/<address>?r=10XMemeX`.

Bull temporarily trades MarsCoin at `0xfe189e97832da1573e4e4ff034f4ffc3a15c7777`; Bear temporarily trades `0x90f62f81307ebf4ccd0a0510e3391c67b1d17777`, as explicitly requested. These are separate from official Stonklet contracts.

| Stock symbol | BNB contract | Verification source |
| --- | --- | --- |
| SPCXB | `0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1` | [Source](https://www.binance.com/en/square/post/333368590019938) |
| SKHYB | `0xca750ef65f295bbecd685abf54e82caf297bdb61` | [Source](https://www.binance.com/ar/square/post/344221350329041) |
| SPYB | `0x7138b48df7d98d7e3cc221bfe7192d0a178182d8` | [Source](https://www.binance.com/en/support/announcement/detail/6a55706a042c4a7ebedc2a0899744088) |
| XAUT | `0x21caef8a43163eea865baee23b9c2e327696a3bf` | [Source](https://usdt0.to/ecosystem/bnb-chain) |
| QQQB | `0x205812cdbed920aff76c6580abd681a46d11efc7` | [Source](https://www.binance.com/en/support/announcement/detail/03b264b679a646119d1a2415b9097bd6) |
| NVDAB | `0x02fca66c1d1afb4e2a7884261eb00f63598a7436` | [Source](https://www.binance.com/es/support/announcement/detail/5646e3f9ea6b4c989cb76aa18bd99245) |
| AAPLB | `0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a` | [Source](https://www.binance.com/en-AU/support/announcement/detail/fd3c0f17a7504eb5be1cb1911c6da0cd) |
| TSLAB | `0x5b1910eaad6450e50f816082aa078c41f10c292f` | [Source](https://www.binance.com/es/support/announcement/detail/5646e3f9ea6b4c989cb76aa18bd99245) |
| MSFTB | `0x80106cb3ead06659a5ad19df39d9b4733863b9b0` | [Source](https://www.binance.com/en/support/announcement/detail/03b264b679a646119d1a2415b9097bd6) |
| GOOGLB | `0x3f53de71c126bdabae20f9cd64848d317f6c3238` | [Source](https://www.binance.com/en/support/announcement/detail/6a55706a042c4a7ebedc2a0899744088) |
| HOODB | `0xa394dcea3fd3847fd793afbfd163e2e3858b7c65` | [Source](https://www.binance.com/en-AU/support/announcement/detail/f198d9602f3b4604a9b15cd0a1529e32) |
| BABAB | `0x4ef9d3062c7f6eba4aae4990c5036598c6eff4ec` | [Source](https://www.binance.com/en-AU/support/announcement/detail/f198d9602f3b4604a9b15cd0a1529e32) |
| GMEB | `0x46ceefda28dd7207059ed19b0acdc026955bb15c` | [Source](https://www.binance.com/en/support/announcement/detail/3f884f8f195a419eb855510d203def2a) |
| NFLXB | `0xd6829ea836b6fa224d099d40e54b31262f874631` | [Source](https://www.binance.com/ru/support/announcement/detail/ae96da838d754f91bced1501de728f03) |
| MSTRB | `0xe87afb3076aeb0f9b14e368de8145ae6a2826a14` | [Source](https://www.binance.com/en/square/post/337121793918450) |
| DJTB | `0xf2ec508422174ee564de98187db9359d318afb6b` | [Source](https://www.hotcoin.com/ja_JP/support/notice/HotcoinWillListTrumpMediaTechnologyGroupCorpDJTBforSpotTrading/) |
| BMNRB | `0x3548da95a9effe481e8604664d75e95821e557f5` | [Source](https://www.binance.com/ru/support/announcement/detail/ae96da838d754f91bced1501de728f03) |
| SMCIB | `0x387dea1d2772d716d081a29116f3effa0ffe1f36` | [Source](https://www.binance.com/ru/support/announcement/detail/ae96da838d754f91bced1501de728f03) |
| IRENB | `0xfdc2f2cab77b28f7ef6c819a404706cfa9bca33b` | [Source](https://www.binance.com/ru/support/announcement/detail/ae96da838d754f91bced1501de728f03) |
| ASMLB | `0xfbfb4f79cfb4c34dcd7c82bdee5a0fa199b2e7f9` | [Source](https://www.binance.com/ru/support/announcement/detail/ae96da838d754f91bced1501de728f03) |
| ASTSB | `0x58b6f5feeb8436489f5bf4a56619092b1fa8e777` | [Source](https://www.binance.com/ru/support/announcement/detail/ae96da838d754f91bced1501de728f03) |
| COHRB | `0x5131859a059b2446abeefe0f5d313b3c54ff3d36` | [Source](https://www.binance.com/ru/support/announcement/detail/ae96da838d754f91bced1501de728f03) |
| CRDOB | `0x6e7d451f9d30327d32020f116fa79c23b24e9c8d` | [Source](https://www.binance.com/ru/support/announcement/detail/ae96da838d754f91bced1501de728f03) |
| USARB | `0xcd345d4450e04cdef422a60b97d9265d24e0bcee` | [Source](https://www.binance.com/ru/support/announcement/detail/ae96da838d754f91bced1501de728f03) |
| ALABB | `0x1282493ede6a22753d45cb2c0fdbd8d35e97555a` | [Source](https://www.binance.com/ru/support/announcement/detail/ae96da838d754f91bced1501de728f03) |
| CRCLB | `0x80f3d493ebce97e343c53d29a137942416b4ffc0` | [Source](https://www.binance.com/es/support/announcement/detail/5646e3f9ea6b4c989cb76aa18bd99245) |
| MUB | `0xcdf2f3e0fa43c47a6662a91c9e4a7c5f69762699` | [Source](https://www.binance.com/es/support/announcement/detail/5646e3f9ea6b4c989cb76aa18bd99245) |
| SNDKB | `0x3ee4df61bd4f867e349beae8bfe07bc31b4850fb` | [Source](https://www.binance.com/es/support/announcement/detail/5646e3f9ea6b4c989cb76aa18bd99245) |
| AMDB | `0x75fd4cf6f8392e41e70391d60c90c0d5211603a1` | [Source](https://www.binance.com/en/square/post/337121793918450) |
| EWYB | `0xbe82f76637dba2c114c41df856c2c51e522e2cb8` | [Source](https://www.binance.com/en/square/post/337121793918450) |
| INTCB | `0xe614e2fc6c787035ff51f452e8e826bfd32d5283` | [Source](https://www.binance.com/en/square/post/337121793918450) |
| LITEB | `0x64748bea17b6d19e242adf20425de2440c656142` | [Source](https://www.binance.com/en/support/announcement/detail/03b264b679a646119d1a2415b9097bd6) |
| METAB | `0x7425889fe94f9d693e8daefe88bcced6acfef4c0` | [Source](https://www.binance.com/en/support/announcement/detail/03b264b679a646119d1a2415b9097bd6) |
| PLTRB | `0x0ca5d51d0277bd006fd9607d3e560785ebad8222` | [Source](https://www.binance.com/en/support/announcement/detail/03b264b679a646119d1a2415b9097bd6) |
| BEB | `0x5519de00f5388c17d886b97cb5d2d43a812a82bc` | [Source](https://www.binance.com/en-AU/support/announcement/detail/fd3c0f17a7504eb5be1cb1911c6da0cd) |
| AMZNB | `0x1a4b499833a79a09ad7cf1d42d7dacf71e92eb00` | [Source](https://www.binance.com/en-AU/support/announcement/detail/fd3c0f17a7504eb5be1cb1911c6da0cd) |
| SOXSB | `0xe28cd11c99af2df76bb8ada4cd0ef3904378280f` | [Source](https://www.binance.com/en-AU/support/announcement/detail/fd3c0f17a7504eb5be1cb1911c6da0cd) |
| DELLB | `0x0e7a51966c66648999d506e1372efdea1b78cb0b` | [Source](https://www.binance.com/en-AU/support/announcement/detail/fd3c0f17a7504eb5be1cb1911c6da0cd) |
| FLNCB | `0x4af1d41cd9dd950dca43984b43aaa2a8702714ac` | [Source](https://www.binance.com/en-AU/support/announcement/detail/fd3c0f17a7504eb5be1cb1911c6da0cd) |
| AMATB | `0xa304bd78e739c0f777202b3eb73ac3736d1df801` | [Source](https://www.binance.com/en-AU/support/announcement/detail/fd3c0f17a7504eb5be1cb1911c6da0cd) |
| SOXLB | `0xd97d097a89113fa59b76c572e5b2eb647e8eefaf` | [Source](https://www.binance.com/en/support/announcement/detail/6a55706a042c4a7ebedc2a0899744088) |
| MRNAB | `0x5fd86da9b05abe396fe9d02a4a213a7c00556503` | [Source](https://www.binance.com/es-MX/support/announcement/detail/b3ba5cf68daf4264a1260c8da11eef6d) |
| PYPLB | `0x2806a561fc1f9259b2d54a281796bde0d92762ae` | [Source](https://www.binance.com/en-AU/support/announcement/detail/fd3c0f17a7504eb5be1cb1911c6da0cd) |
| SQQQB | `0x25e572b466d152604d9e6c3e53b432b978825342` | [Source](https://www.binance.com/es-MX/support/announcement/detail/b3ba5cf68daf4264a1260c8da11eef6d) |

