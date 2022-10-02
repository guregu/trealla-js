import { load, Prolog } from '../trealla.js';

await load();

// create new Prolog interpreter
const pl = new Prolog({
  library: "/lib", // optionally specify library directory ("/library" by default)
  env: {
    // environment variables (grab them with getenv/2)
    GREET: 'greetings'
  }
});

console.dir(
	await pl.queryOnce(`time(js_eval_json("return console.log('hello from js'), {\\"kaglloie\\":\\"abc\\"}", X)).`, {format: "prolog"}), {depth: null});

console.dir(
	await pl.queryOnce(`js_eval_json("return new Date()", X).`, {format: "prolog"}), {depth: null});