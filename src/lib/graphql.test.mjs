// node --experimental-strip-types --test src/lib/graphql.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { gqlRaw, gqlVarsError, listOperations, extractVarDefs, effectiveOp } from "./graphql.ts";
import { formatGql } from "./graphqlFormat.ts";
import { gqlSyntaxIssue, lex } from "./graphqlLex.ts";
import { parseIntrospection, parseSdl, parseAnySchema, buildQueryFromSelection, varsTemplate, operationSnippet, fieldSnippet, searchSchema, countTypes, INTROSPECTION_QUERY } from "./graphqlSchema.ts";
import { completionAt } from "./graphqlComplete.ts";
import { checkJson, issueText } from "./jsonCheck.ts";
import { newGqlNode, nodeFromRequest, ensureIds, suggestName } from "./tree.ts";
import { requestFromNode, buildExecuteArgs } from "./request.ts";
import { makeShareLink, parseShareLink } from "./shareLink.ts";
import { exportCollection } from "./collectionExport.ts";
import { detectAndParse, exportHar, exportYaml } from "./interchange.ts";

const tr = (r) => ({ kind: "NON_NULL", name: null, ofType: r });
const list = (r) => ({ kind: "LIST", name: null, ofType: r });
const nm = (name, kind = "SCALAR") => ({ kind, name, ofType: null });
const intro = {
  data: {
    __schema: {
      queryType: { name: "Query" }, mutationType: { name: "Mutation" }, subscriptionType: null,
      directives: [{ name: "include", description: "inc", locations: ["FIELD"], args: [{ name: "if", description: "", type: tr(nm("Boolean")), defaultValue: null }] }],
      types: [
        { kind: "OBJECT", name: "Query", description: "", fields: [
          { name: "user", description: "Un usuario", args: [{ name: "id", description: "", type: tr(nm("ID")), defaultValue: null }], type: nm("User", "OBJECT"), isDeprecated: false },
          { name: "users", description: "", args: [{ name: "role", description: "", type: nm("Role", "ENUM"), defaultValue: null }], type: tr(list(tr(nm("User", "OBJECT")))), isDeprecated: false },
        ], inputFields: null, interfaces: [], enumValues: null, possibleTypes: null },
        { kind: "OBJECT", name: "Mutation", description: "", fields: [
          { name: "createUser", description: "", args: [{ name: "input", description: "", type: tr(nm("UserInput", "INPUT_OBJECT")), defaultValue: null }], type: nm("User", "OBJECT"), isDeprecated: false },
        ], inputFields: null, interfaces: [], enumValues: null, possibleTypes: null },
        { kind: "OBJECT", name: "User", description: "", fields: [
          { name: "id", description: "", args: [], type: tr(nm("ID")), isDeprecated: false },
          { name: "name", description: "", args: [], type: nm("String"), isDeprecated: false },
          { name: "friends", description: "", args: [], type: list(nm("User", "OBJECT")), isDeprecated: false },
        ], inputFields: null, interfaces: [], enumValues: null, possibleTypes: null },
        { kind: "INPUT_OBJECT", name: "UserInput", description: "", fields: null, inputFields: [
          { name: "name", description: "", type: tr(nm("String")), defaultValue: null },
          { name: "age", description: "", type: nm("Int"), defaultValue: null },
          { name: "role", description: "", type: nm("Role", "ENUM"), defaultValue: null },
        ], interfaces: null, enumValues: null, possibleTypes: null },
        { kind: "ENUM", name: "Role", description: "", fields: null, inputFields: null, interfaces: null, enumValues: [{ name: "ADMIN", description: "" }, { name: "USER", description: "" }], possibleTypes: null },
        { kind: "SCALAR", name: "String", description: "", fields: null, inputFields: null, interfaces: null, enumValues: null, possibleTypes: null },
        { kind: "OBJECT", name: "__Schema", description: "", fields: [], inputFields: null, interfaces: [], enumValues: null, possibleTypes: null },
      ],
    },
  },
};
const schema = parseIntrospection(intro);

