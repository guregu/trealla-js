const fs = require('fs');

// is there a better way to do this?
const def = fs.readFileSync("dist-unbundled/index.d.ts")
	.toString()
	.replace(`declare module "trealla"`, `declare module "trealla/unbundled"`);
fs.writeFileSync("dist-unbundled/index.d.ts", def);
