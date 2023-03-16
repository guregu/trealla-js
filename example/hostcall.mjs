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
	fetch(URL, Content) :-
	  phrase(format_("return fetch(~w).then(x => x.text());", [URL]), JS),
	  js_eval_json(JS, Content), write(Content).
	`, format: "prolog"}), {depth: null});

console.dir(
	await pl.queryOnce(`http_fetch("https://httpbin.org/post", Content, [as(json), body({"hello": "world"}), method(post), headers([foo-bar])]), write(Content), nl.`, {format: "prolog"}),
	{depth: null});

console.dir(
	await pl.queryOnce(`http_consult("https://raw.githubusercontent.com/guregu/worker-prolog/978c956801ffff83f190450e5c0325a9d34b064a/src/views/examples/fizzbuzz.pl"), fizzbuzz(1, 21).`, {format: "json"}),
	{depth: null});

for await (const x of pl.query(`between(1,3,N), once(phrase(format_("return ~w;", [N]), JS)), js_eval_json(JS, Got)`, {format: "json"})) {
	console.log(x);
}
for await (const x of pl.query(`between(1,3,N), once(phrase(format_("return new Promise((resolve) => resolve(~w))", [N]), JS)), js_eval_json(JS, Got)`, {format: "json"})) {
	console.log(x);
}

for await (const x of pl.query(`betwixt(1,3,N).`, {format: "json"})) {
	console.log(x);
}

console.log(await pl.queryOnce(`crypto_data_hash("foo", Hash, [algorithm(Algo)]).`, {format: "prolog"}));