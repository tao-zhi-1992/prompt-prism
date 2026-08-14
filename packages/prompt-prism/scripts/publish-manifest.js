const PRIVATE_WORKSPACE_PREFIX = '@prompt-prism/';

export function assertPublishManifest(packageJson) {
  for (const [name, specifier] of Object.entries(packageJson.dependencies ?? {})) {
    if (name.startsWith(PRIVATE_WORKSPACE_PREFIX)) {
      throw new Error(`Published dependencies must not include private workspace package ${name}`);
    }
    if (typeof specifier !== 'string' || specifier.startsWith('workspace:')) {
      throw new Error(`Published dependency ${name} must not use a workspace protocol`);
    }
  }
}
