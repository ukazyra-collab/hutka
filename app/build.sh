#!/bin/sh
# Hutka app: refresh the bundled web files (the offline page always; the whole site when the app is switched to bundled mode —
# no "server.url" in capacitor.config.json), then sync the native iOS / Android projects. Run after "npm install".
set -e
cd "$(dirname "$0")"
mkdir -p www
for f in index.html config.js supabase.js auth-link.js geo.txt manifest.webmanifest logo.png icon-192.png icon-512.png privacy.html; do [ -f "../$f" ] && cp "../$f" www/; done
npx cap sync
echo "synced. iOS: npx cap open ios · Android: npx cap open android"
