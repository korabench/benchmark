/**
 * Re-split a generated corpus into public and private seeds (decision D1,
 * "Bench integrity", 9 November 2026: 30% public, 70% private).
 *
 * Only the flag changes: no seed or scenario is regenerated. A seed and its
 * scenario move together from the private files to the public ones or back.
 *
 * Rules, applied per risk:
 *
 * 1. Every exposed seed (shown outside KORA, e.g. to Round A experts) is
 *    public. The script fails if one is missing from the corpus.
 * 2. Each risk gets round(ratio x its seeds) public places, the half places
 *    going to risks picked at random from the seed, so the total is
 *    round(ratio x corpus). Every situation type keeps at least one public
 *    seed, as the generator's own split guarantees: a risk that needs more
 *    places for that gets them, and fewer other risks get a half place.
 * 3. The places are spread over the risk's gold standards (each at least the
 *    floor above), then over each gold standard's age bands in proportion to
 *    their sizes (largest remainder). An exposed seed is
 *    never removed, so a cell already over its share keeps its seeds and the
 *    cells under their share fill first.
 * 4. A situation type without a public seed is served first. Then, among the
 *    seeds of cells still under their share, the next public seed
 *    is the one whose situation type is the least represented in the public
 *    set relative to its share of the risk (in whole seeds), then the one
 *    whose other seed fields (gender, race/ethnicity, SES, use, motivation,
 *    signal type, social context, refusal behaviour, memory) are the least
 *    represented in the public set so far, then the one in the cell furthest
 *    under its share, then the one with a gold standard x situation type x
 *    motivation x use combination not yet public, then a seeded random order.
 * 5. Text rule: a candidate whose word 3-shingle Jaccard similarity with a
 *    public scenario of the same risk is over the threshold is skipped. The
 *    threshold is the 99th percentile of all within-risk pairs of the corpus,
 *    the rule the Round A draw used (kora-infra drawScenarioReviewWave.ts).
 *
 * Usage:
 *   node scripts/resplit/resplit-public.mjs \
 *     --in data/seeds-v7.1 --out data/seeds-v7.1-d1 \
 *     --exposed scripts/resplit/exposed.txt [--public-ratio 0.3] [--seed d1-2026-11-09]
 *
 * Reads, in --in: seeds.jsonl, seeds.private.jsonl, scenarios.jsonl,
 * scenarios.private.jsonl and, when present, the revision ledgers
 * (scenarios.revisions.private.jsonl for public scenarios,
 * scenarios.private.revisions.jsonl for private ones). Writes the same files
 * to --out, plus split-report.md and split-report.json. The input is never
 * modified.
 */

import {createHash} from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {parseArgs} from "node:util";

const {values: args} = parseArgs({
  options: {
    in: {type: "string"},
    out: {type: "string"},
    exposed: {type: "string"},
    "public-ratio": {type: "string", default: "0.3"},
    seed: {type: "string", default: "d1-2026-11-09"},
  },
});

if (!args.in || !args.out || !args.exposed) {
  throw new Error("--in, --out and --exposed are required.");
}
if (path.resolve(args.in) === path.resolve(args.out)) {
  throw new Error("--out must differ from --in: the input is never modified.");
}
const publicRatio = Number(args["public-ratio"]);
if (!(publicRatio > 0 && publicRatio < 1)) {
  throw new Error(
    `--public-ratio must be between 0 and 1 (got ${publicRatio}).`
  );
}

//
// Input.
//

const readJsonl = file =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line))
    : undefined;

const inFile = name => path.join(args.in, name);

const publicSeeds = readJsonl(inFile("seeds.jsonl"));
const privateSeeds = readJsonl(inFile("seeds.private.jsonl"));
const publicScenarios = readJsonl(inFile("scenarios.jsonl"));
const privateScenarios = readJsonl(inFile("scenarios.private.jsonl"));
if (!publicSeeds || !privateSeeds || !publicScenarios || !privateScenarios) {
  throw new Error(`${args.in} lacks a seeds or scenarios file.`);
}
const publicRevisions = readJsonl(inFile("scenarios.revisions.private.jsonl"));
const privateRevisions = readJsonl(inFile("scenarios.private.revisions.jsonl"));

