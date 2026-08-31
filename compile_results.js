import fs from 'fs';
import path from 'path';

const tmpDir = path.resolve('data/.kora-run-tmp');
const outputFile = path.resolve('data/results_chatgpt_study_242_442.json');

if (!fs.existsSync(tmpDir)) {
  console.error('tmpDir does not exist');
  process.exit(1);
}

const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.json'));
console.log(`Found ${files.length} checkpoint files in ${tmpDir}`);

const results = [];
for (const file of files) {
  try {
    const content = fs.readFileSync(path.join(tmpDir, file), 'utf8');
    if (content.trim()) {
      results.push(JSON.parse(content));
    }
  } catch (err) {
    console.error(`Error reading ${file}:`, err.message);
  }
}

fs.writeFileSync(outputFile, JSON.stringify(results, null, 2), 'utf8');
console.log(`Successfully compiled ${results.length} scenario results into ${outputFile}`);
