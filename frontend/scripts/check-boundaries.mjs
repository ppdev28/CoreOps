// Enforce the boundaries that have actually been extracted. Legacy code is
// migrated incrementally; this does not pretend all views are features yet.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = path.join(project, "src");
const contract = path.resolve(project, "../api/typescript");
const errors = [];
function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(root, entry.name);
    return entry.isDirectory()
      ? files(name)
      : /\.tsx?$/.test(name)
        ? [name]
        : [];
  });
}
for (const file of [
  ...files(path.join(source, "shared")),
  ...files(path.join(source, "features")),
  ...files(contract),
]) {
  const tree = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const relative = path.relative(source, file).split(path.sep).join("/");
  function fail(message) {
    errors.push(`${path.relative(project, file)}: ${message}`);
  }
  if (file.startsWith(contract + path.sep)) {
    for (const statement of tree.statements) {
      if (
        !ts.isInterfaceDeclaration(statement) &&
        !ts.isTypeAliasDeclaration(statement) &&
        !(
          ts.isImportDeclaration(statement) &&
          statement.importClause?.isTypeOnly
        ) &&
        !(ts.isExportDeclaration(statement) && statement.isTypeOnly)
      )
        fail("API contract may only contain types; no runtime implementation");
    }
  }
  function visit(node) {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : undefined;
    if (specifier && ts.isStringLiteral(specifier)) {
      const value = specifier.text;
      if (/moby|dockerode|docker-socket/.test(value))
        fail("browser code cannot depend on a Docker SDK/socket");
      if (value.startsWith(".")) {
        const target = path
          .relative(source, path.resolve(path.dirname(file), value))
          .split(path.sep)
          .join("/");
        if (
          relative.startsWith("shared/") &&
          /^(features|views|lib)\//.test(target)
        )
          fail(`shared code cannot import ${target}`);
        if (relative.startsWith("features/") && target === "lib/api")
          fail(
            "features must use shared/api/client, not the legacy API facade",
          );
        const owner = relative.match(/^features\/([^/]+)\//)?.[1];
        const other = target.match(/^features\/([^/]+)(?:\/(.*))?$/);
        if (
          owner &&
          other &&
          owner !== other[1] &&
          other[2] &&
          other[2] !== "index"
        )
          fail("cross-feature imports must use the public entry point");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log("Module boundaries OK: shared, features and API contract.");
