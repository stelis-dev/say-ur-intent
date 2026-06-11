import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const suiGrpcMocks = vi.hoisted(() => {
  const getChainIdentifier = vi.fn();
  const SuiGrpcClient = vi.fn().mockImplementation(function (_options: unknown) {
    return {
      core: { getChainIdentifier }
    };
  });
  return { getChainIdentifier, SuiGrpcClient };
});

const suiGraphqlMocks = vi.hoisted(() => {
  const query = vi.fn();
  const SuiGraphQLClient = vi.fn().mockImplementation(function (_options: unknown) {
    return { query };
  });
  return { query, SuiGraphQLClient };
});

vi.mock("@mysten/sui/grpc", () => ({
  SuiGrpcClient: suiGrpcMocks.SuiGrpcClient
}));

vi.mock("@mysten/sui/graphql", () => ({
  SuiGraphQLClient: suiGraphqlMocks.SuiGraphQLClient
}));

import {
  SUI_MAINNET_CHAIN_IDENTIFIER,
  SuiEndpointError,
  verifyMainnetGraphqlEndpoint,
  verifyMainnetGrpcEndpoint
} from "../src/runtime/suiEndpoint.js";

describe("Sui endpoint guard", () => {
  beforeEach(() => {
    suiGrpcMocks.getChainIdentifier.mockReset();
    suiGrpcMocks.SuiGrpcClient.mockClear();
    suiGraphqlMocks.query.mockReset();
    suiGraphqlMocks.SuiGraphQLClient.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a verified client when the chain identifier matches", async () => {
    suiGrpcMocks.getChainIdentifier.mockResolvedValue({
      chainIdentifier: SUI_MAINNET_CHAIN_IDENTIFIER
    });

    await expect(
      verifyMainnetGrpcEndpoint({ url: "https://fullnode.mainnet.sui.io:443" })
    ).resolves.toMatchObject({
      chainIdentifier: SUI_MAINNET_CHAIN_IDENTIFIER
    });
    expect(suiGrpcMocks.SuiGrpcClient).toHaveBeenCalledWith({
      baseUrl: "https://fullnode.mainnet.sui.io:443",
      network: "mainnet"
    });
  });

  it("rejects mismatched chain identifiers with endpoint details", async () => {
    suiGrpcMocks.getChainIdentifier.mockResolvedValue({ chainIdentifier: "wrong-chain" });

    await expect(
      verifyMainnetGrpcEndpoint({ url: "https://custom.sui.provider:9443" })
    ).rejects.toMatchObject({
      kind: "chain_identifier_mismatch",
      details: {
        url: "https://custom.sui.provider:9443",
        chainIdentifier: "wrong-chain"
      }
    } satisfies Partial<SuiEndpointError>);
  });

  it("maps endpoint failures to endpoint_unreachable", async () => {
    suiGrpcMocks.getChainIdentifier.mockRejectedValue(new Error("connection refused"));

    await expect(
      verifyMainnetGrpcEndpoint({ url: "https://custom.sui.provider:9443" })
    ).rejects.toMatchObject({
      kind: "endpoint_unreachable",
      details: {
        url: "https://custom.sui.provider:9443",
        error: "connection refused"
      }
    } satisfies Partial<SuiEndpointError>);
  });

  it("times out endpoint verification deterministically", async () => {
    vi.useFakeTimers();
    suiGrpcMocks.getChainIdentifier.mockReturnValue(new Promise(() => undefined));

    const result = verifyMainnetGrpcEndpoint({
      url: "https://custom.sui.provider:9443",
      timeoutMs: 10
    });
    const expectation = expect(result).rejects.toMatchObject({
      kind: "endpoint_timeout",
      details: {
        url: "https://custom.sui.provider:9443",
        timeoutMs: 10
      }
    } satisfies Partial<SuiEndpointError>);
    await vi.advanceTimersByTimeAsync(10);
    await expectation;
  });

  it("returns a verified GraphQL client when the chain identifier matches", async () => {
    suiGraphqlMocks.query.mockResolvedValue({
      data: { chainIdentifier: SUI_MAINNET_CHAIN_IDENTIFIER }
    });

    await expect(
      verifyMainnetGraphqlEndpoint({ url: "https://graphql.mainnet.sui.io/graphql" })
    ).resolves.toMatchObject({
      chainIdentifier: SUI_MAINNET_CHAIN_IDENTIFIER
    });
    expect(suiGraphqlMocks.SuiGraphQLClient).toHaveBeenCalledWith({
      url: "https://graphql.mainnet.sui.io/graphql",
      network: "mainnet"
    });
  });

  it("rejects mismatched GraphQL chain identifiers", async () => {
    suiGraphqlMocks.query.mockResolvedValue({ data: { chainIdentifier: "wrong-chain" } });

    await expect(
      verifyMainnetGraphqlEndpoint({ url: "https://custom.sui.provider/graphql" })
    ).rejects.toMatchObject({
      kind: "chain_identifier_mismatch",
      details: {
        url: "https://custom.sui.provider/graphql",
        chainIdentifier: "wrong-chain"
      }
    } satisfies Partial<SuiEndpointError>);
  });

  it("rejects GraphQL endpoints that do not return chainIdentifier", async () => {
    suiGraphqlMocks.query.mockResolvedValue({ data: {} });

    await expect(
      verifyMainnetGraphqlEndpoint({ url: "https://custom.sui.provider/graphql" })
    ).rejects.toMatchObject({
      kind: "endpoint_unreachable",
      details: {
        url: "https://custom.sui.provider/graphql"
      }
    } satisfies Partial<SuiEndpointError>);
  });

  it("times out GraphQL endpoint verification deterministically", async () => {
    vi.useFakeTimers();
    suiGraphqlMocks.query.mockReturnValue(new Promise(() => undefined));

    const result = verifyMainnetGraphqlEndpoint({
      url: "https://custom.sui.provider/graphql",
      timeoutMs: 10
    });
    const expectation = expect(result).rejects.toMatchObject({
      kind: "endpoint_timeout",
      details: {
        url: "https://custom.sui.provider/graphql",
        timeoutMs: 10
      }
    } satisfies Partial<SuiEndpointError>);
    await vi.advanceTimersByTimeAsync(10);
    await expectation;
  });
});
