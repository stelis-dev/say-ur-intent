import type {
  CoinMetadataCache,
  CoinMetadataCacheLookup,
  CoinMetadataCacheRecord
} from "../../src/core/read/coinMetadata.js";

export class MemoryCoinMetadataCache implements CoinMetadataCache {
  readonly records = new Map<string, CoinMetadataCacheRecord>();

  async getCoinMetadata(input: {
    coinType: string;
    chainIdentifier: string;
    now: Date;
  }): Promise<CoinMetadataCacheLookup> {
    const record = this.records.get(keyFor(input.coinType, input.chainIdentifier));
    if (!record) {
      return { status: "miss" };
    }
    return record.expiresAt > input.now.toISOString()
      ? { status: "hit", record }
      : { status: "expired", record };
  }

  async setCoinMetadata(record: CoinMetadataCacheRecord): Promise<void> {
    this.records.set(keyFor(record.coinType, record.chainIdentifier), record);
  }
}

function keyFor(coinType: string, chainIdentifier: string): string {
  return `${chainIdentifier}:${coinType}`;
}
