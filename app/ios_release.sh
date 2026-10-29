#!/bin/sh
# Hutka for the App Store, from a Mac with Xcode, in one go: the web files synced, the archive signed automatically for the Kozyra
# Media team, exported for the App Store and uploaded to App Store Connect. Needs an App Store Connect API key:
#   export ASC_KEY_ID=XXXXXXXXXX ASC_ISSUER_ID=xxxxxxxx-...        (the .p8 in ~/.appstoreconnect/private_keys/AuthKey_XXXXXXXXXX.p8)
#   export TEAM_ID=XXXXXXXXXX                                       (python3 asc.py bundle prints it)
#   sh ios_release.sh
# Then: python3 asc.py build --wait → python3 asc.py submit (asc.py metadata and screenshots go in before, once per version).
set -e
cd "$(dirname "$0")"
: "${ASC_KEY_ID:?set ASC_KEY_ID}"; : "${ASC_ISSUER_ID:?set ASC_ISSUER_ID}"; : "${TEAM_ID:?set TEAM_ID (python3 asc.py bundle prints it)}"
KEY="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}"
[ -f "$KEY" ] || { echo "no key at $KEY"; exit 1; }
command -v xcodebuild >/dev/null || { echo "Xcode is not installed (App Store → Xcode), or run: sudo xcode-select -s /Applications/Xcode.app"; exit 1; }
npm install --silent
sh build.sh
rm -rf build && mkdir -p build
AUTH="-allowProvisioningUpdates -authenticationKeyPath $KEY -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID"
echo "== archive"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath build/Hutka.xcarchive archive \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic $AUTH -quiet
echo "== export for the App Store"
xcodebuild -exportArchive -archivePath build/Hutka.xcarchive -exportOptionsPlist ios/App/ExportOptions.plist -exportPath build/export $AUTH -quiet
IPA=$(ls build/export/*.ipa | head -1); echo "ipa: $IPA ($(du -h "$IPA" | cut -f1))"
echo "== upload to App Store Connect"
xcrun altool --upload-app -t ios -f "$IPA" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"
echo "uploaded — Apple processes it in 10–30 minutes: python3 asc.py build --wait"
