#!/bin/sh
# Back to the real project after dev.sh: bundle id ai.hutka.app and the push capability (for the Kozyra Media team).
set -e
cd "$(dirname "$0")"
git checkout -- ios/App/App.xcodeproj/project.pbxproj
echo "release project restored: ai.hutka.app, push capability on"
