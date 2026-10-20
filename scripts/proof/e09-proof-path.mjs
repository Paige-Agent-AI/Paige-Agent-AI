import path from 'node:path';

// A relative path handles filesystem-root ancestors, sibling prefixes and drives.
export function isProofDescendant(base, target, paths = path) {
  const relative = paths.relative(paths.resolve(base), paths.resolve(target));
  return relative !== '' && !paths.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith('..' + paths.sep);
}
