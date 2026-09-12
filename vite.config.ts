import { defineConfig } from 'vite';

/**
 * GitHub Pages project sites are served from /<repo>/, so the build needs a
 * matching `base` or every asset 404s. Deriving it from GITHUB_REPOSITORY means
 * a repo created from this template just works under its own name — nothing to
 * edit, and no chance of shipping another project's path.
 *
 * Locally the variable is unset, so dev and preview stay at the root.
 */
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1];

export default defineConfig({
  base: repository ? `/${repository}/` : '/',
  build: {
    target: 'es2022',
  },
});