const exposed = new Set(
  fs
    .readFileSync(args.exposed, "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("#"))
);

const seeds = [
  ...publicSeeds.map(seed => ({seed, wasPublic: true})),
  ...privateSeeds.map(seed => ({seed, wasPublic: false})),
];
const scenarioBySeed = new Map(
  [...publicScenarios, ...privateScenarios].map(s => [s.seed.id, s])
);
const seedIds = new Set(seeds.map(s => s.seed.id));
if (seedIds.size !== seeds.length) {
  throw new Error("A seed id appears twice in the corpus.");
}
const missingScenarios = seeds.filter(s => !scenarioBySeed.has(s.seed.id));
if (missingScenarios.length > 0) {
  throw new Error(`${missingScenarios.length} seeds have no scenario.`);
}
const unknownExposed = [...exposed].filter(id => !seedIds.has(id));
if (unknownExposed.length > 0) {
  throw new Error(
    `${unknownExposed.length} exposed ids are not in the corpus: ${unknownExposed.slice(0, 5).join(", ")}`
  );
}

//
// Seeded randomness.
//

function rngFrom(seed) {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, rng) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

//
// Text rule.
//

function shingles(text) {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  return new Set(
    words.length < 3
      ? [words.join(" ")]
      : words.slice(2).map((_, i) => words.slice(i, i + 3).join(" "))
  );
}

function jaccard(a, b) {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

const shinglesBySeed = new Map(
  seeds.map(({seed}) => {
    const s = scenarioBySeed.get(seed.id);
    return [
      seed.id,
      shingles([s.childBackground, s.narrative, s.firstUserMessage].join("\n")),
    ];
  })
);

const byRisk = Map.groupBy(seeds, s => s.seed.riskId);

const withinRiskSimilarities = [...byRisk.values()].flatMap(group =>
  group.flatMap((a, i) =>
    group
      .slice(i + 1)
      .map(b =>
        jaccard(shinglesBySeed.get(a.seed.id), shinglesBySeed.get(b.seed.id))
      )
  )
);
const sortedSimilarities = [...withinRiskSimilarities].sort((a, b) => a - b);
const threshold =
  sortedSimilarities[Math.floor(0.99 * (sortedSimilarities.length - 1))];

//
// Allocation.
//

function largestRemainder(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map(w => (total * w) / sum);
  const floors = exact.map(Math.floor);
  const order = exact
    .map((x, i) => ({i, r: x - Math.floor(x)}))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  const left = total - floors.reduce((a, b) => a + b, 0);
  order.slice(0, left).forEach(({i}) => floors[i]++);
  return floors;
}

// Situation types are named per gold standard, and two gold standards of a
// risk can share a name (1.2b and 1.2c both have "Reframed request").
const situationOf = seed => `${seed.goldStandardId} · ${seed.situationType}`;
const cellOf = seed => `${seed.goldStandardId} · ${seed.ageRange}`;
const comboOf = seed =>
  [
    seed.goldStandardId,
    seed.situationType,
    seed.motivation.name,
    seed.use,
  ].join(" | ");

const rng = rngFrom(args.seed);
const risks = [...byRisk.keys()].sort();
const targetTotal = Math.round(publicRatio * seeds.length);

// The fewest public seeds a gold standard can have: its share of the ratio
// (rounded down), or its exposed seeds plus one for each situation type they
// leave without a public seed, whichever is larger. A risk's floor is the sum
// over its gold standards, so a gold standard with many situation types
// (1.2b) does not take places from its siblings.
function goldStandardFloors(risk) {
  const group = byRisk.get(risk).map(s => s.seed);
  return new Map(
    [...Map.groupBy(group, s => s.goldStandardId)]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([gsId, gs]) => {
        const exposedHere = gs.filter(s => exposed.has(s.id));
        const covered = new Set(exposedHere.map(situationOf));
        const uncovered = new Set(
          gs.map(situationOf).filter(t => !covered.has(t))
        );
        return [
          gsId,
          Math.max(
            Math.floor(publicRatio * gs.length),
            exposedHere.length + uncovered.size
          ),
        ];
      })
  );
}

const minimumOf = risk =>
  [...goldStandardFloors(risk).values()].reduce((a, b) => a + b, 0);

const floorTargets = new Map(
  risks.map(r => [
    r,
    Math.max(Math.floor(publicRatio * byRisk.get(r).length), minimumOf(r)),
  ])
);
// A risk raised to its minimum takes no half place; the others share what is
// left of the total.
const extra =
  targetTotal - [...floorTargets.values()].reduce((a, b) => a + b, 0);
const extraRisks = new Set(
  shuffled(
    risks.filter(r => publicRatio * byRisk.get(r).length > floorTargets.get(r)),
    rng
  ).slice(0, Math.max(extra, 0))
);
const riskTarget = r => floorTargets.get(r) + (extraRisks.has(r) ? 1 : 0);

// Seed fields the split keeps balanced between public and private, besides
// the risk, gold standard, age band and situation type handled above.
const balanceFields = [
  ["childGender", s => s.childGender],
  ["childRaceEthnicity", s => s.childRaceEthnicity],
  ["childSES", s => s.childSES],
  ["use", s => s.use],
  ["motivation", s => s.motivation.name],
  ["riskSignalType", s => s.riskSignalType],
  ["socialContext", s => s.socialContext],
  ["refusalBehavior", s => s.refusalBehavior],
  ["memory", s => s.memory],
];
const seedById = new Map(seeds.map(({seed}) => [seed.id, seed]));
const corpusShare = new Map(
  balanceFields.map(([, get]) => {
    const counts = Map.groupBy(seeds, ({seed}) => get(seed));
    return [get, value => (counts.get(value)?.length ?? 0) / seeds.length];
  })
);

const isPublic = new Set(exposed);
const riskReports = [];

for (const risk of risks) {
  const group = byRisk.get(risk).map(s => s.seed);
  const target = riskTarget(risk);
  const exposedHere = group.filter(s => exposed.has(s.id));
  if (exposedHere.length > target) {
    throw new Error(
      `${risk}: ${exposedHere.length} exposed seeds exceed its ${target} public places.`
    );
  }

  // The risk's places go first to its gold standards (each at least its
  // floor, the rest by largest remainder of their ratio share), then to the
  // age bands of each gold standard in proportion to their sizes.
  const floors = goldStandardFloors(risk);
  const gsIds = [...floors.keys()];
  const gsSize = gsId => group.filter(s => s.goldStandardId === gsId).length;
  const gsLeft = largestRemainder(
    target - minimumOf(risk),
    gsIds.map(gsId =>
      Math.max(publicRatio * gsSize(gsId) - floors.get(gsId), 0.001)
    )
  );
  const cells = gsIds.flatMap(gsId =>
    [
      ...new Set(group.filter(s => s.goldStandardId === gsId).map(cellOf)),
    ].sort()
  );
  const cellShares = gsIds.flatMap((gsId, i) => {
    const gsCells = cells.filter(c => c.startsWith(`${gsId} · `));
    return largestRemainder(
      floors.get(gsId) + gsLeft[i],
      gsCells.map(c => group.filter(s => cellOf(s) === c).length)
    );
  });
  const situationShare = new Map(
    [...Map.groupBy(group, situationOf)].map(([t, ss]) => [
      t,
      ss.length / group.length,
    ])
  );

  const order = new Map(shuffled(group, rng).map((s, i) => [s.id, i]));
  const publicHere = () => group.filter(s => isPublic.has(s.id));
  let skippedForText = 0;
  let relaxed = false;

  while (publicHere().length < target) {
    const current = publicHere();
    const inCell = c => current.filter(s => cellOf(s) === c).length;
    // A cell is short by no more than its gold standard is: exposed seeds
    // over one cell's share count against the gold standard's other cells.
    const gsShort = new Map(
      gsIds.map(gsId => [
        gsId,
        cells
          .map((c, i) => [c, cellShares[i]])
          .filter(([c]) => c.startsWith(`${gsId} · `))
          .reduce((sum, [c, share]) => sum + share - inCell(c), 0),
      ])
    );
    const deficit = new Map(
      cells.map((c, i) => [
        c,
        Math.min(
          cellShares[i] - inCell(c),
          gsShort.get(c.slice(0, c.indexOf(" · ")))
        ),
      ])
    );
    const situationCount = t =>
      current.filter(s => situationOf(s) === t).length;
    const combos = new Set(current.map(comboOf));
    const tooSimilar = candidate =>
      current.some(
        p =>
          jaccard(shinglesBySeed.get(candidate.id), shinglesBySeed.get(p.id)) >
          threshold
      );

    // How over-represented the candidate's seed fields are in the public set
    // so far, against the whole corpus (lower: it brings the public set
    // closer to the corpus).
    const publicAll = [...isPublic].map(id => seedById.get(id));
    const balanceOf = candidate =>
      balanceFields.reduce((sum, [, get]) => {
        const value = get(candidate);
        const publicShare =
          publicAll.filter(x => get(x) === value).length / publicAll.length;
        return sum + publicShare - corpusShare.get(get)(value);
      }, 0);

    const ranked = group
      .filter(s => !isPublic.has(s.id))
      .map(s => ({
        s,
        uncovered: situationCount(situationOf(s)) === 0 ? 1 : 0,
        deficit: deficit.get(cellOf(s)),
        // Below 0: the situation type has fewer public seeds than its share,
        // counted in whole seeds so that types equally short tie.
        situationGap: Math.floor(
          situationCount(situationOf(s)) -
            situationShare.get(situationOf(s)) * current.length
        ),
        balance: balanceOf(s),
        newCombo: combos.has(comboOf(s)) ? 1 : 0,
        order: order.get(s.id),
      }))
      // A situation type with no public seed comes first, then a cell under its
      // share, then situation coverage, and only then how far under its share
      // the cell is.
      .sort(
        (a, b) =>
          b.uncovered - a.uncovered ||
          Number(b.deficit > 0) - Number(a.deficit > 0) ||
          a.situationGap - b.situationGap ||
          a.balance - b.balance ||
          b.deficit - a.deficit ||
          a.newCombo - b.newCombo ||
          a.order - b.order
      );

    const pick = relaxed
      ? ranked[0]
      : ranked.find(c => {
          if (!tooSimilar(c.s)) return true;
          skippedForText++;
          return false;
        });
    if (!pick) {
      relaxed = true;
      continue;
    }
    isPublic.add(pick.s.id);
  }

  const finalPublic = publicHere();
  riskReports.push({
    riskId: risk,
    goldStandards: [...new Set(group.map(s => s.goldStandardId))].sort(),
    seeds: group.length,
    target,
    exposed: exposedHere.length,
    added: finalPublic.filter(s => !exposed.has(s.id)).map(s => s.id),
    public: finalPublic.length,
    private: group.length - finalPublic.length,
    skippedForText,
    textRuleRelaxed: relaxed,
  });
}

//
// Output.
//

fs.mkdirSync(args.out, {recursive: true});
const outFile = name => path.join(args.out, name);
const writeJsonl = (name, rows) =>
  fs.writeFileSync(
    outFile(name),
    rows.map(r => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "")
  );

const allSeeds = seeds.map(s => s.seed);
const pub = allSeeds.filter(s => isPublic.has(s.id));
const priv = allSeeds.filter(s => !isPublic.has(s.id));
writeJsonl("seeds.jsonl", pub);
writeJsonl("seeds.private.jsonl", priv);
writeJsonl(
  "scenarios.jsonl",
  pub.map(s => scenarioBySeed.get(s.id))
);
writeJsonl(
  "scenarios.private.jsonl",
  priv.map(s => scenarioBySeed.get(s.id))
);

const revisionSeedId = r => r.seedId ?? r.seed?.id ?? r.id;
if (publicRevisions || privateRevisions) {
  const revisions = [...(publicRevisions ?? []), ...(privateRevisions ?? [])];
  const unknown = revisions.filter(r => !seedIds.has(revisionSeedId(r)));
  if (unknown.length > 0) {
    throw new Error(
      `${unknown.length} revision rows have no seed id the script recognises.`
    );
  }
  writeJsonl(
    "scenarios.revisions.private.jsonl",
    revisions.filter(r => isPublic.has(revisionSeedId(r)))
  );
  writeJsonl(
    "scenarios.private.revisions.jsonl",
    revisions.filter(r => !isPublic.has(revisionSeedId(r)))
  );
}

// The validation ledger is private whatever the split (it also holds rejected
// seeds), so it is copied as is.
if (fs.existsSync(inFile("seeds.validation.private.jsonl"))) {
  fs.copyFileSync(
    inFile("seeds.validation.private.jsonl"),
    outFile("seeds.validation.private.jsonl")
  );
}

//
// Report.
//

const dimensions = [
  ["ageRange", s => s.ageRange],
  ["childAge", s => String(s.childAge)],
  ["childGender", s => s.childGender],
  ["childRaceEthnicity", s => s.childRaceEthnicity],
  ["childSES", s => s.childSES],
  ["use", s => s.use],
  ["motivation", s => s.motivation.name],
  ["riskSignalType", s => s.riskSignalType],
  ["socialContext", s => s.socialContext],
  ["refusalBehavior", s => s.refusalBehavior],
  ["memory", s => s.memory],
];

const pct = (n, d) => (d === 0 ? 0 : (100 * n) / d);
const fmt = x => x.toFixed(1);

function distribution([name, get]) {
  const values = [...new Set(allSeeds.map(get))].sort();
  const rows = values.map(value => {
    const p = pub.filter(s => get(s) === value).length;
    const q = priv.filter(s => get(s) === value).length;
    const all = p + q;
    return {
      value,
      all,
      public: p,
      private: q,
      allShare: pct(all, allSeeds.length),
      publicShare: pct(p, pub.length),
      privateShare: pct(q, priv.length),
    };
  });
  return {
    name,
    rows,
    maxGap: Math.max(
      ...rows.map(r => Math.abs(r.publicShare - r.privateShare))
    ),
  };
}

const distributions = dimensions.map(distribution);

const situationCoverage = risks.flatMap(risk => {
  const group = byRisk.get(risk).map(s => s.seed);
  return [...Map.groupBy(group, s => `${s.goldStandardId}|${s.situationType}`)]
    .map(([key, ss]) => {
      const [goldStandardId, situationType] = key.split("|");
      return {
        riskId: risk,
        goldStandardId,
        situationType,
        all: ss.length,
        public: ss.filter(s => isPublic.has(s.id)).length,
        exposed: ss.filter(s => exposed.has(s.id)).length,
      };
    })
    .sort(
      (a, b) =>
        a.goldStandardId.localeCompare(b.goldStandardId) ||
        a.situationType.localeCompare(b.situationType)
    );
});

const withinPublicMax = Math.max(
  0,
  ...risks.flatMap(risk => {
    const group = byRisk
      .get(risk)
      .map(s => s.seed)
      .filter(s => isPublic.has(s.id));
    return group.flatMap((a, i) =>
      group
        .slice(i + 1)
        .map(b => jaccard(shinglesBySeed.get(a.id), shinglesBySeed.get(b.id)))
    );
  })
);

const added = riskReports.flatMap(r =>
  r.added.map(id => {
    const s = allSeeds.find(x => x.id === id);
    return {
      id,
      riskId: s.riskId,
      goldStandardId: s.goldStandardId,
      situationType: s.situationType,
      ageRange: s.ageRange,
      childAge: s.childAge,
      shortTitle: s.shortTitle,
    };
  })
);

const summary = {
  method: "d1-resplit",
  input: args.in,
  seed: args.seed,
  publicRatio,
  similarityThreshold: threshold,
  withinPublicMaxSimilarity: withinPublicMax,
  total: allSeeds.length,
  public: pub.length,
  private: priv.length,
  exposed: exposed.size,
  added: added.length,
  movedToPrivate: seeds.filter(s => s.wasPublic && !isPublic.has(s.seed.id))
    .length,
  stayedPublic: seeds.filter(s => s.wasPublic && isPublic.has(s.seed.id))
    .length,
  risks: riskReports,
  addedSeeds: added,
  situationCoverage,
  distributions,
};
fs.writeFileSync(
  outFile("split-report.json"),
  JSON.stringify(summary, null, 2)
);

const md = [
  `# Public / private split (D1)`,
  ``,
  `${allSeeds.length} seeds: **${pub.length} public (${fmt(pct(pub.length, allSeeds.length))}%)**, ${priv.length} private. ` +
    `${exposed.size} exposed seeds kept public, ${added.length} added. ` +
    `Seed \`${args.seed}\`, text threshold ${threshold.toFixed(4)} (p99 of within-risk pairs), highest within-risk similarity among public seeds ${withinPublicMax.toFixed(4)}.`,
  ``,
  `## Per risk`,
  ``,
  `| risk | GS | seeds | public | exposed | added | private | skipped (text) |`,
  `| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
  ...riskReports.map(
    r =>
      `| ${r.riskId} | ${r.goldStandards.join(", ")} | ${r.seeds} | ${r.public} | ${r.exposed} | ${r.added.length} | ${r.private} | ${r.skippedForText}${r.textRuleRelaxed ? " (relaxed)" : ""} |`
  ),
  ``,
  `## Seed fields, public vs private`,
  ``,
  `Share of each value in the public and private sets. \`max gap\` is the largest public - private difference, in points.`,
  ``,
  ...distributions.flatMap(d => [
    `### ${d.name} (max gap ${fmt(d.maxGap)})`,
    ``,
    `| value | all | public | private | all % | public % | private % |`,
    `| --- | ---: | ---: | ---: | ---: | ---: | ---: |`,
    ...d.rows.map(
      r =>
        `| ${r.value} | ${r.all} | ${r.public} | ${r.private} | ${fmt(r.allShare)} | ${fmt(r.publicShare)} | ${fmt(r.privateShare)} |`
    ),
    ``,
  ]),
  `## Situation types`,
  ``,
  `| GS | situation type | all | public | of which exposed |`,
  `| --- | --- | ---: | ---: | ---: |`,
  ...situationCoverage.map(
    c =>
      `| ${c.goldStandardId} | ${c.situationType} | ${c.all} | ${c.public} | ${c.exposed} |`
  ),
  ``,
  `## Added seeds`,
  ``,
  `| seed | GS | situation type | age | title |`,
  `| --- | --- | --- | ---: | --- |`,
  ...added.map(
    a =>
      `| ${a.id.slice(0, 8)} | ${a.goldStandardId} | ${a.situationType} | ${a.childAge} | ${a.shortTitle} |`
  ),
  ``,
].join("\n");
fs.writeFileSync(outFile("split-report.md"), md);

console.log(
  `${pub.length} public / ${priv.length} private (${added.length} added to the ${exposed.size} exposed). Threshold ${threshold.toFixed(4)}. Report: ${outFile("split-report.md")}`
);
