import fs from 'fs';
import path from 'path';

const inputPath = path.resolve('data/scenarios.jsonl');
const outputPath = path.resolve('data/scenarios_242_442.jsonl');

const lines = fs.readFileSync(inputPath, 'utf-8').trim().split('\n');
console.log(`Total scenarios in original file: ${lines.length}`);

// Extract 1-based lines 242 through 442 (index 241 through 441 inclusive)
const slice = lines.slice(241, 442);
console.log(`Extracted scenarios: ${slice.length} (from line 242 to line 442)`);

fs.writeFileSync(outputPath, slice.join('\n') + '\n', 'utf-8');
console.log(`Successfully saved slice to ${outputPath}`);
