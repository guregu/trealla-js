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
:- dynamic(hello/1).
hello(world).
hello(世界).
`);

// custom library we can load from the use_module(library(...)) directive
pl.fs.createDir("/lib");
pl.fs.open("/lib/test.pl", { write: true, create: true }).writeString(`
library(ok).
`);

// consult the file we just created. "greeting" or "/greeting.pl" both work
await pl.consult("greeting");

// assert some dynamic facts
await pl.query("assertz(lang(prolog)), greeting:assertz(hello('Welt')).");

// run a query on the file we loaded and facts we asserted
console.log(
	await pl.query(`use_module(greeting), hello(Planet), lang(Lang), format("hello ~w from ~w!~n", [Planet, Lang]).`));

/*
{
  result: 'success',
  answers: [
    { Planet: 'world', Lang: 'prolog' },
    { Planet: '世界', Lang: 'prolog' },
    { Planet: 'Welt', Lang: 'prolog' }
  ],
  output: 'hello world from prolog!\nhello 世界 from prolog!\nhello Welt from prolog!\n'
}
*/

console.log(
  await pl.query("use_module(library(test)), library(Status)."));

/*
{ result: 'success', answers: [ { Status: 'ok' } ], output: '' }
*/