test("formatGql sangra, respeta comentarios y strings", () => {
  const out = formatGql('query Q($a:Int=1){users(first:10,f:{a:"x{y"}) @include(if:$a){id name,...F ... on User{email} # nota\n friends{id}} other}');
  assert.equal(out, [
    'query Q($a: Int = 1) {',
    '  users(first: 10, f: { a: "x{y" }) @include(if: $a) {',
    "    id", "    name", "    ...F", "    ... on User {", "      email", "    }", "    # nota", "    friends {", "      id", "    }", "  }", "  other", "}", "",
  ].join("\n"));
  assert.equal(formatGql("{a b}"), "{\n  a\n  b\n}\n");
  assert.equal(formatGql(formatGql("{a(x:[1,2]){b}}")), formatGql("{a(x:[1,2]){b}}"));
  assert.equal(formatGql(""), "");
});

test("sintaxis: llaves sin cerrar y sobrantes", () => {
  assert.equal(gqlSyntaxIssue("{ a { b } }"), null);
  assert.equal(gqlSyntaxIssue('{ a(x: "}") }'), null);
  assert.equal(gqlSyntaxIssue("{ a # }\n}"), null);
  assert.deepEqual(gqlSyntaxIssue("{ a { b }"), { kind: "unclosed", ch: "{", pos: 0, line: 1 });
  assert.equal(gqlSyntaxIssue("{ a ) }").kind, "unexpected");
  assert.equal(gqlSyntaxIssue('{ a(x: "abc) }').kind, "string");
  assert.equal(gqlSyntaxIssue("{ a(id: {{id}}) }"), null); // {{x}} de Caesar no cuenta como llaves
  assert.ok(lex("{{x}}").every((t) => t.kind === "tpl"));
});

test("listOperations y extractVarDefs", () => {
  const q = "query A($id: ID!, $tags: [String!]! = [], $n: Int) { a } mutation B { b } fragment F on U { x } { c }";
  assert.deepEqual(listOperations(q).map((o) => [o.kind, o.name]), [["query", "A"], ["mutation", "B"], ["query", null]]);
  assert.deepEqual(extractVarDefs(q), [{ name: "id", type: "ID!" }, { name: "tags", type: "[String!]!" }, { name: "n", type: "Int" }]);
  assert.deepEqual(extractVarDefs(q, "B"), []);
  assert.deepEqual(extractVarDefs("query ($x: Int) { a(y: $x) }"), [{ name: "x", type: "Int" }]);
  assert.deepEqual(extractVarDefs("{ a }"), []);
  assert.deepEqual(listOperations("# query X\n{ a(s: \"query Y\") }").length, 1);
});

test("gqlRaw con operationName", () => {
  const q2 = "query A { a } query B { b }";
  assert.deepEqual(JSON.parse(gqlRaw({ gqlQuery: q2, gqlVars: "", gqlOp: "B" })), { query: q2, operationName: "B" });
  assert.equal(JSON.parse(gqlRaw({ gqlQuery: q2, gqlVars: "" })).operationName, "A"); // por defecto la primera con nombre
  assert.equal(JSON.parse(gqlRaw({ gqlQuery: q2, gqlVars: "", gqlOp: "Z" })).operationName, "A");
  assert.equal("operationName" in JSON.parse(gqlRaw({ gqlQuery: "query A { a }", gqlVars: "", gqlOp: "A" })), false);
  const r = JSON.parse(gqlRaw({ gqlQuery: "query($i:Int){a}", gqlVars: '{"i":1}' }, (s) => s.replace("{{x}}", "1")));
  assert.deepEqual(r.variables, { i: 1 });
  assert.equal(effectiveOp([], "A"), null);
});

