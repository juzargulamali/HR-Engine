# ENGINIOUS OS design preview: browser checks

Scripts that exercise the design preview in a real browser. They are not part of CI: they need a running preview.

```bash
cd apps/web
OS_PREVIEW_ENABLED=1 npx next build && OS_PREVIEW_ENABLED=1 npx next start -p 3100

node os-preview-checks/interactions.mjs   # ~195 checks; prints FAIL lines and a total
node os-preview-checks/axe.mjs            # accessibility scan of every page, desktop/mobile, dark/light
node os-preview-checks/axe-states.mjs     # accessibility scan with dialogs, menus and hints open
```

- `interactions.mjs` sets the browser clock to 2031 on purpose (the preview must use its own fixed sample time), records every
  network request and fails if any is not a GET to localhost (so no prototype action writes data or calls an external host).
- The preview is hidden when `VERCEL_ENV=production`; build with that to confirm every `/os-preview` route returns 404.
