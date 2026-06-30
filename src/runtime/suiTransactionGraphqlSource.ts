import type { SuiGraphQLClient } from "@mysten/sui/graphql";
import { type ExternalActivityRelationship } from "../core/activity/activityStore.js";
import {
  TransactionActivitySourceError,
  type SuiTransactionActivityFact,
  type SuiTransactionActivityPage,
  type SuiTransactionActivitySource,
  type SuiTransactionActivitySourceInfo
} from "../core/activity/transactionActivityTypes.js";
import { SuiEndpointError, parseGraphqlUrl } from "../core/suiEndpoint.js";
import {
  DEFAULT_SUI_GRAPHQL_ENDPOINT_VERIFY_TIMEOUT_MS,
  SUI_MAINNET_CHAIN_IDENTIFIER,
  verifyMainnetGraphqlEndpoint
} from "./suiEndpoint.js";
import { transactionFactFromNode } from "./suiTransactionGraphqlMapping.js";
import {
  cursorFromPageInfo,
  graphQlAfterCheckpointForInclusiveLowerBound,
  graphQlBeforeCheckpointForInclusiveUpperBound,
  loadGraphqlServiceLimits,
  queryInspectTransaction,
  queryScanAccountTransactions,
  type GraphqlServiceLimits
} from "./suiTransactionGraphqlQueries.js";

export type GraphqlSuiTransactionActivitySourceOptions = {
  url: string;
  expectedChainIdentifier?: string | undefined;
  fetch?: typeof fetch | undefined;
  verifyTimeoutMs?: number | undefined;
};

export class GraphqlSuiTransactionActivitySource implements SuiTransactionActivitySource {
  private readonly url: string;
  private readonly expectedChainIdentifier: string;
  private readonly fetch: typeof fetch | undefined;
  private readonly verifyTimeoutMs: number;
  private verified: {
    client: SuiGraphQLClient;
    info: SuiTransactionActivitySourceInfo;
    limits: GraphqlServiceLimits;
  } | undefined;

  constructor(options: GraphqlSuiTransactionActivitySourceOptions) {
    this.url = parseGraphqlUrl(options.url);
    this.expectedChainIdentifier = options.expectedChainIdentifier ?? SUI_MAINNET_CHAIN_IDENTIFIER;
    this.fetch = options.fetch;
    this.verifyTimeoutMs = options.verifyTimeoutMs ?? DEFAULT_SUI_GRAPHQL_ENDPOINT_VERIFY_TIMEOUT_MS;
  }

  async verifyMainnet(): Promise<SuiTransactionActivitySourceInfo> {
    if (!this.verified) {
      const verified = await verifyMainnetGraphqlEndpoint({
        url: this.url,
        expectedChainIdentifier: this.expectedChainIdentifier,
        timeoutMs: this.verifyTimeoutMs,
        ...(this.fetch ? { fetch: this.fetch } : {})
      });
      const limits = await loadGraphqlServiceLimits(verified.client);
      this.verified = {
        client: verified.client,
        limits,
        info: {
          transport: "graphql",
          endpointHost: new URL(this.url).host,
          chainIdentifier: verified.chainIdentifier
        }
      };
    }
    return this.verified.info;
  }

  async getTransaction(digest: string): Promise<SuiTransactionActivityFact | null> {
    const { client, limits } = await this.runtime();
    const result = await queryInspectTransaction(client, { digest, limits });
    return result.transaction ? transactionFactFromNode(result.transaction) : null;
  }

  async scanAccount(input: {
    account: string;
    relationship: ExternalActivityRelationship;
    limit: number;
    cursor?: string | undefined;
    fromCheckpoint?: string | undefined;
    toCheckpoint?: string | undefined;
  }): Promise<SuiTransactionActivityPage> {
    await this.runtime();
    const filter: Record<string, unknown> = input.relationship === "sent"
      ? { sentAddress: input.account }
      : { affectedAddress: input.account };
    if (input.fromCheckpoint !== undefined) {
      const afterCheckpoint = graphQlAfterCheckpointForInclusiveLowerBound(input.fromCheckpoint);
      if (afterCheckpoint !== undefined) {
        filter.afterCheckpoint = afterCheckpoint;
      }
    }
    if (input.toCheckpoint !== undefined) {
      const beforeCheckpoint = graphQlBeforeCheckpointForInclusiveUpperBound(input.toCheckpoint);
      if (beforeCheckpoint !== undefined) {
        filter.beforeCheckpoint = beforeCheckpoint;
      }
    }

    return this.scanTransactions({
      filter,
      limit: input.limit,
      cursor: input.cursor
    });
  }

