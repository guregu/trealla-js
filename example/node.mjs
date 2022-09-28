// quick & dirty test for local nodejs usage
// requires tpl.wasm in current dir

import { load, Prolog } from '../index.mjs';
import * as fs from 'node:fs';

await load(await WebAssembly.compile(fs.readFileSync("tpl.wasm")));

// create new Prolog interpreter
const pl = new Prolog({
  library: "/lib", // optionally specify library directory ("/library" by default)
});

// create a file in the virtual filesystem
pl.fs.open("/greeting.pl", { write: true, create: true }).writeString(`
  :- module(greeting, [hello/1]).
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
await pl.queryOnce("assertz(lang(prolog)), greeting:assertz(hello('Welt')).");

// run a query on the file we loaded and facts we asserted
await dumpQuery(
  pl.query(`use_module(greeting), hello(Planet), lang(Lang), format("hello ~w from ~w!~n", [Planet, Lang]).`));

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

// testing the optional "script" parameter which is consulted before the query is run
await dumpQuery(pl.query("🤠 howdy.", {
  script: `
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
await q1.return(); await q2.return(); // kill queries

async function dumpQuery(query) {
  for await (const answer of query) {
    console.log(answer);
    if (answer.error) {
      console.log(JSON.stringify(answer));
    }
  }
}