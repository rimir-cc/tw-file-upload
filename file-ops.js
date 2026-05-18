/*\
title: $:/plugins/rimir/file-upload/file-ops.js
type: application/javascript
module-type: library

Shared helpers for managing the `_generated/` and `_derived/` sidecar
directories created by file-upload + file-pipeline:

  <dir>/myfile.pdf                       — the source file
  <dir>/_generated/myfile-thumb.jpg      — single-file derived artifacts
  <dir>/_generated/myfile.txt
  <dir>/_derived/myfile.pdf/             — multi-file extraction outputs
  <dir>/_derived/myfile.pdf/page1.png
  <dir>/_derived/myfile.pdf/page1.txt

These helpers are currently inlined verbatim into file-upload's
routes/delete.js + routes/rename.js (and partially into
file-pipeline/finalize-route.js). Phase 1 of the suite consolidation
moves all four routes to require() this module.

Errors are caught and logged (Logger named "file-upload") rather than
propagated, matching the existing behaviour in delete.js/rename.js — a
failure cleaning up sidecars does NOT block the main file operation.

\*/

"use strict";

var fs = require("fs");
var path = require("path");

var logger = new $tw.utils.Logger("file-upload", {colour: "cyan"});

// Walk up from dirPath, removing each empty directory. Stop at stopAt
// (exclusive — stopAt itself is never removed even if empty).
function cleanEmptyDirs(dirPath, stopAt) {
	while(dirPath !== stopAt && dirPath.length > stopAt.length) {
		try {
			var entries = fs.readdirSync(dirPath);
			if(entries.length === 0) {
				fs.rmdirSync(dirPath);
				dirPath = path.dirname(dirPath);
			} else {
				break;
			}
		} catch(e) {
			break;
		}
	}
}

// Delete all `_generated/<basename>*` files next to filePath. Cleans up
// the _generated/ dir itself if it ends up empty.
function deleteGenerated(filePath) {
	var parsed = path.parse(filePath);
	var genDir = path.join(parsed.dir, "_generated");
	if(!fs.existsSync(genDir)) { return; }
	try {
		var files = fs.readdirSync(genDir);
		var prefix = parsed.name;
		for(var i = 0; i < files.length; i++) {
			if(files[i].indexOf(prefix) === 0) {
				fs.unlinkSync(path.join(genDir, files[i]));
			}
		}
		var remaining = fs.readdirSync(genDir);
		if(remaining.length === 0) { fs.rmdirSync(genDir); }
	} catch(e) {
		logger.log("Generated file delete error: " + e.message);
	}
}

// Rename `_generated/<oldBasename>*` to `_generated/<newBasename>*`.
// Moves across directories if the file itself moved.
function renameGenerated(oldFilePath, newFilePath) {
	var oldParsed = path.parse(oldFilePath);
	var newParsed = path.parse(newFilePath);
	var oldGenDir = path.join(oldParsed.dir, "_generated");
	var newGenDir = path.join(newParsed.dir, "_generated");
	if(!fs.existsSync(oldGenDir)) { return; }
	try {
		var files = fs.readdirSync(oldGenDir);
		var prefix = oldParsed.name;
		for(var i = 0; i < files.length; i++) {
			if(files[i].indexOf(prefix) === 0) {
				var suffix = files[i].substring(prefix.length);
				var newName = newParsed.name + suffix;
				$tw.utils.createDirectory(newGenDir);
				fs.renameSync(path.join(oldGenDir, files[i]), path.join(newGenDir, newName));
			}
		}
		var remaining = fs.readdirSync(oldGenDir);
		if(remaining.length === 0) { fs.rmdirSync(oldGenDir); }
	} catch(e) {
		logger.log("Generated file rename error: " + e.message);
	}
}

// Recursively remove `_derived/<basename>/`. Recursive removal handles
// nested _derived/_derived/<attachment>/ trees produced when pipelines
// run recursively on email attachments etc.
function deleteDerived(filePath) {
	var parsed = path.parse(filePath);
	var derivedDir = path.join(parsed.dir, "_derived", parsed.base);
	if(!fs.existsSync(derivedDir)) { return; }
	try {
		fs.rmSync(derivedDir, {recursive: true, force: true});
		var derivedParent = path.join(parsed.dir, "_derived");
		if(fs.existsSync(derivedParent)) {
			var remaining = fs.readdirSync(derivedParent);
			if(remaining.length === 0) { fs.rmdirSync(derivedParent); }
		}
	} catch(e) {
		logger.log("Derived file delete error: " + e.message);
	}
}

// Rename `_derived/<oldBasename>/` to `_derived/<newBasename>/`. Moves
// across directories if the parent dir changed.
function renameDerived(oldFilePath, newFilePath) {
	var oldParsed = path.parse(oldFilePath);
	var newParsed = path.parse(newFilePath);
	var oldDerivedDir = path.join(oldParsed.dir, "_derived", oldParsed.base);
	var newDerivedDir = path.join(newParsed.dir, "_derived", newParsed.base);
	if(!fs.existsSync(oldDerivedDir)) { return; }
	try {
		$tw.utils.createDirectory(path.dirname(newDerivedDir));
		fs.renameSync(oldDerivedDir, newDerivedDir);
		var oldDerivedParent = path.join(oldParsed.dir, "_derived");
		if(fs.existsSync(oldDerivedParent)) {
			var remaining = fs.readdirSync(oldDerivedParent);
			if(remaining.length === 0) { fs.rmdirSync(oldDerivedParent); }
		}
	} catch(e) {
		logger.log("Derived directory rename error: " + e.message);
	}
}

exports.cleanEmptyDirs = cleanEmptyDirs;
exports.deleteGenerated = deleteGenerated;
exports.renameGenerated = renameGenerated;
exports.deleteDerived = deleteDerived;
exports.renameDerived = renameDerived;
