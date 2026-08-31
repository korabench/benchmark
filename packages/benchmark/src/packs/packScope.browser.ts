import type {PackScope} from "./packScope.js";

/**
 * The browser stand-in, selected by the `browser` condition on `#packScope`.
 *
 * A page renders against one pack, so there is no concurrent work to keep
 * apart and a save/restore stack is enough. It is accurate for the only shape
 * `Packs.run()` is called with — a synchronous callback — and, unlike
 * `AsyncLocalStorage`, does not survive an await; a browser caller that needs
 * that would have to reach for the real thing.
 */
class StackScope<T> implements PackScope<T> {
  #store: T | undefined;

  getStore(): T | undefined {
    return this.#store;
  }

  run<R>(store: T, fn: () => R): R {
    const previous = this.#store;
    this.#store = store;
    try {
      return fn();
    } finally {
      this.#store = previous;
    }
  }
}

export function createPackScope<T>(): PackScope<T> {
  return new StackScope<T>();
}
