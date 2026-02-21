#!/usr/bin/env node
"use strict";

/**
 * afterSign hook for electron-builder.
 *
 * electron-builder's codesign --deep does not always re-sign every nested
 * binary inside Electron Framework (libEGL, libffmpeg, chrome_crashpad_handler,
 * Squirrel, Mantle, ReactiveObjC, etc.).  Without signing them with a valid
 * Developer ID Application certificate, Apple notarization rejects the build.
 *
 * This hook:
 *  1. Finds every Mach-O binary (dylib + executable) inside the .app bundle
 *  2. Signs each one individually (innermost first)
 *  3. Re-signs the .app bundle itself
 *
 * Requires: Developer ID Application certificate in the keychain.
 * Must be set as CSC_LINK/CSC_KEY_PASSWORD secrets in GitHub Actions.
 */

const { execSync, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== "darwin") return;

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  if (!fs.existsSync(appPath)) {
    console.warn("[afterSign] .app not found:", appPath);
    return;
  }

  const identity = findIdentity();
  if (!identity) {
    console.warn(
      "[afterSign] No 'Developer ID Application' certificate found in keychain — skipping.\n" +
        "           Make sure CSC_LINK and CSC_KEY_PASSWORD are set (GitHub Actions)\n" +
        "           or that the certificate is installed in the local keychain."
    );
    return;
  }

  console.log(`[afterSign] Using identity: ${identity}`);

  const entitlements = path.resolve(__dirname, "../build/entitlements.mac.plist");

  // Find all Mach-O binaries inside the bundle
  const binaries = findMachOBinaries(appPath);
  console.log(`[afterSign] Found ${binaries.length} binaries to sign`);

  // Sign from deepest path first (innermost frameworks before outer bundle)
  binaries.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);

  for (const binary of binaries) {
    // Entitlements only apply to executables; dylibs/frameworks ignore them.
    // Sign dylibs with just --options runtime for cleanliness.
    const isExecutable = isMachOExecutable(binary);
    sign(binary, identity, isExecutable ? entitlements : null);
  }

  // Final re-sign of the whole .app (without --deep; Apple recommends
  // signing each binary individually, which we already did above).
  console.log(`[afterSign] Re-signing .app bundle: ${appPath}`);
  sign(appPath, identity, entitlements);

  console.log("[afterSign] All binaries signed successfully.");
};

// ---------------------------------------------------------------------------

function sign(target, identity, entitlements) {
  const args = [
    "--force",
    ...(entitlements ? ["--entitlements", entitlements] : []),
    "--sign", identity,
    target,
  ];

  const result = spawnSync("codesign", args, { stdio: "inherit" });

  if (result.status !== 0) {
    throw new Error(`codesign failed for: ${target}`);
  }
}

function findMachOBinaries(dir) {
  const results = [];
  walkDir(dir, (filePath) => {
    if (isMachO(filePath)) {
      results.push(filePath);
    }
  });
  return results;
}

function walkDir(dir, fn) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // skip symlinks
    if (entry.isDirectory()) {
      walkDir(full, fn);
    } else if (entry.isFile()) {
      fn(full);
    }
  }
}

function isMachO(filePath) {
  // Check magic bytes: 0xFEEDFACE (32-bit), 0xFEEDFACF (64-bit), 0xCAFEBABE (fat)
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    if (bytesRead < 4) return false;
    const magic = buf.readUInt32BE(0);
    // Mach-O magic numbers (both endiannesses)
    return (
      magic === 0xcafebabe || // fat binary
      magic === 0xfeedface || // 32-bit BE
      magic === 0xcefaedfe || // 32-bit LE
      magic === 0xfeedfacf || // 64-bit BE
      magic === 0xcffaedfe    // 64-bit LE
    );
  } catch {
    return false;
  }
}

function isMachOExecutable(filePath) {
  // Dylibs have .dylib extension or live inside .framework bundles.
  // .node files are shared libraries (native addons).
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".dylib" || ext === ".node" || ext === ".so") return false;
  // Files inside a .framework directory are framework libraries
  if (filePath.includes(".framework/")) return false;
  return true;
}

function findIdentity() {
  // CSC_NAME can be set by the user or electron-builder resolves it
  const cscName = process.env.CSC_NAME;
  if (cscName) return cscName;

  try {
    const output = execSync(
      'security find-identity -v -p codesigning 2>/dev/null',
      { encoding: "utf8" }
    );
    // Prefer Developer ID Application over Apple Development
    const devId = output.match(/"(Developer ID Application[^"]+)"/);
    if (devId) return devId[1];
  } catch {
    // fall through
  }
  return null;
}
