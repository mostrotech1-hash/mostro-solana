// Vercel function entry. `yarn deploy:vercel` bundles src/vercel.ts (with every dependency) into dist/vercel.js.
module.exports = require("../server/vercel.js").default;
