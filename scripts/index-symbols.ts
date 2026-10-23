import { realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { buildIndex } from './lib/symbol-index.ts';
import { byteLength, LIMITS, pathOf } from '../mods/symbol-navigator/src/index.ts';

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--project' || args[2] !== '--output') {
  console.error(
    'Usage: npm run symbols:index -- --project /project/tsconfig.json --output /project/symbol-index.json',
  );
  process.exitCode = 1;
} else {
  try {
    const project = realpathSync(resolve(args[1]!));
    const output = resolve(args[3]!);
    if (!output.endsWith('.json')) throw new Error('Output must be a JSON file.');
    const index = buildIndex(project);
    const root = dirname(project);
    pathOf(relative(root, output).split(sep).join('/'));
    if (index.inputs.some((file) => resolve(root, file.path) === output))
      throw new Error('Output would overwrite a project input.');
    // Require an existing parent so symlink containment is checked before any write.
    const parent = realpathSync(dirname(output));
    if (parent !== root && !parent.startsWith(root + sep))
      throw new Error('Output parent must be inside the project directory.');
    pathOf(
      relative(root, resolve(parent, basename(output)))
        .split(sep)
        .join('/'),
    );
    const raw = JSON.stringify(index, null, 2) + '\n';
    if (byteLength(raw) > LIMITS.indexBytes)
      throw new Error('Formatted index exceeds 2 MiB. Narrow the project.');
    // Exclusive creation avoids overwriting a symlink or existing file. Remove an old index explicitly to rebuild.
    writeFileSync(output, raw, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    console.log(
      `Created ${output}: ${index.symbols.length} symbols, ${index.inputs.length} hashed inputs (TypeScript ${index.compilerVersion}).`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Index generation failed.');
    process.exitCode = 1;
  }
}
