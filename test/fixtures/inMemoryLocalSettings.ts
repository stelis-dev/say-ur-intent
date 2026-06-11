import {
  type LocalSettingsService,
  type LocalSettingsView,
  type LocalSettingsWriteResponse,
  type PreferencesRepository,
  type LocalSettingRecord,
  type LocalSettingWriteResult,
  type SuiGraphqlUrlSettingRecord,
  type SuiGrpcUrlSettingRecord
} from "../../src/core/preferences/preferencesStore.js";
import { PreferencesStoreError, assertLocalSettingKey } from "../../src/core/preferences/preferencesStore.js";
import { parseGraphqlUrl, parseGrpcUrl } from "../../src/core/suiEndpoint.js";
import { RuntimeLocalSettingsService } from "../../src/runtime/localSettingsService.js";

export class InMemoryPreferencesRepository implements PreferencesRepository {
  private readonly settings = new Map<string, { value: unknown; updatedAt: string }>();

  async ensureDefaultLocalSettings(defaults: { suiGrpcUrl: string; suiGraphqlUrl: string }, now = new Date()): Promise<void> {
    if (!this.settings.has("suiGrpcUrl")) {
      this.settings.set("suiGrpcUrl", { value: parseGrpcUrl(defaults.suiGrpcUrl), updatedAt: now.toISOString() });
    }
    if (!this.settings.has("suiGraphqlUrl")) {
      this.settings.set("suiGraphqlUrl", { value: parseGraphqlUrl(defaults.suiGraphqlUrl), updatedAt: now.toISOString() });
    }
  }

  async getSuiGrpcUrl(): Promise<SuiGrpcUrlSettingRecord | undefined> {
    const record = await this.getLocalSetting("suiGrpcUrl");
    return record
      ? {
          key: "suiGrpcUrl",
          value: asStringSetting(record.value),
          updatedAt: record.updatedAt
        }
      : undefined;
  }

  async getSuiGraphqlUrl(): Promise<SuiGraphqlUrlSettingRecord | undefined> {
    const record = await this.getLocalSetting("suiGraphqlUrl");
    return record
      ? {
          key: "suiGraphqlUrl",
          value: asStringGraphqlSetting(record.value),
          updatedAt: record.updatedAt
        }
      : undefined;
  }

  async setSuiGrpcUrl(url: string, now = new Date()): Promise<LocalSettingWriteResult> {
    const previous = await this.getSuiGrpcUrl();
    const record = await this.setLocalSetting("suiGrpcUrl", url, now);
    return {
      storedValue: asStringSetting(record.value),
      previousStoredValue: previous?.value,
      updatedAt: record.updatedAt
    };
  }

  async setSuiGraphqlUrl(url: string, now = new Date()): Promise<LocalSettingWriteResult> {
    const previous = await this.getSuiGraphqlUrl();
    const record = await this.setLocalSetting("suiGraphqlUrl", url, now);
    return {
      storedValue: asStringGraphqlSetting(record.value),
      previousStoredValue: previous?.value,
      updatedAt: record.updatedAt
    };
  }

  async resetSuiGrpcUrl(defaultUrl: string, now = new Date()): Promise<LocalSettingWriteResult> {
    return this.setSuiGrpcUrl(defaultUrl, now);
  }

  async resetSuiGraphqlUrl(defaultUrl: string, now = new Date()): Promise<LocalSettingWriteResult> {
    return this.setSuiGraphqlUrl(defaultUrl, now);
  }

  async getLocalSetting(key: string): Promise<LocalSettingRecord | undefined> {
    const settingKey = assertLocalSettingKey(key);
    const record = this.settings.get(settingKey);
    return record ? { key: settingKey, value: record.value, updatedAt: record.updatedAt } : undefined;
  }

  async setLocalSetting(key: string, value: unknown, now = new Date()): Promise<LocalSettingRecord> {
    const settingKey = assertLocalSettingKey(key);
    let nextValue = value;
    if (settingKey === "suiGrpcUrl") {
      nextValue = asStringSetting(value);
    } else if (settingKey === "suiGraphqlUrl") {
      nextValue = asStringGraphqlSetting(value);
    }
    this.settings.set(settingKey, { value: nextValue, updatedAt: now.toISOString() });
    const record = await this.getLocalSetting(settingKey);
    if (!record) {
      throw new PreferencesStoreError("not_recorded", "Local setting was not recorded", { key: settingKey });
    }
    return record;
  }
}

export class InMemoryLocalSettingsService implements LocalSettingsService {
  private readonly service: RuntimeLocalSettingsService;

  constructor(
    private readonly repository = new InMemoryPreferencesRepository(),
    private readonly options: {
      env?: NodeJS.ProcessEnv | undefined;
      defaultSuiGrpcUrl?: string | undefined;
      defaultSuiGraphqlUrl?: string | undefined;
      verifyGrpcEndpoint?: ((url: string) => Promise<void>) | undefined;
      verifyGraphqlEndpoint?: ((url: string) => Promise<void>) | undefined;
      now?: (() => Date) | undefined;
    } = {}
  ) {
    this.service = new RuntimeLocalSettingsService({
      preferencesRepository: this.repository,
      env: this.options.env,
      defaultSuiGrpcUrl: this.options.defaultSuiGrpcUrl,
      defaultSuiGraphqlUrl: this.options.defaultSuiGraphqlUrl,
      // Test fixture default only; production endpoint verification is covered by suiEndpoint tests.
      verifyGrpcEndpoint: this.options.verifyGrpcEndpoint ?? (async () => undefined),
      verifyGraphqlEndpoint: this.options.verifyGraphqlEndpoint ?? (async () => undefined),
      now: this.options.now
    });
  }

  async getLocalSettings(): Promise<LocalSettingsView> {
    return this.service.getLocalSettings();
  }

  async setSuiGrpcUrl(url: string): Promise<LocalSettingsWriteResponse> {
    return this.service.setSuiGrpcUrl(url);
  }

  async setSuiGraphqlUrl(url: string): Promise<LocalSettingsWriteResponse> {
    return this.service.setSuiGraphqlUrl(url);
  }

  async resetSuiGrpcUrl(): Promise<LocalSettingsWriteResponse> {
    return this.service.resetSuiGrpcUrl();
  }

  async resetSuiGraphqlUrl(): Promise<LocalSettingsWriteResponse> {
    return this.service.resetSuiGraphqlUrl();
  }
}

function asStringSetting(value: unknown): string {
  if (typeof value !== "string") {
    throw new PreferencesStoreError("invalid_value", "suiGrpcUrl setting value must be a string", { key: "suiGrpcUrl" });
  }
  return parseGrpcUrl(value);
}

function asStringGraphqlSetting(value: unknown): string {
  if (typeof value !== "string") {
    throw new PreferencesStoreError("invalid_value", "suiGraphqlUrl setting value must be a string", {
      key: "suiGraphqlUrl"
    });
  }
  return parseGraphqlUrl(value);
}
