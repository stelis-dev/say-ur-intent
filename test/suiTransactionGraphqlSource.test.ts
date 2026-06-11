import { describe, expect, it, vi, beforeEach } from "vitest";
import { mainnetPackageIds } from "@mysten/deepbook-v3";
import { SUI_MAINNET_CHAIN_IDENTIFIER } from "../src/runtime/suiEndpoint.js";

const graphqlMocks = vi.hoisted(() => {
  const query = vi.fn();
  const SuiGraphQLClient = vi.fn().mockImplementation(function (_options: unknown) {
    return { query };
  });
  return { query, SuiGraphQLClient };
});

vi.mock("@mysten/sui/graphql", () => ({
  SuiGraphQLClient: graphqlMocks.SuiGraphQLClient
}));

import { TransactionActivitySourceError } from "../src/core/activity/transactionActivityTypes.js";
import { GraphqlSuiTransactionActivitySource } from "../src/runtime/suiTransactionGraphqlSource.js";

const account = `0x${"a".repeat(64)}`;
const digest = "5".repeat(44);
const deepbookPackage = mainnetPackageIds.DEEPBOOK_PACKAGE_ID;

function mockVerifiedEndpoint(
  serviceConfig: Partial<{
    transactionPageLimit: number;
    moveCallLimit: number;
    balanceChangeLimit: number;
    objectChangeLimit: number;
    eventLimit: number;
  }> = {}
): typeof graphqlMocks.query {
  return graphqlMocks.query
    .mockResolvedValueOnce({ data: { chainIdentifier: SUI_MAINNET_CHAIN_IDENTIFIER } })
    .mockResolvedValueOnce({
      data: {
        serviceConfig: {
          transactionPageLimit: 50,
          moveCallLimit: 50,
          balanceChangeLimit: 50,
          objectChangeLimit: 1024,
          eventLimit: 50,
          ...serviceConfig
        }
      }
    });
}

