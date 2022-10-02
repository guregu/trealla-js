import { load, Prolog } from '../trealla.js';

await load();

// create new Prolog interpreter
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