import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript-compiler-api';
import { byteLength, LIMITS, parseIndex, pathOf } from '../../mods/symbol-navigator/src/index.ts';
import type {
  InputFile,
  Location,
  SymbolEntry,
  SymbolIndex,
} from '../../mods/symbol-navigator/src/index.ts';

export function buildIndex(projectPath: string): SymbolIndex {
  const project = realpathSync(resolve(projectPath));
  const root = dirname(project);
  const inputs = new Map<string, { file: InputFile; text: string; real: string }>();
  let total = 0;
  const localPath = (file: string): string => {
    const path = relative(root, resolve(file)).split(sep).join('/');
    return pathOf(path);
  };
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const capture = (file: string, kind: InputFile['kind']): string => {
    const absolute = resolve(file);
    const path = localPath(absolute);
    const previous = inputs.get(path);
    if (previous) return previous.text;
    const real = realpathSync(absolute);
    if (real !== root && !real.startsWith(root + sep))
      throw new Error('Input resolves outside project directory.');
    // Resolve the target as well: an inward link must not bypass excluded path categories.
    localPath(real);
    const before = statSync(absolute);
    if (!before.isFile() || before.size > LIMITS.fileBytes)
      throw new Error(`Input exceeds 256 KiB or is not regular: ${path}`);
    const text = readFileSync(absolute, 'utf8');
    const after = statSync(absolute);
    if (
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size ||
      realpathSync(absolute) !== real
    )
      throw new Error(`Input changed while reading: ${path}`);
    if (byteLength(text) > LIMITS.fileBytes || text.includes('\0'))
      throw new Error(`Oversized or binary input: ${path}`);
    total += byteLength(text);
    if (total > LIMITS.totalBytes || inputs.size >= LIMITS.inputs)
      throw new Error('Project exceeds 96 inputs or 8 MiB. Narrow the tsconfig.');
    inputs.set(path, { file: { path, kind, sha256: hash(text) }, text, real });
    return text;
  };
  const configHost: ts.ParseConfigFileHost = {
    ...ts.sys,
    readFile: (file) => capture(file, 'config'),
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    },
  };
  const config = ts.getParsedCommandLineOfConfigFile(project, {}, configHost);
  if (!config) throw new Error('Cannot parse project config.');
  if (config.projectReferences?.length)
    throw new Error(
      'Project references are unsupported. Select a standalone tsconfig without references.',
    );
  if (config.errors.length)
    throw new Error(ts.flattenDiagnosticMessageText(config.errors[0]!.messageText, '\n'));
  if (!config.fileNames.length) throw new Error('Project has no TypeScript sources.');
  if (config.fileNames.length > LIMITS.inputs)
    throw new Error('Too many project roots. Narrow the tsconfig.');
  for (const file of config.fileNames) {
    if (!/\.(?:[cm]?ts|tsx)$/.test(file))
      throw new Error('Only TS/TSX/MTS/CTS projects are supported; disable allowJs.');
    capture(file, 'source');
  }
  for (const name of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
    const file = resolve(root, name);
    if (ts.sys.fileExists(file)) capture(file, 'config');
  }
  const host = ts.createCompilerHost({ ...config.options, noEmit: true });
  const originalRead = host.readFile;
  let dependencyBytes = 0;
  let dependencyFiles = 0;
  host.readFile = (file) => {
    const absolute = resolve(file);
    const path = relative(root, absolute);
    if (
      path &&
      !path.startsWith('..' + sep) &&
      !isAbsolute(path) &&
      !path.split(sep).includes('node_modules')
    ) {
      return capture(absolute, file.endsWith('.json') ? 'config' : 'source');
    }
    // Only compiler libs and dependency packages are read outside the selected project.
    // Application imports outside the selected root are refused, never silently omitted.
    if (!absolute.split(sep).includes('node_modules'))
      throw new Error('Application import resolves outside project directory.');
    const stat = ts.sys.fileExists(file) ? statSync(file) : undefined;
    if (stat && (!stat.isFile() || stat.size > 8_388_608))
      throw new Error('Dependency input exceeds 8 MiB.');
    if (stat) {
      dependencyBytes += stat.size;
      dependencyFiles++;
      if (dependencyBytes > 33_554_432 || dependencyFiles > 512)
        throw new Error('Dependency read budget exceeded (512 files / 32 MiB).');
    }
    return originalRead(file);
  };
  const program = ts.createProgram({
    rootNames: config.fileNames,
    options: { ...config.options, noEmit: true },
    host,
  });
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    const first = errors[0]!;
    const where =
      first.file && first.start !== undefined
        ? `${relative(root, first.file.fileName)}:${first.file.getLineAndCharacterOfPosition(first.start).line + 1}: `
        : '';
    throw new Error(
      `Indexing requires a clean TypeScript 6 project (${errors.length} diagnostics). ${where}${ts.flattenDiagnosticMessageText(first.messageText, '\n')}`,
    );
  }
  const checker = program.getTypeChecker();
  const sourceFiles = program.getSourceFiles().filter((file) => {
    const path = relative(root, resolve(file.fileName));
    return (
      path &&
      !path.startsWith('..' + sep) &&
      !isAbsolute(path) &&
      !path.split(sep).includes('node_modules')
    );
  });
  const sourceSet = new Set(sourceFiles);
  const records = new Map<
    ts.Symbol,
    {
      name: string;
      definitions: Location[];
      references: Map<string, Location>;
      declarations: Set<string>;
    }
  >();
  const key = (location: Location) => `${location.path}:${location.line}:${location.column}`;
  const position = (node: ts.Node, end: ts.Node = node): Location => {
    const source = node.getSourceFile();
    const start = source.getLineAndCharacterOfPosition(node.getStart(source));
    return {
      path: localPath(source.fileName),
      line: start.line + 1,
      column: start.character + 1,
      endLine:
        source.getLineAndCharacterOfPosition(Math.max(end.getStart(source), end.getEnd() - 1))
          .line + 1,
    };
  };
  let visited = 0;
  const visit = (node: ts.Node): void => {
    if (++visited > 500_000) throw new Error('AST budget exceeded. Narrow the project.');
    if (ts.isIdentifier(node)) {
      let symbol =
        ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
          ? checker.getShorthandAssignmentValueSymbol(node.parent)
          : checker.getSymbolAtLocation(node);
      if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
      if (symbol) {
        let record = records.get(symbol);
        if (!record) {
          const declarations = (symbol.declarations ?? []).filter((declaration) => {
            const name = ts.getNameOfDeclaration(declaration);
            return (
              sourceSet.has(declaration.getSourceFile()) &&
              name !== undefined &&
              ts.isIdentifier(name) &&
              !ts.isImportSpecifier(declaration) &&
              !ts.isImportClause(declaration) &&
              !ts.isNamespaceImport(declaration)
            );
          });
          if (declarations.length) {
            if (records.size >= LIMITS.symbols)
              throw new Error('More than 2000 symbols. Narrow the project.');
            record = {
              name: symbol.getName(),
              definitions: declarations.map((declaration) =>
                position(ts.getNameOfDeclaration(declaration)!, declaration),
              ),
              references: new Map(),
              declarations: new Set(
                declarations.map((declaration) =>
                  key(position(ts.getNameOfDeclaration(declaration)!)),
                ),
              ),
            };
            records.set(symbol, record);
          }
        }
        if (record) {
          const location = position(node);
          if (!record.declarations.has(key(location)))
            record.references.set(key(location), location);
          if (
            record.references.size > LIMITS.references ||
            record.definitions.length > LIMITS.definitions
          )
            throw new Error(
              'A symbol exceeds 200 references or 8 declarations. Narrow the project.',
            );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  sourceFiles.forEach((file) => visit(file));
  const compare = (a: Location, b: Location) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line || a.column - b.column;
  const entries = [...records.values()].map((record) => ({
    ...record,
    definitions: record.definitions.sort(compare),
  }));
  entries.sort(
    (a, b) =>
      compare(a.definitions[0]!, b.definitions[0]!) ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const symbols: SymbolEntry[] = entries.map((entry, index) => ({
    id: `s${index + 1}`,
    name: entry.name,
    definitions: entry.definitions,
    references: [...entry.references.values()].sort(compare),
  }));
  // Recheck all captured local inputs after analysis. No output is returned on a read race.
  for (const [path, input] of inputs) {
    const file = resolve(root, path);
    const before = statSync(file);
    if (!before.isFile() || before.size > LIMITS.fileBytes || realpathSync(file) !== input.real)
      throw new Error(`Input changed during indexing: ${path}`);
    const current = readFileSync(file, 'utf8');
    const after = statSync(file);
    if (
      byteLength(current) > LIMITS.fileBytes ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      realpathSync(file) !== input.real ||
      hash(current) !== input.file.sha256
    )
      throw new Error(`Input changed during indexing: ${path}`);
  }
  return parseIndex(
    JSON.stringify({
      kind: 'gaddev.symbol-index',
      schemaVersion: 1,
      compilerVersion: ts.version,
      project: localPath(project),
      inputs: [...inputs.values()]
        .map((input) => input.file)
        .sort((a, b) => (a.path < b.path ? -1 : 1)),
      symbols,
    }),
  );
}
