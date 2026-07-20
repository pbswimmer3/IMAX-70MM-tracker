import type { Adapter } from "./types";
import { amcAdapter } from "./amc";
import { regalAdapter } from "./regal";

export function getAdapter(chain: string): Adapter {
  switch (chain.toUpperCase()) {
    case "AMC":
      return amcAdapter;
    case "REGAL":
      return regalAdapter;
    default:
      throw new Error(`Unknown theatre chain: ${chain}`);
  }
}

export * from "./types";
