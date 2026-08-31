import fs from 'fs';
import path from 'path';

const tmpDir = path.resolve('data/.kora-run-tmp');
if (!fs.existsSync(tmpDir)) {
  console.log('No checkpoint directory found in data/.kora-run-tmp');
  process.exit(0);
}

const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.json'));
console.log(`Completed scenario tasks in checkpoint: ${files.length}`);
console.log(`Remaining scenarios out of 201: ${201 - files.length}`);