  async scanFunction(input: {
    functionTarget: string;
    sentAddress: string;
    limit: number;
    cursor?: string | undefined;
    fromCheckpoint?: string | undefined;
    toCheckpoint?: string | undefined;
  }): Promise<SuiTransactionActivityPage> {
    const filter: Record<string, unknown> = {
      function: input.functionTarget,
      sentAddress: input.sentAddress
    };
    if (input.fromCheckpoint !== undefined) {
      const afterCheckpoint = graphQlAfterCheckpointForInclusiveLowerBound(input.fromCheckpoint);
      if (afterCheckpoint !== undefined) {
        filter.afterCheckpoint = afterCheckpoint;
      }
    }
    if (input.toCheckpoint !== undefined) {
      const beforeCheckpoint = graphQlBeforeCheckpointForInclusiveUpperBound(input.toCheckpoint);
      if (beforeCheckpoint !== undefined) {
        filter.beforeCheckpoint = beforeCheckpoint;
      }
    }

    try {
      return await this.scanTransactions({
        filter,
        limit: input.limit,
        cursor: input.cursor
      });
    } catch (error) {
      if (isFunctionFilterGraphqlRejection(error)) {
        throw new TransactionActivitySourceError(
          "provider_error",
          "Sui GraphQL function activity scan rejected a verified filter combination",
          {
            reason: "function_filter_rejected_by_graphql_validation",
            providerReason: "provider_error",
            message: error.details.message
          }
        );
      }
      throw error;
    }
  }

  private async scanTransactions(input: {
    filter: Record<string, unknown>;
    limit: number;
    cursor?: string | undefined;
  }): Promise<SuiTransactionActivityPage> {
    const { client, limits } = await this.runtime();
    const transactions: SuiTransactionActivityFact[] = [];
    let cursor = input.cursor;
    let hasMore = false;
    do {
      const pageLimit = Math.min(input.limit - transactions.length, limits.transactionPageLimit);
      const result = await queryScanAccountTransactions(client, {
        last: pageLimit,
        before: cursor,
        filter: input.filter,
        limits
      });
      const connection = result.transactions;
      if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo) {
        throw new TransactionActivitySourceError("provider_error", "Sui GraphQL transaction scan returned an unexpected shape");
      }
      if (connection.nodes.length === 0 && connection.pageInfo.hasPreviousPage === true) {
        throw new TransactionActivitySourceError(
          "provider_error",
          "Sui GraphQL transaction scan reported another page without returning transactions"
        );
      }
      transactions.push(...connection.nodes.map(transactionFactFromNode));
      hasMore = connection.pageInfo.hasPreviousPage === true;
      cursor = cursorFromPageInfo(connection.pageInfo);
    } while (hasMore && transactions.length < input.limit);

    return {
      transactions,
      hasMore,
      cursor
    };
  }

  private async runtime(): Promise<{ client: SuiGraphQLClient; limits: GraphqlServiceLimits }> {
    await this.verifyMainnet();
    if (!this.verified) {
      throw new SuiEndpointError("endpoint_unreachable", "Sui GraphQL endpoint was not verified");
    }
    return { client: this.verified.client, limits: this.verified.limits };
  }
}

function isFunctionFilterGraphqlRejection(error: unknown): error is TransactionActivitySourceError & {
  details: { message: string };
} {
  if (!(error instanceof TransactionActivitySourceError) || error.reason !== "provider_error") {
    return false;
  }
  const message = error.details.message;
  return typeof message === "string" &&
    /Failed to parse\s+"TransactionFilter"/i.test(message) &&
    /At most one of\s+\[affectedAddress,\s+affectedObject,\s+function,\s+kind\]\s+can be specified/i.test(message);
}
