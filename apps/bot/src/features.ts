import type { Feature } from "@nozdormu/core";
import { createPingFeature } from "@nozdormu/ping";

// Every feature the bot runs. The smoke run checks Discord against this same list.
export function createFeatures(): Feature[] {
  return [createPingFeature()];
}
