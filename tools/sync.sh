#!/bin/sh
# Copy the shared form rules into the Apps Script project (edit assets/js/validate.js, then run this).
cd "$(dirname "$0")/.."
{ echo '/** Generated from assets/js/validate.js by tools/sync.sh. Edit that file, not this one. */'; cat assets/js/validate.js; } > apps-script/Validate.gs
echo "synced apps-script/Validate.gs"
