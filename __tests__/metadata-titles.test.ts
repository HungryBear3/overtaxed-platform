import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const repoRoot = process.cwd();

const coveredRoutes = [
  ["/", "app/page.tsx"],
  ["/about", "app/about/page.tsx"],
  ["/admin/outreach-approval", "app/admin/outreach-approval/page.tsx"],
  ["/appeal-contingency", "app/appeal-contingency/layout.tsx"],
  ["/appeal-contingency/success", "app/appeal-contingency/success/page.tsx"],
  ["/appeal-packet", "app/appeal-packet/page.tsx"],
  ["/appeal-packet/success", "app/appeal-packet/success/page.tsx"],
  ["/blog", "app/blog/page.tsx"],
  ["/board-of-review", "app/board-of-review/page.tsx"],
  ["/check", "app/check/page.tsx"],
  ["/checkout", "app/checkout/page.tsx"],
  ["/checkout/success", "app/checkout/success/page.tsx"],
  ["/contact", "app/contact/page.tsx"],
  ["/deadlines", "app/deadlines/page.tsx"],
  ["/disclaimer", "app/disclaimer/page.tsx"],
  ["/faq", "app/faq/page.tsx"],
  ["/hoa", "app/hoa/page.tsx"],
  ["/homestead-exemption", "app/homestead-exemption/page.tsx"],
  ["/how-it-works", "app/how-it-works/page.tsx"],
  ["/pricing", "app/pricing/layout.tsx"],
  ["/privacy", "app/privacy/page.tsx"],
  ["/terms", "app/terms/page.tsx"],
  ["/townships", "app/townships/page.tsx"],
] as const;

const requiredLeafTitles = new Map([
  ["/how-it-works", "How Cook County Property Tax Appeals Work"],
  ["/pricing", "Cook County Property Tax Appeal Pricing"],
]);

type MetadataTitle = string | { default?: string; template?: string };

function sourceFile(relativePath: string): ts.SourceFile {
  const absolutePath = join(repoRoot, relativePath);
  return ts.createSourceFile(
    absolutePath,
    readFileSync(absolutePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function propertyByName(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      property.name.getText().replace(/["']/g, "") === name,
  );
}

function stringValue(expression: ts.Expression): string | undefined {
  return ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : undefined;
}

function metadataTitleValue(
  expression: ts.Expression,
): MetadataTitle | undefined {
  const literal = stringValue(expression);
  if (literal) return literal;
  if (!ts.isObjectLiteralExpression(expression)) return undefined;

  const defaultProperty = propertyByName(expression, "default");
  const templateProperty = propertyByName(expression, "template");
  return {
    default: defaultProperty
      ? stringValue(defaultProperty.initializer)
      : undefined,
    template: templateProperty
      ? stringValue(templateProperty.initializer)
      : undefined,
  };
}

function exportedMetadataTitle(
  relativePath: string,
): MetadataTitle | undefined {
  const source = sourceFile(relativePath);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (
      !statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText() !== "metadata" || !declaration.initializer)
        continue;
      if (!ts.isObjectLiteralExpression(declaration.initializer))
        return undefined;
      const title = propertyByName(declaration.initializer, "title");
      return title ? metadataTitleValue(title.initializer) : undefined;
    }
  }
  return undefined;
}

function rootTitleTemplate(): string {
  const source = sourceFile("app/layout.tsx");
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText() !== "metadata" || !declaration.initializer)
        continue;
      if (!ts.isObjectLiteralExpression(declaration.initializer)) break;
      const title = propertyByName(declaration.initializer, "title");
      if (!title || !ts.isObjectLiteralExpression(title.initializer)) break;
      const template = propertyByName(title.initializer, "template");
      const value = template && stringValue(template.initializer);
      if (value) return value;
    }
  }
  throw new Error("Root metadata title template not found");
}

function effectiveTitle(template: string, leafTitle: string): string {
  return template.replace("%s", leafTitle);
}

