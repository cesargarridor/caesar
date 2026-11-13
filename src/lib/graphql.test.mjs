// node --experimental-strip-types --test src/lib/graphql.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { gqlRaw, gqlVarsError, listOperations, extractVarDefs, effectiveOp } from "./graphql.ts";
import { formatGql } from "./graphqlFormat.ts";
import { gqlSyntaxIssue, lex } from "./graphqlLex.ts";
import { parseIntrospection, varsTemplate, operationSnippet, fieldSnippet, searchSchema, countTypes, INTROSPECTION_QUERY } from "./graphqlSchema.ts";
import { completionAt } from "./graphqlComplete.ts";

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
