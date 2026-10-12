// release versions as npm publishes them: major.minor.patch, with an optional prerelease that sorts below its release

export function compareVersions(a: string, b: string): number {
  const [coreA, preA] = split(a);
  const [coreB, preB] = split(b);
  for (let i = 0; i < 3; i++) {
    const diff = (coreA[i] ?? 0) - (coreB[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (preA === preB) return 0;
  if (preA === null) return 1;
  if (preB === null) return -1;
  return preA < preB ? -1 : 1;
}

function split(version: string): [number[], string | null] {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([^+]+))?/.exec(version.trim());
  if (!match) throw new Error(`${version} is not a version`);
  return [[Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)], match[4] ?? null];
}
