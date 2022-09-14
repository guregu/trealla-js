# trealla-js

Javascript bindings for [Trealla Prolog](https://github.com/trealla-prolog/trealla) via [wasmer-js](https://github.com/wasmerio/wasmer-js).

**Demo**: https://php.energy/trealla.html

WIP :-)

## TODO:
- [ ] Keep interpreter instances alive instead of using a fresh one for each query [#1](https://github.com/guregu/trealla-js/issues/1)

## Get
- [`https://esm.sh/trealla`](https://esm.sh/)
- [`npm install trealla`](https://www.npmjs.com/package/trealla)

## Example

```html
<script type="module">
import { loadFromWAPM, Prolog } from 'https://esm.sh/trealla';

// load the Trealla binary from WAPM.io, make sure to use the latest version!
// see: https://wapm.io/guregu/trealla
await loadFromWAPM("0.1.27");
// alternatively, host it yourself and use the load function instead of loadFromWAPM:
// await load(await WebAssembly.compileStreaming(fetch("https://example.com/foo/bar/tpl.wasm"));

const pl = new Prolog();
const answers = await pl.query('between(1, 5, X), Y is X^2, format("(~w,~w)~n", [X, Y]).');
</script>
```

```javascript
{
  "output": "(1,1)\n(2,4)\n(3,9)\n(4,16)\n(5,25)\n", // stdout output text
  "result": "success", // can also be "failure" when no answers were found, or "error" when an exception was thrown
  "answers": [{"X": 1, "Y": 1},{"X": 2, "Y": 4},{"X": 3, "Y": 9},{"X": 4, "Y": 16},{"X": 5, "Y": 25}]
}
```

## API
Currently unstable.

```typescript
function load(module: WebAssembly.Module): Promise<void>;
function loadFromWAPM(version: string): Promise<void>;

class Prolog {
  constructor();
  
  public init(module?: WebAssembly.Module): Promise<void>;
  public query(goal: string, script?: string): Promise<Answer>;

  public readonly fs: any; // wasmer-js filesystem
}

interface Answer {
  result: "success" | "failure" | "error";
  answers?: Solution[];
  error?: Term;
  output: string; // stdout text
}

type Solution = Record<string, Term>;

type Term = Compound | string | number;

interface Compound {
  functor: string;
  args: Term[];
}
```