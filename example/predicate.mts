import { load, Prolog, Predicate, Compound, Variable, isNumber, type_error } from '../src';
await load();

const pl = new Prolog();

export const betwixt_3 = new Predicate<Compound<"betwixt", [number, number, number | Variable]>>(
    "betwixt", 3,
    async function*(_pl, _subquery, goal) {
        const [min, max, n] = goal.args;
        if (!isNumber(min))
            throw type_error("number", min, goal.pi);
        if (!isNumber(max))
            throw type_error("number", max, goal.pi);

        for (let i = isNumber(n) ? n : min; i <= max; i++) {
            goal.args[2] = i;
            if (i == max)
                return goal;
            yield goal;
        }
    });

await pl.register(betwixt_3);

for await (const x of pl.query(`betwixt(1,5,N).`, {format: "json"})) {
	console.log(x);
}

/*
{ status: 'success', answer: { N: 1 } }
{ status: 'success', answer: { N: 2 } }
{ status: 'success', answer: { N: 3 } }
{ status: 'success', answer: { N: 4 } }
{ status: 'success', answer: { N: 5 } }
*/
