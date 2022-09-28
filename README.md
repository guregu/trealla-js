# trealla-js

Javascript bindings for [Trealla Prolog](https://github.com/trealla-prolog/trealla) via [wasmer-js](https://github.com/wasmerio/wasmer-js) and WASI.

**Demo**: https://php.energy/trealla.html

**Status**: beta!

## Get
- [`https://esm.sh/trealla`](https://esm.sh/)
- [`npm install trealla`](https://www.npmjs.com/package/trealla)

## Example

```html
<script type="module">
import { loadFromWAPM, Prolog } from 'https://esm.sh/trealla';

// load the Trealla binary from WAPM.io, make sure to use the latest version!
// see: https://wapm.io/guregu/trealla
await loadFromWAPM("0.5.1");
// alternatively, host it yourself and use the load function instead of loadFromWAPM:
// await load(await WebAssembly.compileStreaming(fetch("https://example.com/foo/bar/tpl.wasm"));

// each interpreter is independent and persistent 
const pl = new Prolog();

// queries are async generators
const query = pl.query('between(1, 5, X), Y is X^2, format("(~w,~w)~n", [X, Y]).');
for await (const answer of query) {
  console.log(answer);
}
</script>
```

```javascript
{
  "output": "(1,1)\n", // stdout output text
  "result": "success", // can also be "failure" when no answers were found, or "error" when an exception was thrown
  "answer": {"X": 1, "Y": 1}
}
{
  "output": "(2,4)\n",
  "result": "success",
  "answer": {"X": 2, "Y": 4}
}
// ...
```

### Caveats

Multiple queries can be run concurrently. If you'd like to kill a query early, use the `return()` method on the generator returned from `query()`.
This is not necessary if you iterate through until it is finished.

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

## API
Approaching stability.

```typescript
declare module 'trealla' {
  function load(module: WebAssembly.Module): Promise<void>;
  function loadFromWAPM(version: string): Promise<void>;

  class Prolog {
    constructor(options?: PrologOptions);

    public query(goal: string, options?: QueryOptions): AsyncGenerator<Answer, void, void>;
    public queryOnce(goal: string, options?: QueryOptions): Promise<Answer>;

    public consult(filename: string): Promise<void>;
    public consultText(text: string | Uint8Array): Promise<void>;
    
    public readonly fs: any; // wasmer-js filesystem
  }

  interface PrologOptions {
    library?: string;            // library files path (default: "/library")
    module?: WebAssembly.Module; // manually specify module instead of the default (make sure wasmer-js is initialized first)
  }

  interface QueryOptions {
    script?: string;
  }

  interface Answer {
    result: "success" | "failure" | "error";
    answer?: Solution;
    error?: Term;
    output: string; // stdout text
  }

  type Solution = Record<string, Term>;

  type Term = Compound | Variable | string | number | Term[];

  interface Compound {
    functor: string;
    args: Term[];
  }

  interface Variable {
    var: string;
  }
}
```

## See Also

- [trealla-prolog/go](https://github.com/trealla-prolog/go) is Trealla for Go.
- [Tau Prolog](http://www.tau-prolog.org/) is a pure Javascript Prolog.
- [SWI Prolog](https://swi-prolog.discourse.group/t/swi-prolog-in-the-browser-using-wasm/5650) has a WASM implementation using Emscripten.
- [Ciao](https://github.com/ciao-lang/ciaowasm) has a WASM implementation using Emscripten.
