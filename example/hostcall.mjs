import { load, Prolog } from '../trealla.js';

await load();

// create new Prolog interpreter
const pl = new Prolog();

console.dir(
	await pl.queryOnce(`time(js_eval_json("return console.log('hello from js'), {\\"hello\\":\\"abc\\"}", X)).`, {format: "prolog"}), {depth: null});

console.dir(
	await pl.queryOnce(`js_eval_json("return new Date()", X).`, {format: "prolog"}), {depth: null});