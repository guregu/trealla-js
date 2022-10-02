import { load, Prolog } from '../trealla.js';

await load();

// create new Prolog interpreter
const pl = new Prolog();

// async fetch a page
console.log(await pl.queryOnce(`js_eval_json("return fetch('http://example.com').then(x => x.text());", Text)`));

for await (const answer of pl.query(`js_eval_json("return new Promise(() => { throw 'abc' });", Text)`, {format: "prolog"})) {
	console.log(answer);
};

console.log(await pl.queryOnce(`js_eval("return new TextEncoder().encode('arbitrary text');", Result)`, {format: "prolog"}));
