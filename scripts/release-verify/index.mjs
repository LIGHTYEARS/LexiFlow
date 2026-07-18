/**
 * release:verify — single command for release verification.
 * Runs: lint → typecheck → static gates → unit tests → build → manifest check.
 * See technical-design/13 §5.
 */

import { execSync } from 'node:child_process';

const ROOT = process.cwd();

const STEPS = [
  { name: 'Lint', command: 'npx eslint . --max-warnings 0', critical: true },
  { name: 'TypeCheck', command: 'npx tsc --noEmit', critical: true },
  { name: 'Static Gates', command: 'node scripts/static-gates/index.mjs', critical: true },
  { name: 'Unit Tests', command: 'npx vitest run', critical: true },
  { name: 'Build', command: 'npx wxt build', critical: true },
  { name: 'Manifest Check', command: 'node scripts/release-verify/manifest-check.mjs', critical: true },
];

function runStep(step) {
  try {
    const output = execSync(step.command, {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...process.env, CI: 'true' },
    });
    return { success: true, output: output.slice(-500) };
  } catch (err) {
    return {
      success: false,
      output: (err.stderr || err.stdout || err.message).slice(-1000),
    };
  }
}

function main() {
  console.log('\n📦 LexiFlow Release Verification\n');
  console.log(`Working directory: ${ROOT}\n`);

  const results = [];

  for (const step of STEPS) {
    process.stdout.write(`  ${step.name}...`);
    const result = runStep(step);
    results.push({ name: step.name, ...result });

    if (result.success) {
      console.log(' ✅');
    } else {
      console.log(' ❌');
      if (step.critical) {
        console.log(`\n  Critical step failed. Output:\n${result.output}\n`);
        console.log('  Release verification FAILED.\n');
        process.exit(1);
      }
    }
  }

  const allPassed = results.every((r) => r.success);
  console.log(`\n${allPassed ? '✅ All steps passed' : '❌ Some steps failed'}\n`);

  for (const r of results) {
    console.log(`  ${r.success ? '✅' : '❌'} ${r.name}`);
  }
  console.log();

  process.exit(allPassed ? 0 : 1);
}

main();
