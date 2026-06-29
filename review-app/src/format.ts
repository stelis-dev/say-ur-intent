// Shared client-side amount formatting. Pure BigInt math with no @mysten/sui
// dependency, so any page bundle can turn a raw integer amount into a decimal
// display string without pulling server-core code into the browser bundle. The
// per-coin decimals come from the server (which alone reaches the fullnode and
// the coin-metadata cache); this module only renders them.

export const SUI_DECIMALS = 9;

// Unsigned raw integer string -> decimal string, trailing zeros trimmed.
// `raw` must be an unsigned integer string; callers handle the sign separately.
export function rawToDisplay(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

// Signed raw integer string (may start with '-') -> signed decimal string. A
// zero magnitude never renders as "-0".
export function signedRawToDisplay(raw: string, decimals: number): string {
  const negative = raw.startsWith("-");
  const magnitude = negative ? raw.slice(1) : raw;
  const display = rawToDisplay(magnitude, decimals);
  return negative && display !== "0" ? `-${display}` : display;
}

// Gas and other SUI-denominated mist amounts: SUI decimals are a known constant,
// so no coin-metadata lookup is needed to display them.
export function mistToSui(mist: string): string {
  return rawToDisplay(mist, SUI_DECIMALS);
}

// Shorten a 0x address/id for compact display; the full value belongs in a title
// or copy control. Single source so every page shortens addresses the same way.
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
