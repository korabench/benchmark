/**
 * The slice of `AsyncLocalStorage` the active-pack scope needs.
 *
 * `packs.ts` reaches an implementation through the `#packScope` subpath
 * import, which resolves to `packScope.node.ts` everywhere except a browser
 * bundle (see the `imports` map in package.json). Node's `AsyncLocalStorage`
 * lives behind `node:async_hooks`, and a static import of that anywhere the
 * browser can reach breaks bundlers: the client build externalizes the builtin
 * to a stub and then fails on the named import. Every browser consumer of this
 * package reaches `Packs.current()` through `Mechanism` and `RiskCategory`, so
 * that path has to stay free of node builtins.
 */
export interface PackScope<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}