function resolvedStaticRouteTitle(route: string, metadataFile: string): string {
  const title = exportedMetadataTitle(metadataFile);

  // A layout title template only applies to metadata in a child segment. The
  // root page shares app/layout.tsx's segment, so its own title is final.
  if (route === "/") {
    expect(typeof title).toBe("string");
    return title as string;
  }

  // A nested layout's default is metadata in a child segment, so the root
  // template formats it. Its own template then supersedes the ancestor
  // template for titles declared in still deeper child segments.
  if (route === "/appeal-contingency") {
    expect(typeof title).toBe("object");
    return effectiveTitle(
      rootTitleTemplate(),
      (title as Exclude<MetadataTitle, string>).default as string,
    );
  }
  if (route === "/appeal-contingency/success") {
    const nestedTitle = exportedMetadataTitle(
      "app/appeal-contingency/layout.tsx",
    );
    expect(typeof nestedTitle).toBe("object");
    expect(typeof title).toBe("string");
    return effectiveTitle(
      (nestedTitle as Exclude<MetadataTitle, string>).template as string,
      title as string,
    );
  }

  expect(typeof title).toBe("string");
  return effectiveTitle(rootTitleTemplate(), title as string);
}

function generatedTitleExpressions(relativePath: string): string[] {
  const source = sourceFile(relativePath);
  const expressions: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "generateMetadata"
    ) {
      function visitReturn(candidate: ts.Node): void {
        if (
          ts.isReturnStatement(candidate) &&
          candidate.expression &&
          ts.isObjectLiteralExpression(candidate.expression)
        ) {
          const title = propertyByName(candidate.expression, "title");
          if (title) expressions.push(title.initializer.getText(source));
        }
        ts.forEachChild(candidate, visitReturn);
      }
      visitReturn(node);
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return expressions;
}

describe("root-template metadata titles", () => {
  it("brands the root page exactly once without applying its same-segment layout template", () => {
    const title = resolvedStaticRouteTitle("/", "app/page.tsx");
    // ", from $69" is gone with the tiers it was counting from: one price is
    // not a range to start at, and "from" invites a reader to expect a cheaper
    // entry point that does not exist. The property this test guards — one
    // correctly cased brand on a title the layout template does not wrap — is
    // unchanged.
    expect(title).toBe("OverTaxed IL — Cook County property tax appeals");
    expect(title.match(/OverTaxed IL/g) ?? []).toHaveLength(1);
  });

  it("uses a nested default and template to brand both contingency routes exactly once", () => {
    // The old default advertised the held product in every browser tab and in
    // search results. The route family is withdrawn and de-indexed; it exists
    // to catch stale inbound links, so its title says so.
    expect(exportedMetadataTitle("app/appeal-contingency/layout.tsx")).toEqual({
      default: "Contingency Review Withdrawn",
      template: "%s | OverTaxed IL",
    });

    for (const [route, metadataFile] of coveredRoutes.filter(([route]) =>
      route.startsWith("/appeal-contingency"),
    )) {
      const title = resolvedStaticRouteTitle(route, metadataFile);
      expect(title.match(/OverTaxed IL/g) ?? []).toHaveLength(1);
    }
  });

  it("gives every covered current-main route one correctly cased OverTaxed IL", () => {
    const resolved = coveredRoutes.map(([route, page]) => {
      return [route, resolvedStaticRouteTitle(route, page)] as const;
    });

    for (const [route, title] of resolved) {
      expect({ route, title }).toEqual({
        route,
        title: expect.not.stringMatching(/Overtaxed IL/),
      });
      expect(title.match(/OverTaxed IL/g) ?? []).toHaveLength(1);
    }

    for (const [route, expectedLeafTitle] of requiredLeafTitles) {
      const metadataFile = coveredRoutes.find(
        ([candidate]) => candidate === route,
      )![1];
      expect(exportedMetadataTitle(metadataFile)).toBe(expectedLeafTitle);
    }

    expect(new Set(resolved.map(([, title]) => title)).size).toBe(
      resolved.length,
    );
  });

  it("keeps generated route titles brand-free before the root template is applied", () => {
    const generatedRoutes = [
      "app/appeal-deadline/[slug]/page.tsx",
      "app/blog/[slug]/page.tsx",
      "app/partner/[code]/page.tsx",
      "app/township/[slug]/page.tsx",
    ];

    for (const page of generatedRoutes) {
      const expressions = generatedTitleExpressions(page);
      expect({ page, expressions }).toEqual({
        page,
        expressions: expect.not.arrayContaining([
          expect.stringMatching(/overtaxed il/i),
        ]),
      });
      expect(expressions.length).toBeGreaterThan(0);
    }
  });
});
