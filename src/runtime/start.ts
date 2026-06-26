#!/usr/bin/env node
import { mainnetCoins } from "@mysten/deepbook-v3";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SqliteActivityStore } from "../core/activity/sqliteActivityStore.js";
import {
  createDeepbookSwapTransactionMaterialDigestProducer,
  createDeepbookSwapTransactionMaterialProducer
} from "../adapters/deepbook/deepbookTransactionMaterialProducer.js";
import { createDeepbookSwapHumanReadableReviewProducer } from "../adapters/deepbook/deepbookHumanReviewProducer.js";
import {
  createFlowxSwapTransactionMaterialDigestProducer,
  createFlowxSwapTransactionMaterialProducer
} from "../adapters/flowx/flowxSwapTransactionMaterialProducer.js";
import { createFlowxSwapHumanReadableReviewProducer } from "../adapters/flowx/flowxSwapHumanReviewProducer.js";
import { createFlowxSwapReviewQuoteSource } from "../core/read/flowxQuoteClient.js";
import { validateSupportedAdapterLifecycle } from "../adapters/adapterLifecycleValidators.js";
import { buildSupportedReviewAdapters } from "../adapters/reviewAdapters.js";
import { ADAPTER_PROMPT_SURFACES } from "../adapters/adapterPromptSurfaces.js";
import { TransactionActivityService } from "../core/activity/transactionActivityService.js";
import { createSuiReadService } from "../core/read/readService.js";
import { createTransactionObjectOwnershipProducer } from "../core/action/transactionObjectOwnershipProducer.js";
import { verifySuiChainReceipt } from "../core/action/suiChainReceiptVerifier.js";
import { createReviewTimeSimulationProducer } from "../core/action/reviewTimeSimulationEvidence.js";
import { producePtbVisualizationArtifact } from "../core/action/ptbVisualizationProducer.js";
import { LocalSessionStore } from "../core/session/sessionStore.js";
import { createMcpServer, startMcp } from "../mcp/server.js";
import { SERVER_NAME, SERVER_NETWORK, SERVER_VERSION } from "../mcp/serverInfo.js";
import { createReviewHttpServer } from "../review-server/server.js";
import { DEFAULT_SUI_GRAPHQL_URL, DEFAULT_SUI_GRPC_URL, composeRuntimeConfig, loadBootConfig } from "./config.js";
import {
  probeReviewServerIdentity,
  startOrDeferReviewServer,
  type ReviewServerLifecycle
} from "./reviewServerAcquire.js";
import { RuntimeLocalSettingsService } from "./localSettingsService.js";
import { createStderrLogger } from "./logger.js";
import { SuiEndpointError, verifyMainnetGraphqlEndpoint, verifyMainnetGrpcEndpoint } from "./suiEndpoint.js";
import { GraphqlSuiTransactionActivitySource } from "./suiTransactionGraphqlSource.js";

