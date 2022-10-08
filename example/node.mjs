// quick & dirty test for local nodejs usage
// should work the same in browsers too

import { load, Prolog, atom, Compound } from '../trealla.js';

await load();

// create new Prolog interpreter
const pl = new Prolog({
  library: "/lib", // optionally specify library directory ("/library" by default)
  env: {
    // environment variables (grab them with getenv/2)
    GREET: 'greetings'
  }
});

// create a file in the virtual filesystem
pl.fs.open("/greeting.pl", { write: true, create: true }).writeString(`
  :- module(greeting, [hello/1]).
  :- dynamic(hello/1).
  hello(world).
  hello(世界).
`);

// custom library we can load from the use_module(library(...)) directive
pl.fs.createDir("/lib");
pl.fs.open("/lib/test.pl", { write: true, create: true }).writeString(`library(ok).`);

// mortal(Who), format("All humans are mortal. ~s is human. Hence, %s is mortal.").

// consult the file we just created. "greeting" or "/greeting.pl" both work
await pl.consult("greeting");

// assert some dynamic facts
console.log(await pl.queryOnce("assertz(lang(prolog)), greeting:assertz(hello('Welt'))."));
// { result: 'success', answer: {}, output: '' } // as in the regular toplevel's "true."

// run a query on the file we loaded and facts we asserted
await dumpQuery(
  pl.query(`use_module(greeting), hello(Planet), lang(Lang), format("hello ~w from ~w!~n", [Planet, Lang]).`, {encode: {atoms: "string"}}));

/*
{
  result: 'success',
  answer: { Planet: 'world', Lang: 'prolog' },
  output: 'hello world from prolog!\n'
}
{
  result: 'success',
  answer: { Planet: '世界', Lang: 'prolog' },
  output: 'hello 世界 from prolog!\n'
}
{
  result: 'success',
  answer: { Planet: 'Welt', Lang: 'prolog' },
  output: 'hello Welt from prolog!\n'
}
*/

await dumpQuery(pl.query("use_module(library(test)), library(Status)."));

/*
{ result: 'success', answer: { Status: 'ok' }, output: '' }
*/

// testing the optional "program" parameter which is consulted before the query is run
await dumpQuery(pl.query("🤠 howdy.", {
  program: `
    :- op(201, fy, 🤠).
    🤠(X) :- format("yee haw ~w~n", [X]).`
}));

/*
{ result: 'success', answer: {}, output: 'yee haw howdy\n' }
*/

// multiple async queries:
const q1 = pl.query("between(0,9,X).");
const q2 = pl.query("between(10,19,N).");
await q1.next();
await q2.next();
console.log(await q1.next()); // X=1
console.log(await q2.next()); // N=11
// kill queries
await q1.return();
await q2.return();

// Prolog-format toplevel

await dumpQuery(
  pl.query(`use_module(greeting), hello(Planet), lang(Lang), format("hello ~w from ~w!~n", [Planet, Lang]).`, {
    format: "prolog"
  })
);

// residual goals
for await (const answer of pl.query(`dif(A, B) ; dif(C, D).`, {format: "prolog"})) {
  console.log(answer);
};

// console.log(await pl.queryOnce("throw(test).", {format: "prolog"}));
console.log(await pl.queryOnce("true.", {format: "prolog"}));
console.log(await pl.queryOnce("fail.", {format: "prolog"}));

// getenv/2
console.log(await pl.queryOnce("getenv('GREET', X).", {format: "prolog"}));

// trace
console.log(await pl.queryOnce("trace, findall(X, between(1,10,X), Xs).", {format: "prolog"}));

// boolean
console.log(await pl.queryOnce("T = {true}, F = {false}, N = {null}.", {format: "json", encode: {booleans: "{}", nulls: "{}"}}));
console.log(await pl.queryOnce("T = @true, F = @false, N = @null.", {program: ":- op(201, fx, @).", format: "json", encode: {booleans: "@", nulls: "@"}}));

// singleton warning
console.dir(await pl.queryOnce("x(X).", {program: "x(A) :- atom(B).", format: "json"}), {depth: null});
// TODO: this reports the last module loaded as the error location which is kinda confusing
console.dir(await pl.queryOnce("syntax error :-", {format: "prolog"}), {depth: null});

console.dir(await pl.queryOnce("write(X), nl, write(Y), nl, write(Z).", {
  bind: {"X": 123, "Y": atom`hello`, "Z": new Compound("mortal", ["socrates"])}
}));


const got = (await pl.queryOnce("write(X), X=Y, Z=abc(def(xx, 123), Q), dif(W,T).", {})).answer;
for (const [k, v] of Object.entries(got)) {
  console.dir({key: k, val: v, pl: v.toProlog()}, {depth: null});
}

const greeting = await pl.queryOnce('format("hello ~a", [X])', {bind: {X: atom`world`}});
console.log(greeting.stdout); // "hello world"

async function dumpQuery(query) {
  for await (const answer of query) {
    console.log(answer);
    if (answer.error) {
      console.log(JSON.stringify(answer));
    }
  }
}