test("gqlVarsError", () => {
  assert.equal(gqlVarsError(""), null);
  assert.equal(gqlVarsError('{"a":1}'), null);
  assert.ok(gqlVarsError("[1]"));
  assert.ok(gqlVarsError("{"));
});

test("parseIntrospection", () => {
  assert.equal(schema.queryType, "Query");
  assert.equal(schema.mutationType, "Mutation");
  assert.equal(schema.subscriptionType, null);
  assert.equal(countTypes(schema), 6);
  const users = schema.types.Query.fields.find((f) => f.name === "users");
  assert.equal(users.type, "[User!]!");
  assert.equal(users.typeName, "User");
  const user = schema.types.Query.fields.find((f) => f.name === "user");
  assert.deepEqual([user.args[0].type, user.args[0].required], ["ID!", true]);
  assert.deepEqual(schema.types.Role.enumValues.map((e) => e.name), ["ADMIN", "USER"]);
  assert.equal(parseIntrospection(JSON.stringify(intro)).queryType, "Query");
  assert.equal(parseIntrospection(intro.data).queryType, "Query");
  assert.throws(() => parseIntrospection({ errors: [{ message: "introspection disabled" }] }), /introspection disabled/);
  assert.throws(() => parseIntrospection("<html>"), /JSON/);
  assert.ok(INTROSPECTION_QUERY.includes("__schema"));
});

test("varsTemplate", () => {
  const defs = extractVarDefs("query($id: ID!, $n: Int, $on: Boolean, $tags: [String!], $in: UserInput!, $r: Role, $f: Float, $s: String!) { a }");
  assert.deepEqual(JSON.parse(varsTemplate(defs, schema)), { id: "", n: 0, on: false, tags: [], in: { name: "", age: 0, role: "ADMIN" }, r: "ADMIN", f: 0, s: "" });
  assert.deepEqual(JSON.parse(varsTemplate(defs.slice(0, 2), null, '{"id":"7","extra":1}')), { id: "7", extra: 1, n: 0 });
  assert.deepEqual(JSON.parse(varsTemplate([{ name: "x", type: "Foo" }], null)), { x: null });
  assert.equal(varsTemplate([], schema), "");
});

test("snippets y búsqueda", () => {
  const user = schema.types.Query.fields.find((f) => f.name === "user");
  assert.equal(operationSnippet(schema, "query", user, false), "query ($id: ID!) {\n  user(id: $id) {\n    id\n    name\n  }\n}");
  assert.equal(operationSnippet(schema, "query", user, true), "query User($id: ID!) {\n  user(id: $id) {\n    id\n    name\n  }\n}");
  assert.equal(fieldSnippet(schema, user), 'user(id: "") {\n  id\n  name\n}');
  assert.deepEqual(searchSchema(schema, "user").map((h) => h.name), ["user", "users", "createUser", "User", "UserInput"]);
  assert.deepEqual(searchSchema(schema, ""), []);
});

test("autocompletado", () => {
  const at = (txt, force) => completionAt(schema, txt.replace("|", ""), txt.indexOf("|"), force);
  const labels = (r) => r?.items.map((i) => i.label);
  assert.deepEqual(labels(at("{ us|")), ["user", "users"]);
  assert.deepEqual(labels(at("{ user(id: 1) { na| } }")), ["name", "__typename"]);
  assert.equal(at("{ user(id: 1) { na| } }").from, 16);
  assert.ok(labels(at("{ user { | } }", true)).includes("friends"));
  assert.deepEqual(labels(at("{ user { friends { i| } } }")), ["id", "friends"]); // lista de User
  assert.deepEqual(labels(at("mutation { createUser(| ) }", true)), ["input"]);
  assert.deepEqual(labels(at("{ users(role: |) }", true)).slice(0, 2), ["ADMIN", "USER"]);
  assert.deepEqual(labels(at("mutation { createUser(input: { na| }) }")), ["name"]);
  assert.deepEqual(labels(at("query ($a: Int) { user(id: $|) }")), ["a"]);
  assert.deepEqual(labels(at("{ user @inc| }")), ["include"]);
  assert.deepEqual(labels(at("query ($a: Ro|) { user }")), ["Role"]);
  assert.equal(at('{ user(id: "us|") }'), null);
  assert.equal(at("{ # us|\n }"), null);
  assert.deepEqual(labels(at("mu|")), ["mutation"]);
  assert.deepEqual(labels(at("mutation { cr| }")), ["createUser"]);
});

