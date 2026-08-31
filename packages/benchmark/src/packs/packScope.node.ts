import {AsyncLocalStorage} from "node:async_hooks";
import type {PackScope} from "./packScope.js";

/**
 * The real async-context scope, used by the CLI, Node scripts and the worker.
 * A server can have several runs in flight in one isolate, so the active pack
 * has to follow each one across its awaits.
 */
export function createPackScope<T>(): PackScope<T> {
  return new AsyncLocalStorage<T>();
}
