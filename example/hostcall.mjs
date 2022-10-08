import { load, Prolog } from '../trealla.js';

await load();

const pl = new Prolog();

console.dir(
	await pl.queryOnce(`time(js_eval_json("return console.log('hello from js'), {\\"hello\\":\\"abc\\"}", X)).`, {format: "prolog"}), {depth: null});

console.log(
	await pl.queryOnce(`fetch("https://httpbin.org/get", Content).`, {program: `
	:- use_module(library(format)).
	fetch(URL, Content) :-
	  phrase(format_("return fetch(~w).then(x => x.text());", [URL]), JS),
	  js_eval_json(JS, X), write(X).
	`, format: "prolog"}), {depth: null});

console.dir(
	await pl.queryOnce(`js_fetch("https://httpbin.org/post", Content, [as(json), body({"hello": "world"}), method(post), headers([foo-bar])]), write(Content), nl.`, {format: "prolog"}),
	{depth: null});

console.dir(
	await pl.queryOnce(`http_consult("https://raw.githubusercontent.com/guregu/worker-prolog/978c956801ffff83f190450e5c0325a9d34b064a/src/views/examples/fizzbuzz.pl"), fizzbuzz(1, 21).`),
	{depth: null});