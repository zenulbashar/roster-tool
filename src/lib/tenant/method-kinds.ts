/**
 * Classifies tenant-repository method names as READS or MUTATORS — the ONE
 * definition shared by the tenant-isolation suite (every mutator must be
 * exercised against a foreign tenant, TEST-03) and the audit decorator (every
 * mutator is logged by construction, OPS-04). A new read-only method whose
 * name doesn't match must be added here, or both consumers will treat it as
 * a write.
 */
export const READ_ONLY_METHOD =
  /^(list|get|count|find|has|responses|rosterRows|assignmentsWithShiftType|itemsWithCurrentStatus|confirmedShiftsForStaffOnDate|resolveOwnedSupplierId|locationBelongsToOrg|loansForMarkers|orgId$|businessId$)/;

export function isMutatorName(name: string): boolean {
  return !READ_ONLY_METHOD.test(name);
}
