import fc from 'fast-check'

// Every property is tried against 200 random cases. A failure prints the seed that reproduces it.
// For a deeper hunt: NEXO_PROPERTY_RUNS=5000 npm run test
const runs = Number(process.env.NEXO_PROPERTY_RUNS ?? 200)

fc.configureGlobal({ numRuns: Number.isInteger(runs) && runs > 0 ? runs : 200 })
