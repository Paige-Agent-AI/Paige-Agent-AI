// Reuse the canonical isolated lifecycle fixture; enable only the additive cached-audio cases.
process.argv.push('--cached-audio');
await import('./operator-provider-retirement.mjs');