test("parseSdl y parseAnySchema importan esquemas SDL (.graphql) y JSON", () => {
  const sdl = `
    """Esquema de ejemplo"""
    schema {
      query: RootQuery
      mutation: RootMutation
    }

    scalar DateTime

    enum Role {
      "Administrador"
      ADMIN
      USER
    }

    interface Node {
      id: ID!
    }

    type User implements Node {
      "Identificador"
      id: ID!
      name: String!
      role: Role = USER
      friends(limit: Int = 10): [User!]!
      oldField: String @deprecated(reason: "usar name")
    }

    input UserInput {
      name: String!
      role: Role = USER
    }

    union SearchResult = User

    type RootQuery {
      user(id: ID!): User
      users(role: Role): [User!]!
    }

    type RootMutation {
      createUser(input: UserInput!): User!
    }

    directive @auth(role: Role = ADMIN) on FIELD_DEFINITION
  `;
  const s = parseSdl(sdl);
  assert.equal(s.queryType, "RootQuery");
  assert.equal(s.mutationType, "RootMutation");
  assert.equal(s.types.User.fields.find((f) => f.name === "oldField").deprecated, true);
  assert.equal(s.types.User.fields.find((f) => f.name === "friends").args[0].defaultValue, "10");
  assert.deepEqual(s.types.Node.possibleTypes, ["User"]);
  assert.deepEqual(s.types.SearchResult.possibleTypes, ["User"]);
  assert.deepEqual(s.types.Role.enumValues.map((e) => e.name), ["ADMIN", "USER"]);
  assert.equal(s.types.UserInput.inputFields[0].required, true);
  assert.equal(s.directives[0].name, "auth");
  assert.equal(parseAnySchema(sdl).queryType, "RootQuery");
  assert.equal(parseAnySchema(JSON.stringify(intro)).queryType, "Query");
});

test("buildQueryFromSelection construye queries y variables con checkboxes como Postman", () => {
  const fields = new Set(["query.user", "query.user.id", "query.user.name"]);
  const args = new Set(["query.user@id"]);
  const built = buildQueryFromSelection(schema, "query", "GetUser", fields, args, {});
  assert.equal(built.query, "query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n    name\n  }\n}");
  assert.deepEqual(JSON.parse(built.vars), { id: "" });
});

test("buildQueryFromSelection soporta campos anidados, valores personalizados de argumento y mutaciones", () => {
  const fields = new Set(["query.user", "query.user.id", "query.user.friends", "query.user.friends.name"]);
  const args = new Set(["query.user@id"]);
  const built = buildQueryFromSelection(schema, "query", "", fields, args, { "query.user@id": '"42"' });
  assert.equal(built.query, 'query {\n  user(id: "42") {\n    id\n    friends {\n      name\n    }\n  }\n}');
  assert.equal(built.vars, "");

  // Mutación con variable en argumento
  const mFields = new Set(["mutation.createUser", "mutation.createUser.id"]);
  const mBuilt = buildQueryFromSelection(schema, "mutation", "AddUser", mFields, new Set(), {});
  assert.equal(mBuilt.query, "mutation AddUser($input: UserInput!) {\n  createUser(input: $input) {\n    id\n  }\n}");
  assert.deepEqual(JSON.parse(mBuilt.vars), { input: { name: "", age: 0, role: "ADMIN" } });
});

