# trealla-js

Javascript bindings for [Trealla Prolog](https://github.com/trealla-prolog/trealla) via [wasmer-js](https://github.com/wasmerio/wasmer-js).

Trealla is a quick and lean ISO Prolog interpreter.

Trealla is built targeting [WASI](https://wasi.dev/) and should be useful for both browsers and serverless runtimes.

**Demo**: https://php.energy/trealla.html

**Status**: beta!

## Get
- [`https://esm.sh/trealla`](https://esm.sh/)
- [`npm install trealla`](https://www.npmjs.com/package/trealla)

## Example

### Javascript to Prolog

```html
<script type="module">
import { load, Prolog } from 'https://esm.sh/trealla';

// Load the runtime.
await load();

// Create a new Prolog interpreter
// Each interpreter is independent and persistent 
const pl = new Prolog();

// Queries are async generators.
// You can run multiple queries against the same interpreter simultaneously.
const query = pl.query('between(2, 10, X), Y is X^2, format("(~w,~w)~n", [X, Y]).');
for await (const answer of query) {
  console.log(answer);
}
</script>
```

```javascript
{
  "output": "(2,4)\n",
  "result": "success",
  "answer": {"X": 2, "Y": 4}
}
// ...
```

### Prolog to Javascript

Experimental. With great power comes great responsibility 🤠

The JS host will evaluate the expression you give it and marshal it to JSON.
You can use `js_eval_json/2` to grab the result.
Note that JSON does not handle all types such as `undefined`.

```prolog
greet :-
  js_eval_json("return prompt('Name?');", Name),
  format("Greetings, ~s.", [Name]).

here(URL) :-
  js_eval_json("return location.href;", URL).
% URL = "https://php.energy/trealla.html"
```

If your evaluated code returns a promise, Prolog will yield to the host to evaluate the promise.
Hopefully this should be transparent to the user.

```prolog
?- js_eval_json("fetch('http://example.com').then(x => x.text());", Src).
   Src = "<html><head><title>Example page..."
```

`js_eval/2` works the same but does not attempt to parse the JSON.
If your JS expression returns a Uint8Array, it will be returned as-is instead of JSON-encoded.

```prolog
?- js_eval("return new TextEncoder().encode('arbitrary text');", Result)
   Result = "arbitrary text".
```

#### JS Predicates

```prolog
js_eval_json(+Code, -Return).
js_eval(+Code, -Cs).
http_consult(+URL).
js_fetch(+URL, +Options, -Result).
```

### Caveats

Multiple queries can be run concurrently. If you'd like to kill a query early, use the `return()` method on the generator returned from `query()`.
This is not necessary if you iterate through until it is finished.

### Output format

You can change the output format with the `format` option in queries.

The format is `"json"` by default which goes through `library(js_toplevel)` and returns JSON objects.

### `"prolog"` format

You can get pure text output with the `"prolog"` format.
The output is the same as Trealla's regular toplevel, but full terms (with a dot) are printed.

```javascript
for await (const answer of pl.query(`dif(A, B) ; dif(C, D).`, {format: "prolog"})) {
  console.log(answer);
};
// "dif:dif(A,B)."
// "dif:dif(C,D)."
```

### Virtual Filesystem

Each Prolog interpreter instance has its own virtual filesystem you can read and write to.
For details, check out the [wasmer-js docs](https://github.com/wasmerio/wasmer-js#typescript-api).

```js
const pl = new Prolog();
// create a file in the virtual filesystem
pl.fs.open("/greeting.pl", { write: true, create: true }).writeString(`
  :- module(greeting, [hello/1]).
  hello(world).
  hello(世界).
`);

// consult file
await pl.consult("/greeting.pl");

// use the file we added
const query = pl.query("use_module(greeting), hello(X)");
for await (const answer of query) {
  console.log(answer); // X = world, X = 世界
}
```

## Javascript API
Approaching stability.

```typescript
declare module 'trealla' {
  function load(): Promise<void>;

  class Prolog {
    constructor(options?: PrologOptions);

    public query<T = Answer>(goal: string, options?: QueryOptions): AsyncGenerator<T, void, void>;
    public queryOnce<T = Answer>(goal: string, options?: QueryOptions): Promise<T>;

    public consult(filename: string): Promise<void>;
    public consultText(text: string | Uint8Array): Promise<void>;
    
    public readonly fs: any; // wasmer-js filesystem
  }

  interface PrologOptions {
    // Library files path (default: "/library")
    // This is for use_module(library(...)).
    library?: string;
    // Environment variables.
    // Accessible with the predicate getenv/2.
    env?: Record<string, string>;
  }

  interface QueryOptions {
    // Prolog program text to evaluate before the query.
    program?: string | Uint8Array;
    // Answer format. This changes the return type of the query generator.
    // "json" (default) returns Javascript objects.
    // "prolog" returns the standard Prolog toplevel output as strings.
    // You can add custom formats to the global FORMATS object.
    // You can also pass in a Toplevel object directly.
    format?: keyof typeof FORMATS | Toplevel<any, any>;
    // Encoding options for "json" or custom formats.
    encode?: EncodingOptions;
  }

  type EncodingOptions = JSONEncodingOptions | PrologEncodingOptions | Record<string, unknown>;

  interface JSONEncodingOptions {
    // Encoding for Prolog atoms. Default is "object".
    atoms?: "string" | "object";
    // Encoding for Prolog strings. Default is "string".
    strings?: "string" | "list";
  }

  interface PrologEncodingOptions {
    // Include the fullstop "." in results.
    // True by default.
    dot?: boolean;
  }

  // Answer for the "json" format.
  interface Answer {
    result: "success" | "failure" | "error";
    answer?: Solution;
    error?: Term;
    output: string; // stdout text
  }

  // Mapping of variable name → Term substitutions.
  type Solution = Record<string, Term>;

  /*
    Default encoding (in order of priority):
    string(X)   → string
    is_list(X)  → List
    atom(X)     → Atom
    compound(X) → Compound
    number(X)   → number
    var(X)      → Variable
  */
  type Term = Atom | Compound | Variable | List | string | number;

  interface Atom {
    functor: string;
  }

  interface Compound {
    functor: string;
    args: List;
  }

  interface Variable {
    var: string; // variable name
    attr?: List; // residual goals
  }

  type List = Term[];

  const FORMATS: {
    json: Toplevel<Answer, JSONEncodingOptions>,
    prolog: Toplevel<string, PrologEncodingOptions>,
    // add your own!
    // [name: string]: Toplevel<any, any>
  };

  interface Toplevel<T, Options> {
    // Prepare query string, returns goal to execute.
    query(pl: Prolog, goal: string, options?: Options): string;
    // Parse stdout and return an answer.
    parse(pl: Prolog, stdout: Uint8Array, stderr: Uint8Array, options?: Options): T;
    // Yield simple truth value, when output is blank.
    // For queries such as `true.` and `1=2.`.
    // Return null to bail early and yield no values.
    truth(pl: Prolog, status: boolean, options?: Options): T | null;
  }
}
```

## Implementation Details

Currently uses the WASM build from [guregu/trealla](https://github.com/guregu/trealla).
Output goes through the [`js`](https://github.com/guregu/trealla/blob/main/library/js.pl) module.

### Development

Make sure you can build Trealla.

```bash
# install deps
npm install
# build wasm
npm run compile
# build js
npm run build
# "test"
node examples/node.mjs
```

## See Also

- [trealla-prolog/go](https://github.com/trealla-prolog/go) is Trealla for Go.
- [Tau Prolog](http://www.tau-prolog.org/) is a pure Javascript Prolog.
- [SWI Prolog](https://swi-prolog.discourse.group/t/swi-prolog-in-the-browser-using-wasm/5650) has a WASM implementation using Emscripten.
- [Ciao](https://github.com/ciao-lang/ciaowasm) has a WASM implementation using Emscripten.
