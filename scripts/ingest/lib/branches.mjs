/**
 * What a scan may change about a branch the database already knows.
 *
 * A branch's name, city and address come from its publisher's Stores file. That file is not always there:
 * Fresh Market does not list one at all, and Laib Catalog / Cerberus rotate theirs at midnight. When it is
 * missing and no earlier copy is cached (a cold runner), a branch is known only from its price file — with
 * no name. Missing metadata is not evidence that the branch lost its name or left the chain, so:
 *
 *   - an empty name / city / address never overwrites a known one;
 *   - "listed in the Stores file" is written only when a Stores file was actually read for the publisher.
 *
 * Branch identity (chain code, store number) is never touched here, and no branch is ever deleted.
 */

/** The fields of `row` that hold a value; nothing empty is sent to overwrite what is stored. */
export function withoutBlanks(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

/**
 * The patch for one inventory branch.
 * @param {{ name?: string, city?: string, address?: string, notInStoresFile?: boolean }} b
 * @param {{ at: string, storesFileRead: boolean }} scan
 */
export function inventoryPatch(b, { at, storesFileRead }) {
  return {
    ...withoutBlanks({ name_he: b.name, city: b.city, address: b.address }),
    ...(storesFileRead ? { listed_in_stores_file: !b.notInStoresFile, source_listed_at: at } : {}),
  };
}
