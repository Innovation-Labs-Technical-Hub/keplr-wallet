import React, { FunctionComponent, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { useStore } from "../../../stores";
import { RegisterSceneBox } from "../components/register-scene-box";
import { Stack } from "../../../components/stack";
import { useRegisterHeader } from "../components/header";
import {
  useSceneEvents,
  useSceneTransition,
} from "../../../components/transition";
import { ChainInfo } from "@keplr-wallet/types";
import { CoinPretty } from "@keplr-wallet/unit";
import { Box } from "../../../components/box";
import { Column, Columns } from "../../../components/column";
import { XAxis, YAxis } from "../../../components/axis";
import { Gutter } from "../../../components/gutter";
import { SearchTextInput } from "../../../components/input";
import { Subtitle3 } from "../../../components/typography";
import { Button } from "../../../components/button";
import { ColorPalette } from "../../../styles";
import { useEffectOnce } from "../../../hooks/use-effect-once";
import { useNavigate } from "react-router";
import { ChainImageFallback } from "../../../components/image";
import { Checkbox } from "../../../components/checkbox";
import { KeyRingCosmosService } from "@keplr-wallet/background";
import { WalletStatus } from "@keplr-wallet/stores";
import { useFocusOnMount } from "../../../hooks/use-focus-on-mount";

export const EnableChainsScene: FunctionComponent<{
  vaultId: string;
  // finalize-key scene으로부터 온 경우에는 finalize-key scene이 미리 계산해서 전달해준다.
  // 아닌 경우는 이 scene에서 계산한다.
  // 또한 밑의 prop이 제공된 경우에만 automatic chain selection(?) 기능이 처리된다.
  candidateAddresses?: {
    chainId: string;
    bech32Addresses: {
      coinType: number;
      address: string;
    }[];
  }[];
  isFresh?: boolean;

  fallbackEthereumLedgerApp?: boolean;
}> = observer(
  ({
    vaultId,
    candidateAddresses: propCandiateAddresses,
    isFresh,
    fallbackEthereumLedgerApp,
  }) => {
    const { chainStore, accountStore, queriesStore, keyRingStore } = useStore();

    const navigate = useNavigate();

    const header = useRegisterHeader();
    useSceneEvents({
      onWillVisible: () => {
        header.setHeader({
          mode: "step",
          title: "Select Chains",
          paragraphs: ["Don’t worry, you can change your selections anytime."],
          stepCurrent: 3,
          stepTotal: 6,
        });
      },
    });

    const keyType = useMemo(() => {
      const keyInfo = keyRingStore.keyInfos.find(
        (keyInfo) => keyInfo.id === vaultId
      );
      if (!keyInfo) {
        throw new Error("KeyInfo not found");
      }

      return keyInfo.type;
    }, [keyRingStore.keyInfos, vaultId]);

    const [candidateAddresses, setCandidateAddresses] = useState<
      {
        chainId: string;
        bech32Addresses: {
          coinType: number;
          address: string;
        }[];
      }[]
    >(propCandiateAddresses ?? []);
    useEffectOnce(() => {
      if (candidateAddresses.length === 0) {
        (async () => {
          // TODO: 이거 뭔가 finalize-key scene이랑 공통 hook 쓸 수 잇게 하던가 함수를 공유해야할 듯...?
          const candidateAddresses: {
            chainId: string;
            bech32Addresses: {
              coinType: number;
              address: string;
            }[];
          }[] = [];

          const promises: Promise<unknown>[] = [];
          for (const chainInfo of chainStore.chainInfos) {
            if (
              keyType === "mnemonic" &&
              keyRingStore.needMnemonicKeyCoinTypeFinalize(vaultId, chainInfo)
            ) {
              promises.push(
                (async () => {
                  const res =
                    await keyRingStore.computeNotFinalizedMnemonicKeyAddresses(
                      vaultId,
                      chainInfo.chainId
                    );

                  candidateAddresses.push({
                    chainId: chainInfo.chainId,
                    bech32Addresses: res.map((res) => {
                      return {
                        coinType: res.coinType,
                        address: res.bech32Address,
                      };
                    }),
                  });
                })()
              );
            } else {
              const account = accountStore.getAccount(chainInfo.chainId);
              promises.push(
                (async () => {
                  if (account.walletStatus !== WalletStatus.Loaded) {
                    await account.init();
                  }

                  if (account.bech32Address) {
                    candidateAddresses.push({
                      chainId: chainInfo.chainId,
                      bech32Addresses: [
                        {
                          coinType: chainInfo.bip44.coinType,
                          address: account.bech32Address,
                        },
                      ],
                    });
                  }
                })()
              );
            }
          }

          await Promise.allSettled(promises);

          setCandidateAddresses(candidateAddresses);
        })();
      }
    });

    // Handle coin type selection.
    useEffect(() => {
      if (!isFresh && candidateAddresses.length > 0) {
        for (const candidateAddress of candidateAddresses) {
          const queries = queriesStore.get(candidateAddress.chainId);
          const chainInfo = chainStore.getChain(candidateAddress.chainId);

          if (
            keyRingStore.needMnemonicKeyCoinTypeFinalize(vaultId, chainInfo)
          ) {
            if (candidateAddress.bech32Addresses.length === 1) {
              // finalize-key scene을 통하지 않고도 이 scene으로 들어올 수 있는 경우가 있기 때문에...
              keyRingStore.finalizeMnemonicKeyCoinType(
                vaultId,
                candidateAddress.chainId,
                candidateAddress.bech32Addresses[0].coinType
              );
            }

            if (candidateAddress.bech32Addresses.length >= 2) {
              (async () => {
                const promises: Promise<unknown>[] = [];

                for (const bech32Address of candidateAddress.bech32Addresses) {
                  const queryAccount =
                    queries.cosmos.queryAccount.getQueryBech32Address(
                      bech32Address.address
                    );

                  promises.push(queryAccount.waitResponse());
                }

                await Promise.allSettled(promises);

                const mainAddress = candidateAddress.bech32Addresses.find(
                  (a) => a.coinType === chainInfo.bip44.coinType
                );
                const otherAddresses = candidateAddress.bech32Addresses.filter(
                  (a) => a.coinType !== chainInfo.bip44.coinType
                );

                let otherIsSelectable = false;
                if (mainAddress && otherAddresses.length > 0) {
                  for (const otherAddress of otherAddresses) {
                    const bech32Address = otherAddress.address;
                    const queryAccount =
                      queries.cosmos.queryAccount.getQueryBech32Address(
                        bech32Address
                      );

                    // Check that the account exist on chain.
                    // With stargate implementation, querying account fails with 404 status if account not exists.
                    // But, if account receives some native tokens, the account would be created and it may deserve to be chosen.
                    if (
                      queryAccount.response?.data &&
                      queryAccount.error == null
                    ) {
                      otherIsSelectable = true;
                      break;
                    }
                  }
                }

                if (!otherIsSelectable && mainAddress) {
                  console.log(
                    "Finalize mnemonic key coin type",
                    vaultId,
                    chainInfo.chainId,
                    mainAddress.coinType
                  );
                  keyRingStore.finalizeMnemonicKeyCoinType(
                    vaultId,
                    chainInfo.chainId,
                    mainAddress.coinType
                  );
                }
              })();
            }
          }
        }
      }
    }, [
      isFresh,
      candidateAddresses,
      vaultId,
      chainStore,
      queriesStore,
      keyRingStore,
    ]);

    const sceneTransition = useSceneTransition();

    const [enabledChainIdentifiers, setEnabledChainIdentifiers] = useState(
      () => {
        // We assume that the chain store can be already initialized.
        // See FinalizeKeyScene
        // However, if the chain store is not initialized, we should handle these case too.
        const enabledChainIdentifiers: string[] =
          chainStore.enabledChainIdentifiers;

        for (const candidateAddress of candidateAddresses) {
          const queries = queriesStore.get(candidateAddress.chainId);
          const chainInfo = chainStore.getChain(candidateAddress.chainId);

          // If the chain is already enabled, skip.
          if (chainStore.isEnabledChain(candidateAddress.chainId)) {
            continue;
          }

          // If the chain is not enabled, check that the account exists.
          // If the account exists, turn on the chain.
          for (const bech32Address of candidateAddress.bech32Addresses) {
            // Check that the account has some assets or delegations.
            // If so, enable it by default
            const queryBalance = queries.queryBalances.getQueryBech32Address(
              bech32Address.address
            ).stakable;

            if (queryBalance.response?.data) {
              // A bit tricky. The stake coin is currently only native, and in this case,
              // we can check whether the asset exists or not by checking the response.
              const data = queryBalance.response.data as any;
              if (
                data.balances &&
                Array.isArray(data.balances) &&
                data.balances.length > 0
              ) {
                enabledChainIdentifiers.push(chainInfo.chainIdentifier);
                break;
              }
            }

            const queryDelegations =
              queries.cosmos.queryDelegations.getQueryBech32Address(
                bech32Address.address
              );
            if (queryDelegations.delegationBalances.length > 0) {
              enabledChainIdentifiers.push(chainInfo.chainIdentifier);
              break;
            }
          }
        }

        return enabledChainIdentifiers;
      }
    );

    const enabledChainIdentifierMap = useMemo(() => {
      const map = new Map<string, boolean>();

      for (const enabledChainIdentifier of enabledChainIdentifiers) {
        map.set(enabledChainIdentifier, true);
      }

      return map;
    }, [enabledChainIdentifiers]);

    const searchRef = useFocusOnMount<HTMLInputElement>();

    const [search, setSearch] = useState<string>("");

    // 검색 뿐만 아니라 로직에 따른 선택할 수 있는 체인 목록을 가지고 있다.
    // 그러니까 로직을 파악해서 주의해서 사용해야함.
    const chainInfos = useMemo(() => {
      let chainInfos = chainStore.chainInfos.slice();

      if (keyType === "ledger") {
        chainInfos = chainInfos.filter((chainInfo) => {
          const isEthermintLike =
            chainInfo.bip44.coinType === 60 ||
            !!chainInfo.features?.includes("eth-address-gen") ||
            !!chainInfo.features?.includes("eth-key-sign");

          // Ledger일 경우 ethereum app을 바로 처리할 수 없다.
          // 이 경우 빼줘야한다.
          if (isEthermintLike && !fallbackEthereumLedgerApp) {
            return false;
          }

          // fallbackEthereumLedgerApp가 true이면 ethereum app이 필요없는 체인은 이전에 다 처리된 것이다.
          // 이게 true이면 ethereum app이 필요하고 가능한 체인만 남기면 된다.
          if (fallbackEthereumLedgerApp) {
            if (!isEthermintLike) {
              return false;
            }

            try {
              // 처리가능한 체인만 true를 반환한다.
              KeyRingCosmosService.throwErrorIfEthermintWithLedgerButNotSupported(
                chainInfo.chainId
              );
              return true;
            } catch {
              return false;
            }
          }

          return true;
        });
      }

      const trimSearch = search.trim();

      if (!trimSearch) {
        return chainInfos;
      } else {
        return chainInfos.filter((chainInfo) => {
          return (
            chainInfo.chainName
              .toLowerCase()
              .includes(trimSearch.toLowerCase()) ||
            chainInfo.stakeCurrency.coinDenom
              .toLowerCase()
              .includes(trimSearch.toLowerCase())
          );
        });
      }
    }, [chainStore.chainInfos, fallbackEthereumLedgerApp, keyType, search]);

    const numSelected = useMemo(() => {
      const chainInfoMap = new Map<string, ChainInfo>();
      for (const chanInfo of chainInfos) {
        chainInfoMap.set(chanInfo.chainIdentifier, chanInfo);
      }

      let numSelected = 0;
      for (const enabledChainIdentifier of enabledChainIdentifiers) {
        if (chainInfoMap.has(enabledChainIdentifier)) {
          numSelected++;
        }
      }
      return numSelected;
    }, [chainInfos, enabledChainIdentifiers]);

    return (
      <RegisterSceneBox>
        <SearchTextInput
          ref={searchRef}
          placeholder="Search networks"
          value={search}
          onChange={(e) => {
            e.preventDefault();

            setSearch(e.target.value);
          }}
        />
        <Gutter size="0.75rem" />
        <Subtitle3
          style={{
            textAlign: "center",
          }}
        >
          {numSelected} chain(s) selected
        </Subtitle3>
        <Gutter size="0.75rem" />
        <Box
          height="25.5rem"
          style={{
            overflowY: "scroll",
          }}
        >
          <Stack gutter="0.5rem">
            {chainInfos.map((chainInfo) => {
              const account = accountStore.getAccount(chainInfo.chainId);

              const queries = queriesStore.get(chainInfo.chainId);

              const balance = queries.queryBalances.getQueryBech32Address(
                account.bech32Address
              ).stakable.balance;

              const enabled =
                enabledChainIdentifierMap.get(chainInfo.chainIdentifier) ||
                false;

              // At least, one chain should be enabled.
              const blockInteraction =
                enabledChainIdentifiers.length <= 1 && enabled;

              return (
                <ChainItem
                  key={chainInfo.chainId}
                  chainInfo={chainInfo}
                  balance={balance}
                  enabled={enabled}
                  blockInteraction={blockInteraction}
                  isFresh={isFresh || account.bech32Address === ""}
                  onClick={() => {
                    if (
                      enabledChainIdentifierMap.get(chainInfo.chainIdentifier)
                    ) {
                      setEnabledChainIdentifiers(
                        enabledChainIdentifiers.filter(
                          (chainIdentifier) =>
                            chainIdentifier !== chainInfo.chainIdentifier
                        )
                      );
                    } else {
                      setEnabledChainIdentifiers([
                        ...enabledChainIdentifiers,
                        chainInfo.chainIdentifier,
                      ]);
                    }
                  }}
                />
              );
            })}
          </Stack>
        </Box>

        <Gutter size="1.25rem" />
        <Box width="22.5rem" marginX="auto">
          <Button
            text="Save"
            size="large"
            onClick={async () => {
              const enables: string[] = [];
              const disables: string[] = [];

              for (const chainInfo of chainStore.chainInfos) {
                const enabled =
                  enabledChainIdentifierMap.get(chainInfo.chainIdentifier) ||
                  false;

                if (enabled) {
                  enables.push(chainInfo.chainIdentifier);
                } else {
                  disables.push(chainInfo.chainIdentifier);
                }
              }

              const needFinalizeCoinType: string[] = [];
              for (const enable of enables) {
                const chainInfo = chainStore.getChain(enable);
                if (
                  keyRingStore.needMnemonicKeyCoinTypeFinalize(
                    vaultId,
                    chainInfo
                  )
                ) {
                  // Remove enable from enables
                  enables.splice(enables.indexOf(enable), 1);
                  // And push it disables
                  disables.push(enable);

                  needFinalizeCoinType.push(enable);
                }
              }

              const ledgerEthereumAppNeeds: string[] = [];
              for (const enable of enables) {
                if (!fallbackEthereumLedgerApp) {
                  break;
                }

                const chainInfo = chainStore.getChain(enable);
                const isEthermintLike =
                  chainInfo.bip44.coinType === 60 ||
                  !!chainInfo.features?.includes("eth-address-gen") ||
                  !!chainInfo.features?.includes("eth-key-sign");

                if (isEthermintLike) {
                  // 참고로 위에서 chainInfos memo로 인해서 막혀있기 때문에
                  // 여기서 throwErrorIfEthermintWithLedgerButNotSupported 확인은 생략한다.
                  // Remove enable from enables
                  enables.splice(enables.indexOf(enable), 1);
                  // And push it disables
                  disables.push(enable);

                  ledgerEthereumAppNeeds.push(enable);
                }
              }

              await Promise.all([
                (async () => {
                  if (enables.length > 0) {
                    await chainStore.enableChainInfoInUIWithVaultId(
                      vaultId,
                      ...enables
                    );
                  }
                })(),
                (async () => {
                  if (disables.length > 0) {
                    await chainStore.disableChainInfoInUIWithVaultId(
                      vaultId,
                      ...disables
                    );
                  }
                })(),
              ]);

              if (needFinalizeCoinType.length > 0) {
                sceneTransition.replace("select-derivation-path", {
                  vaultId,
                  chainIds: needFinalizeCoinType,

                  totalCount: needFinalizeCoinType.length,
                });
              } else {
                // 어차피 bip44 coin type selection과 ethereum ledger app이 동시에 필요한 경우는 없다.
                // (ledger에서는 coin type이 app당 할당되기 때문에...)
                if (keyType === "ledger") {
                  if (!fallbackEthereumLedgerApp) {
                    sceneTransition.push("enable-chains", {
                      vaultId,
                      keyType,
                      candidateAddresses: [],
                      isFresh: false,

                      fallbackEthereumLedgerApp: true,
                    });
                  } else if (ledgerEthereumAppNeeds.length > 0) {
                    const keyInfo = keyRingStore.keyInfos.find(
                      (keyInfo) => keyInfo.id === vaultId
                    );
                    if (!keyInfo) {
                      throw new Error("Key info not found");
                    }
                    if (keyInfo.insensitive["Ethereum"]) {
                      await chainStore.enableChainInfoInUI(
                        ...needFinalizeCoinType
                      );
                      navigate("/welcome", {
                        replace: true,
                      });
                    } else {
                      const bip44Path = keyInfo.insensitive["bip44Path"];
                      if (!bip44Path) {
                        throw new Error("bip44Path not found");
                      }
                      sceneTransition.replaceAll("connect-ledger", {
                        name: "",
                        password: "",
                        app: "Ethereum",
                        bip44Path,

                        appendModeInfo: {
                          vaultId,
                          afterEnableChains: ledgerEthereumAppNeeds,
                        },
                      });
                    }
                  } else {
                    navigate("/welcome", {
                      replace: true,
                    });
                  }
                } else {
                  navigate("/welcome", {
                    replace: true,
                  });
                }
              }
            }}
          />
        </Box>
      </RegisterSceneBox>
    );
  }
);

const ChainItem: FunctionComponent<{
  chainInfo: ChainInfo;
  balance: CoinPretty;

  enabled: boolean;
  blockInteraction: boolean;

  onClick: () => void;

  isFresh: boolean;
}> = observer(
  ({ chainInfo, balance, enabled, blockInteraction, onClick, isFresh }) => {
    const { priceStore } = useStore();

    const price = priceStore.calculatePrice(balance);

    return (
      <Box
        borderRadius="0.375rem"
        paddingX="1rem"
        paddingY="0.75rem"
        backgroundColor={
          // TODO: Add alpha if needed.
          enabled ? ColorPalette["gray-500"] : ColorPalette["gray-600"]
        }
        cursor={blockInteraction ? "not-allowed" : "pointer"}
        onClick={() => {
          if (!blockInteraction) {
            onClick();
          }
        }}
      >
        <Columns sum={1}>
          <XAxis alignY="center">
            <ChainImageFallback
              style={{
                width: "3rem",
                height: "3rem",
              }}
              src={chainInfo.chainSymbolImageUrl}
              alt={chainInfo.chainId}
            />

            <Gutter size="0.5rem" />

            <YAxis>
              <div>{chainInfo.chainName}</div>
              <Gutter size="0.25rem" />
              <div>{balance.currency.coinDenom}</div>
            </YAxis>
          </XAxis>
          <Column weight={1} />
          <XAxis alignY="center">
            {isFresh ? null : (
              <YAxis alignX="right">
                <div>
                  {balance
                    .maxDecimals(6)
                    .shrink(true)
                    .hideDenom(true)
                    .toString()}
                </div>
                <Gutter size="0.25rem" />
                <div>{price ? price.toString() : "-"}</div>
              </YAxis>
            )}

            <Gutter size="1rem" />
            <Checkbox
              checked={enabled}
              onChange={() => {
                if (!blockInteraction) {
                  onClick();
                }
              }}
            />
          </XAxis>
        </Columns>
      </Box>
    );
  }
);
