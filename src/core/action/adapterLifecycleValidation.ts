import type { AdapterLifecycle } from "./types.js";

export type AdapterLifecycleValidator = (lifecycle: AdapterLifecycle) => void;

export function createAdapterLifecycleValidator(
  validatorsByStageCatalogId: Readonly<Record<string, AdapterLifecycleValidator>>
): AdapterLifecycleValidator {
  return (lifecycle) => {
    const validator = validatorsByStageCatalogId[lifecycle.stageCatalogId];
    if (!validator) {
      throw new Error(`Unsupported adapter lifecycle stage catalog: ${lifecycle.stageCatalogId}`);
    }
    validator(lifecycle);
  };
}

export const rejectAdapterLifecycle: AdapterLifecycleValidator = (lifecycle) => {
  throw new Error(`Adapter lifecycle is not accepted here: ${lifecycle.stageCatalogId}`);
};
