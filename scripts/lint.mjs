import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const roots = ['src', 'tests'];
const files = [];
for (const root of roots) {
  const walk = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(directory, item.name);
      if (item.isDirectory()) walk(name);
      else if (/\.tsx?$/.test(name)) files.push(name);
    }
  };
  walk(root);
}
let problems = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  for (const diagnostic of tree.parseDiagnostics) {
    console.error(`${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    problems++;
  }
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.DebuggerStatement || (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'eval')) {
      const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
      console.error(`${file}:${line}: debugger and eval are not allowed`);
      problems++;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}
if (problems) process.exit(1);
console.log(`Lint passed: ${files.length} TypeScript files parsed; no unsafe eval or debugger statements.`);
