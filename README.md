# trealla-js

Javascript bindings for [Trealla Prolog](https://github.com/trealla-prolog/trealla) via [wasmer-js](https://github.com/wasmerio/wasmer-js).

Trealla is a quick and lean ISO Prolog interpreter.

Trealla is built targeting [WASI](https://wasi.dev/) and should be useful for both browsers and serverless runtimes.

**Demo**: https://php.energy/trealla.html

**Status**: beta!

## Get

trealla-js embeds the Trealla WASM binary. Simply import the module, load it, and you're good to go.

### JS Modules

You can import Trealla directly from a CDN that supports ECMAScript Modules.

For now, it's best to pin a version as in: `https://esm.sh/trealla@X.Y.Z`.

```js
import { load, Prolog } from 'https://esm.sh/trealla';
import { load, Prolog } from 'https://esm.run/trealla';
import { load, Prolog } from 'https://unpkg.com/trealla';
import { load, Prolog } from 'https://cdn.skypack.dev/trealla';
```

### NPM

This package is [available on NPM](https://www.npmjs.com/package/trealla) as `trealla`.

```bash
npm install trealla
```

```js
import { load, Prolog } from 'trealla';
```

## Example

### Javascript to Prolog

```html
<!-- Make sure to use type="module" for inline scripts. -->
<script type="module">

import { Prolog, load, atom } from 'https://esm.sh/trealla';

// Load the runtime.
// This is requred before construction of any interpreters.
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

// Use the bind option to easily bind variables.
// You can bind strings as-is.
// Atoms can be quickly constructed with the atom template tag.
// See: Term type.
const greeting = await pl.queryOnce('format("hello ~a", [X])', {bind: {X: atom`world`}});
console.log(greeting.stdout); // "hello world"
console.log(greeting.answer.X); // Atom { functor: "world" }

</script>
```

```javascript
{
  "result": "success",
  "answer": {"X": 2, "Y": 4},
  "stdout": "(2,4)\n"
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
?- js_eval_json("return fetch('http://example.com').then(x => x.text());", Src).
   Src = "<html><head><title>Example page..."
```

`js_eval/2` works the same but does not attempt to parse the JSON.
If your JS expression returns a Uint8Array, it will be returned as-is instead of JSON-encoded.

```prolog
?- js_eval("return new TextEncoder().encode('arbitrary text');", Result)
   Result = "arbitrary text".
```

### Caveats

Multiple queries can be run concurrently. If you'd like to kill a query early, use the `return()` method on the generator returned from `query()`.
This is not necessary if you iterate through until it is finished.

### Output format

You can change the output format with the `format` option in queries.

The format is `"json"` by default which goes through `library(js)` and returns JSON-friendly Javascript objects (see: type `Term`).

### `"prolog"` format

You can get pure text output with the `"prolog"` format.
The output is the same as Trealla's regular toplevel, but full terms (with a dot) are printed.

```javascript
for await (const answer of pl.query(`dif(A, B) ; dif(C, D).`, {format: "prolog"})) {
  console.log(answer);
};
// "dif(A,B)."
// "dif(C,D)."
```

### Automatic yielding

By default, the interpreter will yield every 20ms to let the UI thread catch up.
This prevents long-running queries from freezing the browser, but incurs a small (~20%) overhead.
You can disable this behavior by setting the query option `autoyield` to `0`.

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
  /** Call this first to load the runtime.
    Must be called before any interpreters are constructed. */
  function load(): Promise<void>;

  /** Prolog interpreter.
    Each interpreter is independent, having its own knowledgebase and virtual filesystem.
    Multiple queries can be run against one interpreter simultaneously. */
  class Prolog {
    constructor(options?: PrologOptions);

    /** Run a query. This is an asynchronous generator function.
      Use a `for await` loop to easily iterate through results.
      Exiting the loop will automatically destroy the query and reclaim memory.
      If manually iterating with `next()`, call the `return()` method of the generator to kill it early.
      Runtimes that support finalizers will make a best effort attempt to kill live but garbage-collected queries. */
    public query<T = Answer>(goal: string, options?: QueryOptions): AsyncGenerator<T, void, void>;
    /** Runs a query and returns a single solution, ignoring others. */
    public queryOnce<T = Answer>(goal: string, options?: QueryOptions): Promise<T>;

    /** Consult (load) a Prolog file with the given filename. */
    public consult(filename: string): Promise<void>;
    /** Consult (load) a Prolog file with the given text content. */
    public consultText(text: string | Uint8Array): Promise<void>;

    /** Use fs to manipulate the virtual filesystem. */
    public readonly fs: any; /** wasmer-js filesystem */
  }

  interface PrologOptions {
    /** Library files path (default: "/library")
      This is to set the search path for use_module(library(...)). */
    library?: string;
    /** Environment variables.
      Accessible with the predicate getenv/2. */
    env?: Record<string, string>;
    /** Quiet mode. Disables warnings printed to stderr if true. */
    quiet?: boolean;
    /** Manually specify module instead of the default. */
    module?: WebAssembly.Module;
  }

  interface QueryOptions {
    /** Mapping of variables to bind in the query. */
    bind?: Substitution;
    /** Prolog program text to evaluate before the query. */
    program?: string | Uint8Array;
    /** Answer format. This changes the return type of the query generator.
      `"json"` (default) returns Javascript objects.
      `"prolog"` returns the standard Prolog toplevel output as strings.
      You can add custom formats to the global `FORMATS` object.
      You can also pass in a `Toplevel` object directly. */
    format?: keyof typeof FORMATS | Toplevel<any, any>;
    /** Encoding options for "json" or custom formats. */
    encode?: EncodingOptions;
    /** Automatic yield interval in milliseconds. Default is 20ms. */
    autoyield?: number;
  }

  type EncodingOptions = JSONEncodingOptions | PrologEncodingOptions | Record<string, unknown>;

  interface JSONEncodingOptions {
    /** Encoding for Prolog atoms. Default is "object". */
    atoms?: "string" | "object";
    /** Encoding for Prolog strings. Default is "string". */
    strings?: "string" | "list";

    /** Functor for compounds of arity 1 to be converted to booleans.
      For example, `"{}"` to turn the Prolog term `{true}` into true ala Tau,
      or `"@"` for SWI-ish behavior that uses `@(true)`. */
    booleans?: string;
    /** Functor for compounds of arity 1 to be converted to null.
      For example, `"{}"` to turn the Prolog term `{null}` into null`. */
    nulls?: string;
    /** Functor for compounds of arity 1 to be converted to undefined.
      For example, `"{}"` to turn the Prolog term `{undefined}` into undefined`. */
    undefineds?: string;
  }

  interface PrologEncodingOptions {
    /** Include the fullstop "." in results. */
    /** True by default. */
    dot?: boolean;
  }

  /** Answer for the "json" format. */
  interface Answer {
    result: "success" | "failure" | "error";
    answer?: Substitution;
    error?: Term;
    /** Standard output text (`user_output` stream in Prolog) */
    stdout?: string;
    /** Standard error text (`user_error` stream in Prolog) */
    stderr?: string;
  }

  /** Mapping of variable name → Term substitutions. */
  type Substitution = Record<string, Term>;

  /** Prolog term.
    Default encoding (in order of priority):
    string(X)   → string
    is_list(X)  → List
    atom(X)     → Atom
    compound(X) → Compound
    integer(X)  → BigInt if necessary
    number(X)   → number
    var(X)      → Variable
  */
  type Term = Atom | Compound | Variable | List | string | number | BigInt;

  type List = Term[];

  class Atom {
    constructor(functor: string);
    functor: string;
    /** Predicate indicator (example: `"foo/0"`) */
    readonly pi: string;
    toProlog(): string;
  }

  /** String template literal for making atoms: atom`foo` = 'foo'. */
  function atom([functor]): Atom;

  class Compound {
    constructor(functor: string, args: List);
    functor: string;
    args: List;
    /** Predicate indicator (in `"foo/N"` format) */
    readonly pi: string;
    toProlog(): string;
  }

  class Variable {
    constructor(name: string, attr: List);
    /** Variable name. */
    var: string;
    /** Residual goals. */
    attr?: List;
    toProlog(): string;
  }

  /** Convert Term objects to their Prolog text representation. */
  function toProlog(object: Term): string;

  /** Parse JSON representations of terms. */
  function fromJSON(json: string, options?: JSONEncodingOptions): Term;

  /** Convert Term objects to JSON text. */
  function toJSON(term: Term, indent?: string): string;

  const FORMATS: {
    json: Toplevel<Answer, JSONEncodingOptions>,
    prolog: Toplevel<string, PrologEncodingOptions>,
    // add your own!
    // [name: string]: Toplevel<any, any>
  };

  interface Toplevel<T, Options> {
    /** Prepare query string, returns goal to execute. */
    query(pl: Prolog, goal: string, bind?: Substitution, options?: Options): string;
    /** Parse stdout and return an answer. */
    parse(pl: Prolog, status: boolean, stdout: Uint8Array, stderr: Uint8Array, options?: Options): T;
    /** Yield simple truth value, when output is blank.
      For queries such as `true.` and `1=2.`.
      Return null to bail early and yield no values. */
    truth(pl: Prolog, status: boolean, stderr: Uint8Array, options?: Options): T | null;
  }
}
```


# Predicate reference

trealla-js includes [all libraries bundled with Trealla](https://github.com/guregu/trealla/tree/main/library).
Import a library module with the `use_module(library(Name))` directive or predicate.

The predicates described below are imported by default.

## Specialized built-ins

These predicates are Trealla built-ins specialized for a Javascript execution environment.

### crypto_data_hash/3

Hashes the given string and options. Calls into the global [`crypto`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest) object.

```prolog
%! crypto_data_hash(+Data, -Hash, +Options) is det.
%  Unifies Hash with a hashed hex string representation of Data, which is a string.
%  Options is a list of options:
%  - algorithm(Algorithm): Algorithm is an atom representing the hash algorithm to use.
%    One of: sha256 (default), sha386, sha512, sha1 (insecure).
crypto_data_hash(Data, Hash, Options).
```

This will only work in secure contexts (i.e. over HTTPS) in browsers. Node users may need to set the global crypto object.

```js
import crypto from "node:crypto";
globalThis.crypto = crypto;
```

### sleep/1

Sleeps for the given amount of seconds. This yields to the host, unblocking the main thread for the duration.

```prolog
%! sleep(+N) is det.
%  Sleep for N seconds. N is an integer.
sleep(Seconds).
```

## library(wasm_js)

Module `library(wasm_js)` is autoloaded. It provides predicates for calling into the host.

### http_consult/1

Load Prolog code from URL.

```prolog
%! http_consult(+URL) is det.
%  Downloads Prolog code from URL, which must be a string, and consults it.
http_consult(URL).
```

### http_fetch/3

Fetch content from a URL.

```prolog
%! http_fetch(+URL, +Options, -Content) is det.
%  Fetch URL (string) and unify the result with Content.
%  This is a friendly wrapper around Javascript's fetch API.
%  Options is a list of options:
%  - as(string): Content will be unified with the text of the result as a string
%  - as(json): Content will be parsed as JSON and unified with a JSON term
%  - headers(["key"-"value", ...]): HTTP headers to send
%  - body(Cs): body to send (Cs is string)
http_fetch(URL, Options, Content).
```

### js_eval_json/2

Evaluate a string of Javascript code. Code is evaluated using [`Function`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/Function) and only has access to the global envrionment.

```prolog
%! js_eval_json(+Code, -JSON) is det.
%  Evaluate Code, which must be a string of valid Javascript code.
%  Returning a promise will cause the query to yield to the host. The host will await the promise and resume the query.
%  Return values are encoded to JSON and returned as a JSON term (see pseudojson:json_value/2).
js_eval_json(Code, JSON).
```

### js_eval/2

Low-level predicate for evaluating JS code.

```prolog
%! js_eval(+Code, -Cs) is det.
%  Low-level predicate that functions the same as js_eval_json/2 but without the JSON decoding.
%  Returning a Uint8Array in your JS code will bypass the host's default JSON encoding.
%  Combined with this, you can customize the host->guest API.
js_eval(Code, Cs).
```

## library(pseudojson)

Module `library(pseudojson)` is preloaded. It provides very fast predicates for encoding and decoding JSON.
Its One Crazy Trick is using regular Prolog terms such as `{"foo":"bar"}` for reading/writing.
This means that it accepts invalid JSON that is a valid Prolog term.

The predicate `json_value/2` converts between the same representation of JSON values as `library(json)`, to ensure future compatibility.
You are free to use `library(json)` which provides a JSON DCG that properly validates (but is slow for certain inputs).

### json_chars/2

Encoding and decoding of JSON strings.

```prolog
%! json_chars(?JSON, ?Cs) is det.
%  JSON is a Prolog term representing the JSON.
%  Cs is a JSON string.
json_chars(JSON, Cs).
```

### json_value/2

Relates JSON terms and friendlier Value terms that are compatible with `library(json)`.

- strings: `string("abc")`
- numbers: `number(123)`
- booleans: `boolean(true)`
- objects: `pairs([string("key")-Value, ...])`
- arrays: `list([...])`

```prolog
%! json_value(?JSON, ?Value) is det.
%  Unifies JSON and Value with their library(pseudojson) and library(json) counterparts.
%  Can be used to convert between JSON terms and friendlier Value terms.
json_value(JSON, Value).
```

## Implementation Details

Currently uses the WASM build from [guregu/trealla](https://github.com/guregu/trealla).
JSON output goes through the [`wasm`](https://github.com/guregu/trealla/blob/main/library/wasm.pl) module.

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