describe("GraphqlSuiTransactionActivitySource", () => {
  beforeEach(() => {
    graphqlMocks.query.mockReset();
    graphqlMocks.SuiGraphQLClient.mockClear();
  });

  it("maps inclusive checkpoint inputs to GraphQL exclusive filters", async () => {
    mockVerifiedEndpoint()
      .mockImplementationOnce(async (options: { variables: Record<string, unknown> }) => {
        expect(options.variables).toMatchObject({
          last: 10,
          before: null,
          moveCallLimit: 50,
          balanceChangeLimit: 50,
          objectChangeLimit: 100,
          eventLimit: 50,
          filter: {
            affectedAddress: account,
            afterCheckpoint: 41,
            beforeCheckpoint: 46
          }
        });
        return {
          data: {
            transactions: {
              nodes: [
                {
                  digest,
                  sender: { address: account },
                  effects: {
                    status: "SUCCESS",
                    timestamp: "2026-05-11T00:00:00Z",
                    checkpoint: { sequenceNumber: 45 }
                  }
                }
              ],
              pageInfo: { hasPreviousPage: false, startCursor: null }
            }
          }
        };
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(
      source.scanAccount({
        account,
        relationship: "affected",
        limit: 10,
        fromCheckpoint: "42",
        toCheckpoint: "45"
      })
    ).resolves.toMatchObject({
      transactions: [
        {
          digest,
          sender: account,
          checkpoint: "45",
          timestamp: "2026-05-11T00:00:00.000Z",
          status: "success"
        }
      ],
      hasMore: false
    });
  });

  it("scans function activity with only function, sentAddress, and accepted checkpoint filters", async () => {
    const functionTarget = `${deepbookPackage}::pool::swap_exact_base_for_quote`;
    mockVerifiedEndpoint()
      .mockImplementationOnce(async (options: { variables: Record<string, unknown> }) => {
        expect(options.variables).toMatchObject({
          last: 5,
          before: null,
          filter: {
            function: functionTarget,
            sentAddress: account,
            afterCheckpoint: 41,
            beforeCheckpoint: 46
          }
        });
        expect(options.variables.filter).not.toHaveProperty("affectedAddress");
        expect(options.variables.filter).not.toHaveProperty("affectedObject");
        expect(options.variables.filter).not.toHaveProperty("kind");
        return {
          data: {
            transactions: {
              nodes: [
                {
                  digest,
                  sender: { address: account },
                  effects: {
                    status: "SUCCESS",
                    timestamp: "2026-05-11T00:00:00Z",
                    checkpoint: { sequenceNumber: 45 }
                  }
                }
              ],
              pageInfo: { hasPreviousPage: false, startCursor: null }
            }
          }
        };
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(
      source.scanFunction({
        functionTarget,
        sentAddress: account,
        limit: 5,
        fromCheckpoint: "42",
        toCheckpoint: "45"
      })
    ).resolves.toMatchObject({
      transactions: [
        {
          digest,
          sender: account,
          checkpoint: "45",
          timestamp: "2026-05-11T00:00:00.000Z",
          status: "success"
        }
      ],
      hasMore: false
    });
  });

  it("marks function filter GraphQL validation rejection as stale source evidence", async () => {
    const functionTarget = `${deepbookPackage}::pool::swap_exact_base_for_quote`;
    mockVerifiedEndpoint()
      .mockResolvedValueOnce({
        errors: [
          {
            message: "Failed to parse \"TransactionFilter\": At most one of [affectedAddress, affectedObject, function, kind] can be specified"
          }
        ]
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(
      source.scanFunction({
        functionTarget,
        sentAddress: account,
        limit: 5
      })
    ).rejects.toMatchObject({
      reason: "provider_error",
      details: {
        reason: "function_filter_rejected_by_graphql_validation",
        providerReason: "provider_error"
      }
    } satisfies Partial<TransactionActivitySourceError>);
  });

  it("fails closed when GraphQL reports another page without a cursor", async () => {
    mockVerifiedEndpoint()
      .mockResolvedValueOnce({
        data: {
          transactions: {
            nodes: [],
            pageInfo: { hasPreviousPage: true, startCursor: null }
          }
        }
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(
      source.scanAccount({
        account,
        relationship: "affected",
        limit: 10
      })
    ).rejects.toMatchObject({
      reason: "provider_error"
    } satisfies Partial<TransactionActivitySourceError>);
  });

  it("fails closed when GraphQL reports another empty page", async () => {
    mockVerifiedEndpoint()
      .mockResolvedValueOnce({
        data: {
          transactions: {
            nodes: [],
            pageInfo: { hasPreviousPage: true, startCursor: "cursor-1" }
          }
        }
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(
      source.scanAccount({
        account,
        relationship: "affected",
        limit: 10
      })
    ).rejects.toMatchObject({
      reason: "provider_error"
    } satisfies Partial<TransactionActivitySourceError>);
  });

  it("maps cursor-related GraphQL errors to cursor_invalid", async () => {
    mockVerifiedEndpoint()
      .mockResolvedValueOnce({
        errors: [{ message: "invalid cursor" }]
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(
      source.scanAccount({
        account,
        relationship: "affected",
        limit: 10,
        cursor: "bad"
      })
    ).rejects.toMatchObject({
      reason: "cursor_invalid"
    } satisfies Partial<TransactionActivitySourceError>);
  });

  it("returns continuation cursors from paginated transaction scans", async () => {
    mockVerifiedEndpoint()
      .mockResolvedValueOnce({
        data: {
          transactions: {
            nodes: [
              {
                digest,
                sender: { address: account },
                effects: {
                  status: "FAILURE",
                  timestamp: "2026-05-11T00:00:00Z",
                  checkpoint: { sequenceNumber: "45" }
                }
              }
            ],
            pageInfo: { hasPreviousPage: true, startCursor: "cursor-1" }
          }
        }
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(
      source.scanAccount({
        account,
        relationship: "sent",
        limit: 1,
        cursor: "cursor-0"
      })
    ).resolves.toMatchObject({
      transactions: [{ digest, checkpoint: "45", status: "failure" }],
      hasMore: true,
      cursor: "cursor-1"
    });
    expect(graphqlMocks.query).toHaveBeenLastCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        last: 1,
        before: "cursor-0",
        filter: { sentAddress: account }
      })
    }));
  });

  it("splits account scans by the provider transaction page limit", async () => {
    mockVerifiedEndpoint({ transactionPageLimit: 2 })
      .mockImplementationOnce(async (options: { variables: Record<string, unknown> }) => {
        expect(options.variables).toMatchObject({ last: 2, before: null });
        return {
          data: {
            transactions: {
              nodes: [
                {
                  digest: "1".repeat(44),
                  sender: { address: account },
                  effects: {
                    status: "SUCCESS",
                    timestamp: "2026-05-11T00:02:00Z",
                    checkpoint: { sequenceNumber: "47" }
                  }
                },
                {
                  digest: "2".repeat(44),
                  sender: { address: account },
                  effects: {
                    status: "SUCCESS",
                    timestamp: "2026-05-11T00:01:00Z",
                    checkpoint: { sequenceNumber: "46" }
                  }
                }
              ],
              pageInfo: { hasPreviousPage: true, startCursor: "cursor-2" }
            }
          }
        };
      })
      .mockImplementationOnce(async (options: { variables: Record<string, unknown> }) => {
        expect(options.variables).toMatchObject({ last: 1, before: "cursor-2" });
        return {
          data: {
            transactions: {
              nodes: [
                {
                  digest: "3".repeat(44),
                  sender: { address: account },
                  effects: {
                    status: "FAILURE",
                    timestamp: "2026-05-11T00:00:00Z",
                    checkpoint: { sequenceNumber: "45" }
                  }
                }
              ],
              pageInfo: { hasPreviousPage: true, startCursor: "cursor-3" }
            }
          }
        };
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(
      source.scanAccount({
        account,
        relationship: "sent",
        limit: 3
      })
    ).resolves.toMatchObject({
      transactions: [
        { digest: "1".repeat(44), checkpoint: "47" },
        { digest: "2".repeat(44), checkpoint: "46" },
        { digest: "3".repeat(44), checkpoint: "45" }
      ],
      hasMore: true,
      cursor: "cursor-3"
    });
  });

  it("fails closed when serviceConfig does not provide a usable page limit", async () => {
    mockVerifiedEndpoint({ balanceChangeLimit: 0 });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(source.getTransaction(digest)).rejects.toMatchObject({
      reason: "provider_error",
      details: {
        field: "TransactionEffects.balanceChanges",
        value: 0
      }
    } satisfies Partial<TransactionActivitySourceError>);
  });

  it("maps null transaction status to unknown without treating the node as malformed", async () => {
    mockVerifiedEndpoint()
      .mockResolvedValueOnce({
        data: {
          transaction: {
            digest,
            sender: { address: account },
            effects: {
              status: null,
              timestamp: "2026-05-11T00:00:00Z",
              checkpoint: { sequenceNumber: 45 }
            }
          }
        }
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(source.getTransaction(digest)).resolves.toMatchObject({
      digest,
      status: "unknown",
      checkpoint: "45"
    });
  });

  it("maps normalized transaction detail facts without raw payload fields", async () => {
    mockVerifiedEndpoint()
      .mockResolvedValueOnce({
        data: {
          transaction: {
            digest,
            sender: { address: account },
            kind: {
              __typename: "ProgrammableTransaction",
              commands: {
                nodes: [
                  {
                    __typename: "MoveCallCommand",
                    function: {
                      fullyQualifiedName: "0x2::coin::transfer",
                      name: "transfer",
                      module: {
                        name: "coin",
                        package: { address: "0x2" }
                      }
                    }
                  },
                  { __typename: "TransferObjectsCommand" }
                ],
                pageInfo: { hasNextPage: true }
              }
            },
            effects: {
              status: "FAILURE",
              timestamp: "2026-05-11T00:00:00Z",
              checkpoint: { sequenceNumber: "45" },
              executionError: {
                message: "Move abort",
                abortCode: "42",
                identifier: "EFailure",
                instructionOffset: 7,
                sourceLineNumber: 9,
                module: { name: "coin", package: { address: "0x2" } },
                function: { name: "transfer", module: { name: "coin", package: { address: "0x2" } } }
              },
              gasEffects: {
                gasObject: { address: `0x${"9".repeat(64)}` },
                gasSummary: {
                  computationCost: "100",
                  storageCost: "20",
                  storageRebate: "5",
                  nonRefundableStorageFee: "1"
                }
              },
              balanceChanges: {
                nodes: [
                  {
                    amount: "-10",
                    coinType: { repr: "0x2::sui::SUI" },
                    owner: { address: account }
                  }
                ],
                pageInfo: { hasNextPage: false }
              },
              objectChanges: {
                nodes: [
                  {
                    address: `0x${"8".repeat(64)}`,
                    idCreated: true,
                    idDeleted: false,
                    inputState: null,
                    outputState: {
                      asMoveObject: {
                        contents: { type: { repr: "0x2::coin::Coin<0x2::sui::SUI>" } }
                      }
                    }
                  }
                ],
                pageInfo: { hasNextPage: false }
              },
              events: {
                nodes: [
                  {
                    sequenceNumber: "0",
                    sender: { address: account },
                    transactionModule: { name: "coin", package: { address: "0x2" } },
                    contents: { type: { repr: "0x2::coin::CoinCreated<0x2::sui::SUI>" } }
                  }
                ],
                pageInfo: { hasNextPage: false }
              }
            }
          }
        }
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(source.getTransaction(digest)).resolves.toMatchObject({
      details: {
        transactionKind: "ProgrammableTransaction",
        moveCalls: [
          {
            commandIndex: 0,
            package: "0x2",
            module: "coin",
            function: "transfer",
            target: "0x2::coin::transfer"
          }
        ],
        balanceChanges: [
          {
            owner: account,
            coinType: "0x2::sui::SUI",
            amountRaw: "-10",
            direction: "decrease"
          }
        ],
        objectChanges: [
          {
            changeKind: "created",
            outputType: "0x2::coin::Coin<0x2::sui::SUI>"
          }
        ],
        events: [
          {
            sequenceNumber: "0",
            eventType: "0x2::coin::CoinCreated<0x2::sui::SUI>"
          }
        ],
        gas: {
          computationCostRaw: "100",
          storageCostRaw: "20",
          storageRebateRaw: "5",
          nonRefundableStorageFeeRaw: "1",
          netGasCostRaw: "115"
        },
        executionError: {
          message: "Move abort",
          abortCodeRaw: "42",
          package: "0x2",
          module: "coin",
          function: "transfer"
        },
        truncation: {
          moveCalls: true,
          balanceChanges: false,
          objectChanges: false,
          events: false
        }
      }
    });
  });

  it("maps DeepBook transaction detail facts from a digest read", async () => {
    mockVerifiedEndpoint()
      .mockResolvedValueOnce({
        data: {
          transaction: {
            digest,
            sender: { address: account },
            kind: {
              __typename: "ProgrammableTransaction",
              commands: {
                nodes: [
                  {
                    __typename: "MoveCallCommand",
                    function: {
                      fullyQualifiedName: `${deepbookPackage}::pool::swap_exact_base_for_quote`,
                      name: "swap_exact_base_for_quote",
                      module: {
                        name: "pool",
                        package: { address: deepbookPackage }
                      }
                    }
                  }
                ],
                pageInfo: { hasNextPage: false }
              }
            },
            effects: {
              status: "SUCCESS",
              timestamp: "2026-05-11T00:00:00Z",
              checkpoint: { sequenceNumber: "45" },
              gasEffects: {
                gasObject: { address: `0x${"9".repeat(64)}` },
                gasSummary: {
                  computationCost: "1000",
                  storageCost: "200",
                  storageRebate: "50",
                  nonRefundableStorageFee: "10"
                }
              },
              balanceChanges: {
                nodes: [
                  {
                    amount: "-1000000000",
                    coinType: { repr: "0x2::sui::SUI" },
                    owner: { address: account }
                  },
                  {
                    amount: "2500000",
                    coinType: {
                      repr: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC"
                    },
                    owner: { address: account }
                  }
                ],
                pageInfo: { hasNextPage: false }
              },
              objectChanges: {
                nodes: [
                  {
                    address: `0x${"8".repeat(64)}`,
                    idCreated: false,
                    idDeleted: false,
                    inputState: {
                      asMoveObject: {
                        contents: { type: { repr: `${deepbookPackage}::pool::Pool` } }
                      }
                    },
                    outputState: {
                      asMoveObject: {
                        contents: { type: { repr: `${deepbookPackage}::pool::Pool` } }
                      }
                    }
                  }
                ],
                pageInfo: { hasNextPage: false }
              },
              events: {
                nodes: [
                  {
                    sequenceNumber: "0",
                    sender: { address: account },
                    transactionModule: { name: "pool", package: { address: deepbookPackage } },
                    contents: { type: { repr: `${deepbookPackage}::pool::SwapEvent` } }
                  }
                ],
                pageInfo: { hasNextPage: false }
              }
            }
          }
        }
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(source.getTransaction(digest)).resolves.toMatchObject({
      digest,
      sender: account,
      status: "success",
      details: {
        moveCalls: [
          {
            package: deepbookPackage,
            module: "pool",
            function: "swap_exact_base_for_quote",
            target: `${deepbookPackage}::pool::swap_exact_base_for_quote`
          }
        ],
        balanceChanges: [
          {
            owner: account,
            coinType: "0x2::sui::SUI",
            amountRaw: "-1000000000",
            direction: "decrease"
          },
          {
            owner: account,
            coinType: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
            amountRaw: "2500000",
            direction: "increase"
          }
        ],
        objectChanges: [
          {
            changeKind: "mutated",
            inputType: `${deepbookPackage}::pool::Pool`,
            outputType: `${deepbookPackage}::pool::Pool`
          }
        ],
        events: [
          {
            sequenceNumber: "0",
            package: deepbookPackage,
            module: "pool",
            eventType: `${deepbookPackage}::pool::SwapEvent`
          }
        ],
        gas: {
          computationCostRaw: "1000",
          storageCostRaw: "200",
          storageRebateRaw: "50",
          nonRefundableStorageFeeRaw: "10",
          netGasCostRaw: "1150"
        },
        truncation: {
          moveCalls: false,
          balanceChanges: false,
          objectChanges: false,
          events: false
        }
      }
    });

    const transactionQuery = graphqlMocks.query.mock.calls.at(-1)?.[0]?.query ?? "";
    expect(transactionQuery).toContain("inputState { asMoveObject { contents { type { repr } } } }");
    expect(transactionQuery).toContain("outputState { asMoveObject { contents { type { repr } } } }");
    expect(transactionQuery).not.toContain("inputState { contents");
    expect(transactionQuery).not.toContain("outputState { contents");
  });

  it("maps thrown GraphQL client failures to provider_error", async () => {
    mockVerifiedEndpoint()
      .mockRejectedValueOnce(new Error("network closed"));
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(source.getTransaction(digest)).rejects.toMatchObject({
      reason: "provider_error"
    } satisfies Partial<TransactionActivitySourceError>);
  });

  it("rejects malformed transaction scan connections from the provider", async () => {
    mockVerifiedEndpoint()
      .mockResolvedValueOnce({
        data: {
          transactions: {
            nodes: null,
            pageInfo: { hasPreviousPage: false, startCursor: null }
          }
        }
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(
      source.scanAccount({
        account,
        relationship: "affected",
        limit: 10
      })
    ).rejects.toMatchObject({
      reason: "provider_error"
    } satisfies Partial<TransactionActivitySourceError>);
  });

  it("rejects malformed transaction nodes from the provider", async () => {
    mockVerifiedEndpoint()
      .mockResolvedValueOnce({
        data: {
          transaction: {
            digest,
            sender: { address: account },
            effects: {
              status: "SUCCESS",
              timestamp: "not-a-date",
              checkpoint: { sequenceNumber: 45 }
            }
          }
        }
      });
    const source = new GraphqlSuiTransactionActivitySource({ url: "https://graphql.mainnet.sui.io/graphql" });

    await expect(source.getTransaction(digest)).rejects.toMatchObject({
      reason: "provider_error"
    } satisfies Partial<TransactionActivitySourceError>);
  });
});
