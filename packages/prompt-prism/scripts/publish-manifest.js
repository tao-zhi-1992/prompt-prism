const PRIVATE_WORKSPACE_DEPENDENCIES = new Set([
  '@prompt-prism/builtins',
  '@prompt-prism/core',
  '@prompt-prism/contracts',
]);

export function createPublishManifest(packageJson) {
  const manifest = { ...packageJson };
  if (packageJson.dependencies) {
    const dependencies = Object.fromEntries(
      Object.entries(packageJson.dependencies).filter(([name]) => !PRIVATE_WORKSPACE_DEPENDENCIES.has(name)),
    );
    if (Object.keys(dependencies).length > 0) manifest.dependencies = dependencies;
    else delete manifest.dependencies;
  }
  return manifest;
}