test("GraphQL como tipo de petición (kind: gql): creación, árbol, ejecución, shareLink y exportación", async () => {
  const node = newGqlNode("Mi GraphQL");
  assert.equal(node.kind, "gql");
  assert.equal(node.method, "POST");
  assert.equal(node.body.mode, "graphql");

  const req = requestFromNode({
    ...node,
    url: "https://api.ejemplo.com/graphql?env=prod",
    body: { mode: "graphql", gqlQuery: "query Q($id: ID!) { user(id: $id) { name } }", gqlVars: '{"id": "{{userId}}"}', gqlOp: "Q" },
  });
  assert.equal(req.kind, "gql");
  assert.equal(req.method, "POST");
  assert.equal(suggestName(req), "GQL /graphql");

  const savedNode = nodeFromRequest("Guardada", req);
  assert.equal(savedNode.kind, "gql");
  assert.equal(savedNode.method, "POST");
  assert.equal(savedNode.body.mode, "graphql");

  // Una petición HTTP con body.mode === "graphql" (sin kind) se conserva como HTTP (con GraphQL en el Body)
  const httpWithGqlBody = ensureIds([{
    type: "request",
    name: "HTTP con GraphQL en body",
    method: "POST",
    url: "https://api.ejemplo.com/graphql",
    headers: [],
    body: { mode: "graphql", gqlQuery: "{ users { id } }", gqlVars: "" },
    auth: { type: "none" },
  }])[0];
  assert.equal(httpWithGqlBody.kind, undefined);
  assert.equal(httpWithGqlBody.method, "POST");
  assert.equal(httpWithGqlBody.body.mode, "graphql");
  const httpReq = requestFromNode(httpWithGqlBody);
  assert.equal(httpReq.kind, undefined);
  assert.equal(httpReq.body.mode, "graphql");

  // Argumentos de ejecución con sustitución de {{variables}}
  const execArgs = buildExecuteArgs(req, [{ key: "userId", value: "99", enabled: true }]);
  assert.equal(execArgs.method, "POST");
  assert.equal(execArgs.body.mode, "json");
  assert.deepEqual(JSON.parse(execArgs.body.raw), {
    query: "query Q($id: ID!) { user(id: $id) { name } }",
    variables: { id: "99" },
  });

  // ShareLink ida y vuelta conserva kind === "gql"
  const { link } = await makeShareLink(req);
  const parsed = await parseShareLink(link);
  assert.equal(parsed.kind, "gql");
  assert.equal(parsed.method, "POST");
  assert.equal(parsed.body.mode, "graphql");
  assert.equal(parsed.body.gqlQuery, req.body.gqlQuery);

  // Exportación a Postman v2.1, HAR y YAML
  const folder = { type: "folder", name: "Col", children: [savedNode] };
  const pmJson = JSON.parse(exportCollection(folder, []));
  assert.equal(pmJson.item[0].request.method, "POST");
  assert.equal(pmJson.item[0].request.body.mode, "graphql");
  assert.equal(pmJson.item[0].request.body.graphql.query, req.body.gqlQuery);

  const harJson = JSON.parse(exportHar(folder, [{ key: "userId", value: "99", enabled: true }]));
  assert.equal(harJson.log.entries[0].request.method, "POST");
  assert.ok(harJson.log.entries[0].request.postData.text.includes('"99"'));

  const yamlText = exportYaml(folder, []);
  const reimported = detectAndParse(yamlText);
  assert.equal(reimported.kind, "ready");
});

test("checkJson detecta posición exacta (línea, columna y offset) sin falsear variables {{x}}", () => {
  assert.equal(checkJson('{\n  "id": {{id}},\n  "ok": true\n}'), null);
  const err = checkJson('{\n  "a": 1\n  "b": 2\n}');
  assert.ok(err);
  assert.equal(err.line, 3);
  assert.equal(err.col, 3);
  assert.ok(issueText(err).includes("línea 3, columna 3"));
  assert.ok(issueText(err).includes("falta una coma"));
});
