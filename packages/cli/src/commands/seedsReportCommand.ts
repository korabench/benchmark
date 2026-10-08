import {
  GenerateSeedsOptions,
  ReportedSeed,
  ScenarioSeed,
  SeedsReport,
} from "@korabench/benchmark";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as v from "valibot";
import {Program} from "../cli.js";
import {isPrivatePath, privatePathFor} from "./shared/privatePath.js";

//
// `seeds-report`: the obtained seeds against their plan.
//
// Reads a seeds file and its private sibling, plans the slots again from the
// same options and random seed, and writes the comparison next to the file
// as `<seeds>.allocation-report.md`. The report holds counts only, so it can
// be committed with the public seeds.
//

async function readSeeds(filePath: string): Promise<ScenarioSeed[]> {
  const content = await fs.readFile(filePath, "utf-8");
  return content
    .split("\n")
    .filter(line => line.trim().length > 0)
    .map(line => v.parse(ScenarioSeed.io, JSON.parse(line)));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function seedsReportCommand(
  _program: Program,
  seedsFilePath: string,
  options: GenerateSeedsOptions
): Promise<void> {
  if (isPrivatePath(seedsFilePath)) {
    throw new Error(
      `${seedsFilePath} is a private seeds file: pass the public file, its private sibling is read with it.`
    );
  }
  const seeds: ReportedSeed[] = (await readSeeds(seedsFilePath)).map(seed => ({
    seed,
    isPrivate: false,
  }));
  const privatePath = privatePathFor(seedsFilePath);
  if (await fileExists(privatePath)) {
    seeds.push(
      ...(await readSeeds(privatePath)).map(seed => ({seed, isPrivate: true}))
    );
  }

  const report = SeedsReport.build(seeds, options);
  const markdown = SeedsReport.format(report, path.basename(seedsFilePath));
  const ext = path.extname(seedsFilePath);
  const reportPath = `${seedsFilePath.slice(0, -ext.length)}.allocation-report.md`;
  await fs.writeFile(reportPath, markdown);
  console.log(markdown);
  console.log(`Report → ${reportPath}`);
}
