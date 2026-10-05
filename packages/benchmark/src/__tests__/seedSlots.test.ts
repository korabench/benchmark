import {describe, expect, it} from "vitest";
import {GenerateSeedsOptions} from "../benchmark.js";
import {planSeedSlots, SeedSlot} from "../seedSlots.js";

const privacy = "privacy_and_personal_data_protection";
const options: GenerateSeedsOptions = {
  riskIds: [privacy],
  totalSeeds: 12,
  randomSeed: 42,
};

describe("planSeedSlots", () => {
  it("gives every slot a unique key made of the risk id and its index", () => {
    const keys = planSeedSlots(options).map(slot => slot.key);
    expect(keys).toHaveLength(12);
    expect(new Set(keys).size).toBe(12);
    expect(keys[0]).toBe(`${privacy}.0000`);
    expect(keys[11]).toBe(`${privacy}.0011`);
  });

  it("plans the same slots for the same options and random seed", () => {
    const a = planSeedSlots(options);
    const b = planSeedSlots(options);
    expect(b.map(s => [s.key, s.assignment, s.isPrivate])).toEqual(
      a.map(s => [s.key, s.assignment, s.isPrivate])
    );
    expect(SeedSlot.planHash(b)).toBe(SeedSlot.planHash(a));
  });

  it("changes the plan hash with the random seed or the options", () => {
    const hash = SeedSlot.planHash(planSeedSlots(options));
    expect(
      SeedSlot.planHash(planSeedSlots({...options, randomSeed: 43}))
    ).not.toBe(hash);
    expect(
      SeedSlot.planHash(planSeedSlots({...options, totalSeeds: 13}))
    ).not.toBe(hash);
    expect(
      SeedSlot.planHash(planSeedSlots({...options, privateRatio: 0}))
    ).not.toBe(hash);
  });

  it("refuses invalid options before allocating", () => {
    expect(() => planSeedSlots({...options, privateRatio: 2})).toThrow(
      /--private-ratio/
    );
    expect(() => planSeedSlots({...options, riskIds: ["nope"]})).toThrow();
  });
});
