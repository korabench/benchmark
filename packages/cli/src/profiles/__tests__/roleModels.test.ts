import {describe, expect, it} from "vitest";
import {
  chainLabel,
  createChainModel,
  createJudgeModels,
  createSpecModel,
} from "../roleModels.js";
import {makeSpec} from "./fixtures.js";

describe("createSpecModel", () => {
  it("exposes an empty served set before any call", () => {
    const model = createSpecModel(makeSpec("a"));
    expect([...model.served]).toEqual([]);
  });
});

describe("createChainModel", () => {
  it("keeps one member per spec, in order", () => {
    const chain = createChainModel([makeSpec("a"), makeSpec("b")]);
    expect(chain.members.map(m => m.spec.name)).toEqual(["a", "b"]);
  });

  it("returns the single member itself for a one-model chain", () => {
    const chain = createChainModel([makeSpec("only")]);
    expect(chain.model).toBe(chain.members[0]!.model);
  });
});

describe("createJudgeModels", () => {
  it("keys judges by spec name", () => {
    const judges = createJudgeModels([makeSpec("j1"), makeSpec("j2")]);
    expect(Object.keys(judges)).toEqual(["j1", "j2"]);
  });
});

describe("chainLabel", () => {
  it("joins names with arrows", () => {
    expect(chainLabel([makeSpec("a"), makeSpec("b")])).toBe("a → b");
  });
});
