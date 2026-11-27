import type { InstallGrant } from "@milofly/app-server";

/**
 * In-memory storage for the example. A real app keeps installations in its database with the access
 * token ENCRYPTED, and keeps processed event ids long enough to cover retries (Milofly retries a failed
 * delivery for about half an hour).
 */
const installations = new Map<string, InstallGrant>();
const processedEvents = new Set<string>();

/** One installation per store and region (region-scoped) or per store (store-wide). */
function key(storeId: number, regionId: number | null): string {
  return `${storeId}:${regionId ?? "*"}`;
}

export function saveInstallation(grant: InstallGrant): void {
  installations.set(key(grant.storeId, grant.installScope === "store" ? null : grant.regionId), grant);
}

/** Installation serving `regionId` of `storeId` (store-wide first match, else the exact region). */
export function findInstallation(storeId: number, regionId: number | null): InstallGrant | null {
  return installations.get(key(storeId, null)) ?? (regionId === null ? null : installations.get(key(storeId, regionId)) ?? null);
}

export function removeInstallation(storeId: number, regionId: number | null, scope: "region" | "store"): void {
  installations.delete(key(storeId, scope === "store" ? null : regionId));
}

/** `true` the first time an event id is seen. */
export function firstDelivery(eventId: string): boolean {
  if (processedEvents.has(eventId)) return false;
  processedEvents.add(eventId);
  return true;
}
