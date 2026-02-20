#!/usr/bin/env node
"use strict";

/**
 * afterSign hook for electron-builder.
 *
 * Re-signs the Squirrel.framework and Mantle.framework binaries that Electron
 * bundles but electron-builder does not automatically deep-sign.  Without this,
 * Apple notarization rejects the package with:
 *
 *   "The binary is not signed with a valid Developer ID certificate."
 *
 * for Squirrel, ShipIt and Mantle.
 */

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  // Only run on macOS
  if (electronPlatformName !== "darwin") return;

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  const frameworks = path.join(appPath, "Contents", "Frameworks");

  if (!fs.existsSync(frameworks)) {
    console.log("[afterSign] Frameworks directory not found, skipping.");
    return;
  }

  // Find the signing identity from the environment or keychain
  const identity = findIdentity();
  if (!identity) {
    console.warn(
      "[afterSign] No Developer ID Application certificate found – skipping deep sign."
    );
    return;
  }

  const entitlements = path.resolve(__dirname, "../build/entitlements.mac.plist");

  // Binaries that notarization requires to be signed with a Developer ID
  const targets = [
    path.join(
      frameworks,
      "Squirrel.framework",
      "Versions",
      "A",
      "Squirrel"
    ),
    path.join(
      frameworks,
      "Squirrel.framework",
      "Versions",
      "A",
      "Resources",
      "ShipIt"
    ),
    path.join(
      frameworks,
      "Mantle.framework",
      "Versions",
      "A",
      "Mantle"
    ),
    // ReactiveCocoa is present in some Electron versions
    path.join(
      frameworks,
      "ReactiveCocoa.framework",
      "Versions",
      "A",
      "ReactiveCocoa"
    ),
  ];

  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    console.log(`[afterSign] Signing: ${target}`);
    try {
      execSync(
        `codesign --force --options runtime --entitlements "${entitlements}" --sign "${identity}" "${target}"`,
        { stdio: "inherit" }
      );
    } catch (err) {
      console.error(`[afterSign] Failed to sign ${target}:`, err.message);
      throw err;
    }
  }

  // Re-sign the whole .app bundle after deep-signing the nested binaries
  console.log(`[afterSign] Re-signing app bundle: ${appPath}`);
  execSync(
    `codesign --force --deep --options runtime --entitlements "${entitlements}" --sign "${identity}" "${appPath}"`,
    { stdio: "inherit" }
  );

  console.log("[afterSign] Done.");
};

function findIdentity() {
  // Prefer explicit env var (set by electron-builder from CSC_NAME or cert)
  const cscName = process.env.CSC_NAME;
  if (cscName) return cscName;

  // Fall back to querying keychain for any Developer ID Application cert
  try {
    const output = execSync(
      'security find-identity -v -p codesigning | grep "Developer ID Application"',
      { encoding: "utf8" }
    );
    const match = output.match(/"(Developer ID Application[^"]+)"/);
    if (match) return match[1];
  } catch {
    // No cert found — warning logged by caller
  }
  return null;
}
