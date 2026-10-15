#!/bin/sh
# A cable build with a free Apple ID (Personal Team), before the paid Kozyra Media account exists:
#  - a separate bundle id (ai.hutka.dev) so that ai.hutka.app is not taken by the personal team — explicit App IDs are unique
#    across all teams, and a personal team cannot release one;
#  - no Push Notifications capability (a personal team cannot sign it).
# Undo before a real build: sh release.sh
set -e
cd "$(dirname "$0")"
P=ios/App/App.xcodeproj/project.pbxproj
perl -pi -e 's/PRODUCT_BUNDLE_IDENTIFIER = ai\.hutka\.app;/PRODUCT_BUNDLE_IDENTIFIER = ai.hutka.dev;/g' "$P"
perl -ni -e 'print unless /CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/' "$P"
echo "dev build ready: bundle id ai.hutka.dev, push capability off. Now: npx cap open ios"
