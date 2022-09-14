# trealla-js

Javascript bindings for [Trealla Prolog](https://github.com/trealla-prolog/trealla) via [wasmer-js](https://github.com/wasmerio/wasmer-js).

**Demo**: https://php.energy/trealla.html

WIP :-)

## Get

- `https://esm.sh/trealla`
- `npm install trealla`

## Example

```html
<script type="module">
import { loadFromWAPM, Prolog } from 'https://esm.sh/trealla';

// load the Trealla binary from WAPM.io, make sure to use the latest version!
// see: https://wapm.io/guregu/trealla
await loadFromWAPM("0.1.23");
// alternatively, host it yourself and use the load function instead of loadFromWAPM.

const pl = new Prolog();
const answers = await pl.query('between(1, 5, X), Y is X^2, format("(~w,~w)~n", [X, Y]).');
</script>
```

```json
{
  "output": "(1,1)\n(2,4)\n(3,9)\n(4,16)\n(5,25)\n",
  "result": "success",
  "answers": [
    {
      "X": 1,
      "Y": 1
    },
    {
      "X": 2,
      "Y": 4
    },
    {
      "X": 3,
      "Y": 9
    },
    {
      "X": 4,
      "Y": 16
    },
    {
      "X": 5,
      "Y": 25
    }
  ]
}
```
