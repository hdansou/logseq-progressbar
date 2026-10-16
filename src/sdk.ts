/**
 * The slice of the Logseq SDK the pure modules need. `src/index.ts` builds
 * the real one from `logseq.*`; tests pass a fake. Keeping the surface this
 * small is what lets every other module run under vitest without the SDK.
 */
export interface SdkPort {
  datascriptQuery(query: string): Promise<unknown>;
  getBlock(uuid: string, opts?: { includeChildren?: boolean }): Promise<unknown>;
  getBlockProperties(uuid: string): Promise<Record<string, unknown> | null | undefined>;
  getPageBlocksTree(pageName: string): Promise<unknown>;
}
