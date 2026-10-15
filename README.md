# Singh Academy V60.15.3

Complete project source, not a patch. Read **UPLOADS-SETUP-V60.15.3.md** first, then
**LOCAL-GUIDE-V60.15.3.md**. **QA-REPORT-V60.15.3.md** separates executed tests from
external/provider/deployment acceptance still required.

## Targeted update

Only upload scanning is extended: existing private ClamAV remains supported, and
Cloudmersive HTTPS Virus Scan is available for managed Hostinger without a clamd endpoint.
No provider account/key is included and no subscription is purchased. Files remain in
private temporary storage until an explicit clean result. Rejection/outage/timeout/
malformed replies never fall back to unscanned permanent storage.

Payment/access/refund/authentication/video/certificate code and all original CSS/assets
are preserved (release labels apart). The user's already-approved accessible Team CI
selector is retained; the downloadable V60.15.2 base predated that one-line Git commit.

**A Cloudmersive account/API key and an appropriate file-size/quota plan are required
before enabling uploads.** Free evaluation covers small files only; see the setup guide.
All scanner credentials belong in backend environment variables, never NEXT_PUBLIC_*.

## Testing

Use a FRESH extracted folder; do not overlay this on old resource page files.
Copy only private `.env` files and reviewed backend/frontend `package-lock.json` files
from your working V60.15.2 copy. Do not copy old source, `.next` or `node_modules`.
Keep your supported Node 22.x or 24.x and working Docker installation.

```powershell
node -p "require('./package.json').version"
npm run verify:release
# Only after PASS, with Docker Engine running and normal app servers stopped:
npm run verify:integration
```

Expected version: `60.15.2`. The new candidate must pass BOTH commands end to end.
The ordinary local fixture-browser suite now declares 75 cases. The separate DB-backed
browser suite declares 46; the unchanged backend integration suite counts 77, with 12
schema-contract checks before Docker. Counts are expected targets, not reported results.

Approved public UI/CSS, original assets, certificates, videos, payment/access logic and
authentication are preserved. Full Next/Mongo/browser/online-advisory verification was not
available in the authoring environment; read the QA report rather than treating controlled
tests as full acceptance. Do not switch live keys before same-commit CI and staging approval.
