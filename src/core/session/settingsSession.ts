import type { LocalSessionBase } from "./localSession.js";

export type SettingsSession = LocalSessionBase & {
  type: "local_settings";
};

