# SOBA Agent Docs Deployment

The public documentation site is deployed from `docs-site/` to GitHub Pages with the `Docs Pages` workflow.

## GitHub Pages

1. Open repository settings: `Settings` -> `Pages`.
2. Under `Build and deployment`, set `Source` to `GitHub Actions`.
3. Run the `Docs Pages` workflow from the `Actions` tab, or push a change under `docs-site/`.

The workflow builds the static client bundle and deploys `docs-site/dist/client`.

## Custom Domain

Set the custom domain in `Settings` -> `Pages` -> `Custom domain`.

For a subdomain such as `docs.example.com`, create a DNS `CNAME` record:

```text
docs.example.com -> avacadorun-dev.github.io
```

For an apex domain such as `example.com`, create GitHub Pages `A` records for `@`:

```text
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Optionally create an `AAAA` record set for IPv6 according to the current GitHub Pages documentation.

After DNS propagates, enable `Enforce HTTPS` in the repository Pages settings.