async function main(): Promise<void> {
  const logger = createStderrLogger("runtime");
  let activityStore: SqliteActivityStore | undefined;
  let reviewServerForCleanup: ReviewServerLifecycle | undefined;
  let mcp: ReturnType<typeof createMcpServer> | undefined;
  try {
    const bootConfig = loadBootConfig();
    const store = new SqliteActivityStore({
      databasePath: bootConfig.activityDatabasePath,
      validateAdapterLifecycle: validateSupportedAdapterLifecycle
    });
    activityStore = store;
    const preferencesRepository = store.createPreferencesRepository();
    await preferencesRepository.ensureDefaultLocalSettings({
      suiGrpcUrl: DEFAULT_SUI_GRPC_URL,
      suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL
    });
    const storedSuiGrpcUrl = await preferencesRepository.getSuiGrpcUrl();
    const storedSuiGraphqlUrl = await preferencesRepository.getSuiGraphqlUrl();
    const config = composeRuntimeConfig({
      bootConfig,
      env: process.env,
      storedSuiGrpcUrl: storedSuiGrpcUrl?.value,
      storedSuiGraphqlUrl: storedSuiGraphqlUrl?.value,
      defaultSuiGrpcUrl: DEFAULT_SUI_GRPC_URL,
      defaultSuiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL
    });
    const { client: suiClient, chainIdentifier } = await verifyMainnetGrpcEndpoint({
      url: config.grpcUrl,
      expectedChainIdentifier: config.expectedChainIdentifier
    });
    const localSettings = new RuntimeLocalSettingsService({
      preferencesRepository,
      env: process.env,
      defaultSuiGrpcUrl: DEFAULT_SUI_GRPC_URL,
      defaultSuiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL,
      bootSuiGrpcUrl: config.suiGrpcUrl,
      bootSuiGraphqlUrl: config.suiGraphqlUrl
    });
    const localData = store.createLocalDataService({
      suiGrpcUrl: DEFAULT_SUI_GRPC_URL,
      suiGraphqlUrl: DEFAULT_SUI_GRAPHQL_URL,
      verifySuiGrpcUrl: async (url) => {
        await verifyMainnetGrpcEndpoint({
          url,
          expectedChainIdentifier: config.expectedChainIdentifier
        });
      },
      verifySuiGraphqlUrl: async (url) => {
        await verifyMainnetGraphqlEndpoint({
          url,
          expectedChainIdentifier: config.expectedChainIdentifier
        });
      }
    });
    const transactionMaterialStore = store.createTransactionMaterialStore();
    const sessions = new LocalSessionStore({
      activityStore: store,
      transactionMaterialStore,
      logger,
      validateAdapterLifecycle: validateSupportedAdapterLifecycle,
      sessions: store.createSessionRecordStore(),
      artifacts: store.createPrivateReviewArtifactStore(),
      walletIdentityStore: store.createWalletIdentityRecordStore(),
      settingsStore: store.createSettingsRecordStore()
    });
    const readService = createSuiReadService({
      client: suiClient,
      network: config.network,
      chainIdentifier,
      coinMetadataCache: store.createCoinMetadataCache()
    });
    const chainReceiptVerifier = (input: Parameters<typeof verifySuiChainReceipt>[1]) =>
      verifySuiChainReceipt(
        {
          client: suiClient,
          network: config.network,
          expectedChainIdentifier: config.expectedChainIdentifier
        },
        input
      );
    const reviewServerFactory = createReviewHttpServer({
      host: config.reviewHost,
      store: sessions,
      logger,
      activityStore: store,
      localSettings,
      localData,
      chainReceiptVerifier,
      reviewComputationDeps: {
        validateAdapterLifecycle: validateSupportedAdapterLifecycle,
        adapters: buildSupportedReviewAdapters((() => {
          const transactionObjectOwnershipProducer = createTransactionObjectOwnershipProducer({
            materialStore: transactionMaterialStore,
            objectSource: suiClient,
            network: config.network,
            chainIdentifier,
            expectedChainIdentifier: config.expectedChainIdentifier
          });
          const reviewTimeSimulationProducer = createReviewTimeSimulationProducer({
            client: suiClient,
            materialStore: transactionMaterialStore,
            network: config.network,
            chainIdentifier,
            expectedChainIdentifier: config.expectedChainIdentifier
          });
          return {
            deepbook: {
              deepbookQuoteSource: readService,
              deepbookDeepBalanceSource: async (account: string) => {
                const balance = await suiClient.core.getBalance({
                  owner: account,
                  coinType: mainnetCoins.DEEP!.type
                });
                return balance.balance.balance.toString();
              },
              deepbookTransactionMaterialProducer: createDeepbookSwapTransactionMaterialProducer({
                client: suiClient,
                network: config.network,
                chainIdentifier,
                expectedChainIdentifier: config.expectedChainIdentifier,
                materialStore: transactionMaterialStore
              }),
              deepbookTransactionMaterialDigestProducer: createDeepbookSwapTransactionMaterialDigestProducer({
                materialStore: transactionMaterialStore
              }),
              transactionObjectOwnershipProducer,
              deepbookHumanReadableReviewProducer: createDeepbookSwapHumanReadableReviewProducer(),
              reviewTimeSimulationProducer,
              ptbVisualizationProducer: (vizInput) =>
                producePtbVisualizationArtifact({ materialStore: transactionMaterialStore, ...vizInput })
            },
            flowx: {
              flowxQuoteSource: createFlowxSwapReviewQuoteSource(),
              flowxTransactionMaterialProducer: createFlowxSwapTransactionMaterialProducer({
                client: suiClient,
                network: config.network,
                chainIdentifier,
                expectedChainIdentifier: config.expectedChainIdentifier,
                materialStore: transactionMaterialStore
              }),
              flowxTransactionMaterialDigestProducer: createFlowxSwapTransactionMaterialDigestProducer({
                materialStore: transactionMaterialStore
              }),
              transactionObjectOwnershipProducer,
              flowxHumanReadableReviewProducer: createFlowxSwapHumanReadableReviewProducer(),
              reviewTimeSimulationProducer,
              ptbVisualizationProducer: (vizInput) =>
                producePtbVisualizationArtifact({ materialStore: transactionMaterialStore, ...vizInput })
            }
          };
        })())
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        network: SERVER_NETWORK
      }
    });
    // The review origin is a single-port singleton shared through the local database:
    // whichever process owns the fixed port serves every client. A second instance
    // defers to a healthy peer (no signals, no port war) and takes the origin over
    // only if that peer exits.
    const reviewServer = await startOrDeferReviewServer(
      (port) => reviewServerFactory.start(port),
      config.reviewPort,
      {
        probeIdentity: (probePort) => probeReviewServerIdentity(probePort, config.reviewHost),
        delay: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        currentPid: process.pid,
        serviceName: SERVER_NAME,
        logger
      }
    );
    reviewServerForCleanup = reviewServer;

    logger.info(
      reviewServer.deferred ? "review server deferring to a healthy peer on the shared origin" : "review server started",
      { host: config.reviewHost, port: config.reviewPort, deferred: reviewServer.deferred }
    );
    let shuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals) => {
      logger.info("shutdown requested", { signal });
      try {
        const closeResults = await Promise.allSettled([
          ...(mcp ? [mcp.close()] : []),
          reviewServer.close()
        ]);
        for (const result of closeResults) {
          if (result.status === "rejected") {
            logger.error("shutdown close failed", {
              error: result.reason instanceof Error ? result.reason.message : String(result.reason)
            });
          }
        }
      } catch (error) {
        logger.error("shutdown failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        try {
          store.close();
        } catch (error) {
          logger.error("activity store close failed", {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      process.exit(exitCodeForSignal(signal));
    };

    const handleSignal = (signal: NodeJS.Signals) => {
      if (shuttingDown) {
        process.exit(exitCodeForSignal(signal));
      }
      shuttingDown = true;
      void shutdown(signal).catch((error: unknown) => {
        logger.error("shutdown failed", {
          error: error instanceof Error ? error.message : String(error)
        });
        process.exit(exitCodeForSignal(signal));
      });
    };

    process.on("SIGINT", () => handleSignal("SIGINT"));
    process.on("SIGTERM", () => handleSignal("SIGTERM"));

    mcp = createMcpServer({
      promptSurfaces: ADAPTER_PROMPT_SURFACES,
      sessions,
      activityStore: store,
      reviewBaseUrl: `http://${config.reviewHost}:${config.reviewPort}`,
      readService,
      transactionActivityService: new TransactionActivityService({
        activityStore: store,
        source: new GraphqlSuiTransactionActivitySource({
          url: config.graphqlUrl,
          expectedChainIdentifier: config.expectedChainIdentifier
        })
      }),
      chainReceiptVerifier,
      localSettings,
      logger
    });
    await startMcp(mcp, new StdioServerTransport());
  } catch (error) {
    const closeResults = await Promise.allSettled([
      ...(mcp ? [mcp.close()] : []),
      ...(reviewServerForCleanup ? [reviewServerForCleanup.close()] : [])
    ]);
    for (const result of closeResults) {
      if (result.status === "rejected") {
        logger.error("startup cleanup close failed", {
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        });
      }
    }
    try {
      activityStore?.close();
    } catch (error) {
      logger.error("activity store close failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  const logger = createStderrLogger("runtime");
  logger.error("fatal runtime error", fatalErrorMeta(error));
  process.exit(1);
});

function exitCodeForSignal(signal: NodeJS.Signals): number {
  return signal === "SIGINT" ? 130 : 143;
}

function fatalErrorMeta(error: unknown): Record<string, unknown> {
  if (error instanceof SuiEndpointError) {
    return {
      error: error.message,
      kind: error.kind,
      details: error.details
    };
  }
  return {
    error: error instanceof Error ? error.message : String(error)
  };
}
