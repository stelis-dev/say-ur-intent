export type SuiEndpointErrorKind =
  | "invalid_url"
  | "endpoint_timeout"
  | "endpoint_unreachable"
  | "chain_identifier_mismatch";

export class SuiEndpointError extends Error {
  constructor(
    readonly kind: SuiEndpointErrorKind,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export const MAX_SUI_GRPC_URL_LENGTH = 512;
export const MAX_SUI_GRAPHQL_URL_LENGTH = 512;

export function parseGrpcUrl(value: string): string {
  let parsed: URL;
  if (value.length > MAX_SUI_GRPC_URL_LENGTH) {
    throw new SuiEndpointError("invalid_url", `Sui gRPC URL must be ${MAX_SUI_GRPC_URL_LENGTH} characters or fewer`);
  }
  const authority = getUrlAuthority(value);
  try {
    parsed = new URL(value);
  } catch {
    throw new SuiEndpointError("invalid_url", "Sui gRPC URL must be a valid http(s) URL with an explicit port");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SuiEndpointError("invalid_url", "Sui gRPC URL must use http or https");
  }

  if (!authority || !hasExplicitPort(authority)) {
    throw new SuiEndpointError("invalid_url", "Sui gRPC URL must include an explicit port, for example :443 or :9000");
  }

  if (authority.includes("@")) {
    throw new SuiEndpointError("invalid_url", "Sui gRPC URL must not include credentials");
  }

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new SuiEndpointError("invalid_url", "Sui gRPC URL must include only scheme, host, and explicit port");
  }

  return `${parsed.protocol}//${authority}`;
}

// GraphQL endpoints commonly include a path such as /graphql and may omit an
// explicit port. gRPC endpoints stay stricter because the pinned gRPC client
// runtime expects only scheme, host, and explicit port.
export function parseGraphqlUrl(value: string): string {
  let parsed: URL;
  if (value.length > MAX_SUI_GRAPHQL_URL_LENGTH) {
    throw new SuiEndpointError(
      "invalid_url",
      `Sui GraphQL URL must be ${MAX_SUI_GRAPHQL_URL_LENGTH} characters or fewer`
    );
  }
  const authority = getUrlAuthority(value);
  try {
    parsed = new URL(value);
  } catch {
    throw new SuiEndpointError("invalid_url", "Sui GraphQL URL must be a valid https URL");
  }

  if (parsed.protocol !== "https:") {
    throw new SuiEndpointError("invalid_url", "Sui GraphQL URL must use https");
  }

  if (!authority) {
    throw new SuiEndpointError("invalid_url", "Sui GraphQL URL must include a host");
  }

  if (authority.includes("@")) {
    throw new SuiEndpointError("invalid_url", "Sui GraphQL URL must not include credentials");
  }

  if (parsed.search || parsed.hash) {
    throw new SuiEndpointError("invalid_url", "Sui GraphQL URL must not include a query string or fragment");
  }

  return parsed.toString();
}

function getUrlAuthority(value: string): string | undefined {
  return value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i)?.[1];
}

function hasExplicitPort(authority: string): boolean {
  return /\]:\d+$/.test(authority) || /^[^[]*:\d+$/.test(authority);
}
