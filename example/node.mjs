// quick & dirty test for local nodejs usage
// requires tpl.wasm in current dir

import { load, Prolog } from '../index.mjs';
import * as fs from 'node:fs';

await load(await WebAssembly.compile(fs.readFileSync("tpl.wasm")));

// create new Prolog interpreter
const pl = new Prolog();

pl.fs.open("/test.pl", { read: true, write: true, create: true }).writeString(`
:- dynamic(hello/1).
hello(world).
hello(世界).`);

await pl.consult("test");
await pl.query("assertz(lang(prolog)).");
console.log(
	await pl.query(`hello(Planet), lang(Lang), format("hello ~w from ~w!~n", [Planet, Lang]).`));

/*
{
  result: 'success',
  answers: [
    { Planet: 'world', Lang: 'prolog' },
    { Planet: '世界', Lang: 'prolog' }
  ],
  output: 'hello world from prolog!\nhello 世界 from prolog!\n'
}
*/