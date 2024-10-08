import { load, Prolog } from '../trealla.js';

// Node needs the global crypto object defined.
// Exists already in browsers.
import crypto from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = crypto;

await load();

const pl = new Prolog();

console.dir(
	await pl.queryOnce(`time(js_eval_json("return console.log('hello from js'), {\\"hello\\":\\"abc\\"}", X)).`, {format: "prolog"}), {depth: null});

console.dir(
	await pl.queryOnce(`fetch("https://httpbin.org/get", Content).`, {program: `
	:- use_module(library(format)).
	:- use_module(library(dcgs)).
	:- use_module(library(pseudojson)).
	fetch(URL, Content) :-
	  json_chars(URL, Cs),
	  phrase(format_("return fetch(~s).then(x => x.text());", [Cs]), JS),
	  js_eval_json(JS, Content), write(Content).
	`, format: "prolog"}), {depth: null});

console.dir(
	await pl.queryOnce(`http_fetch("https://httpbin.org/post", Content, [as(json), body({"hello": "world"}), method(post), headers([foo-bar])]), write(Content), nl.`, {format: "prolog"}),
	{depth: null});

console.dir(
	await pl.queryOnce(`use_module(library(wasm_js)), http_consult(fizzbuzz:"https://raw.githubusercontent.com/guregu/worker-prolog/978c956801ffff83f190450e5c0325a9d34b064a/src/views/examples/fizzbuzz.pl"), use_module(fizzbuzz), fizzbuzz(1, 21).`, {format: "json"}),
	{depth: null});

for await (const x of pl.query(`between(1,3,N), once(phrase(format_("return ~w;", [N]), JS)), js_eval_json(JS, Got)`, {format: "json"})) {
	console.log(x);
}
for await (const x of pl.query(`between(1,3,N), once(phrase(format_("return new Promise((resolve) => resolve(~w))", [N]), JS)), js_eval_json(JS, Got)`, {format: "json"})) {
	console.log(x);
}

console.log(await pl.queryOnce(`crypto_data_hash("foo", Hash, [algorithm(Algo)]).`, {format: "prolog"}));
