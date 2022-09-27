# trealla-js

Javascript bindings for [Trealla Prolog](https://github.com/trealla-prolog/trealla) via [wasmer-js](https://github.com/wasmerio/wasmer-js).

**Demo**: https://php.energy/trealla.html

WIP :-)

## TODO:
- [x] ~~Keep interpreter instances alive instead of using a fresh one for each query~~ [#1](https://github.com/guregu/trealla-js/issues/1)
- [x] ~~Make query responses a generator instead of findalling them~~ [#3](https://github.com/guregu/trealla-js/issues/3)

## Get
- [`https://esm.sh/trealla`](https://esm.sh/)
- [`npm install trealla`](https://www.npmjs.com/package/trealla)

## Example

```html
<script type="module">
import { loadFromWAPM, Prolog } from 'https://esm.sh/trealla';

// load the Trealla binary from WAPM.io, make sure to use the latest version!
// see: https://wapm.io/guregu/trealla
await loadFromWAPM("0.4.1");
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
  "answers": {"X": 2, "Y": 4}
}
// ...
```

## API
Currently unstable.

```typescript
function load(module: WebAssembly.Module): Promise<void>;
function loadFromWAPM(version: string): Promise<void>;

class Prolog {
  constructor(options?: PrologOptions);

  public init(): Promise<void>;
  public query(goal: string, script?: string): AsyncGenerator<Answer, void, void>;
  public consult(filename: string): Promise<void>;

  public readonly fs: any; // wasmer-js filesystem
}

interface PrologOptions {
  library?: string; // library files path (default: "/library")
  module?: WebAssembly.Module; // manually specify module instead of the default (make sure wasmer-js is initialized first)
}

interface Answer {
  result: "success" | "failure" | "error";
  answer?: Solution;
  error?: Term;
  output: string; // stdout text
}

type Solution = Record<string, Term>;

type Term = Compound | Variable | string | number;

interface Compound {
  functor: string;
  args: Term[];
}

interface Variable {
  var: string;
}
```