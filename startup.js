/*\
title: $:/plugins/rimir/file-upload/startup
type: application/javascript
module-type: startup

Browser-side startup module that registers th-saving-tiddler and
th-deleting-tiddler hooks to sync file operations with the server.

Supports all registered locations (not just /files/). Writable locations
get full file ops; read-only locations get artifact cascade only.

\*/

"use strict";

var helpers = require("$:/plugins/rimir/file-upload/helpers");
var computeFilePath = helpers.computeFilePath;
var computeThumbnailUri = helpers.computeThumbnailUri;

exports.name = "file-upload-hooks";
exports.after = ["render"];
exports.platforms = ["browser"];
exports.synchronous = true;

var LOCATION_TAG = "$:/tags/rimir/file-upload/location";

/*
Read a location config from a tiddler. Returns parsed JSON or null.
*/
function parseLocationTiddler(tiddler) {
	if(!tiddler) return null;
	try {
		return JSON.parse(tiddler.fields.text);
	} catch(e) {
		return null;
	}
}

/*
Find the location config matching a URI.
Returns: { config, tiddler } or null.
*/
function getLocationForUri(uri) {
	var titles = $tw.wiki.filterTiddlers("[all[tiddlers+shadows]tag[" + LOCATION_TAG + "]]");
	var bestMatch = null;
	var bestLen = 0;
	for(var i = 0; i < titles.length; i++) {
		var tiddler = $tw.wiki.getTiddler(titles[i]);
		var config = parseLocationTiddler(tiddler);
		if(!config || !config.uriPrefix) continue;
		var prefix = config.uriPrefix;
		if(prefix.charAt(prefix.length - 1) !== "/") prefix += "/";
		if(uri.indexOf(prefix) === 0 && prefix.length > bestLen) {
			bestMatch = config;
			bestLen = prefix.length;
		}
	}
	return bestMatch;
}

// Artifact types whose `_canonical_uri` refers to a binary file managed by
// file-upload. Deleting one of these cascade-targets must also remove the
// underlying file from disk. Other types (e.g. "extraction" — captured text)
// only own the tiddler.
var FILE_BACKED_ARTIFACT_TYPES = {
	"extraction-image": true,
	"attachment": true,
	"derived": true,
	"conversion": true,
	"thumbnail": true
};

/*
Walk the _artifact_source chain transitively starting from `sourceTitle`.
Returns an array of all descendant artifact titles in deletion order
(leaves first). Visits each title at most once — safe against cycles.
*/
function collectCascade(sourceTitle) {
	var visited = Object.create(null);
	var ordered = [];
	function walk(t) {
		var artifacts = $tw.wiki.filterTiddlers("[_artifact_source[" + t + "]]");
		for(var i = 0; i < artifacts.length; i++) {
			var child = artifacts[i];
			if(visited[child]) continue;
			visited[child] = true;
			walk(child);
			ordered.push(child);
		}
	}
	walk(sourceTitle);
	return ordered;
}

/*
Cascade-delete all artifact tiddlers transitively linked to a source title.
Also removes the underlying file from disk for artifacts whose
`_artifact_type` is in the file-backed allow-list.
*/
function cascadeDeleteArtifacts(sourceTitle) {
	var cascade = collectCascade(sourceTitle);
	for(var i = 0; i < cascade.length; i++) {
		var artTitle = cascade[i];
		var artTiddler = $tw.wiki.getTiddler(artTitle);
		if(artTiddler && artTiddler.fields._canonical_uri &&
			FILE_BACKED_ARTIFACT_TYPES[artTiddler.fields._artifact_type]) {
			exports._deleteFileFromServer(artTiddler.fields._canonical_uri);
		}
		$tw.wiki.deleteTiddler(artTitle);
	}
	return cascade.length;
}

/*
Cascade-rename all artifact tiddlers linked to a source title.

Execution order context:
- th-saving-tiddler (this hook) fires BEFORE wiki.relinkTiddler()
- relink-titles directory rule runs AFTER this hook
- _artifact_source is registered as a relink field (type: title), so relink
  will also update it during its pass — belt-and-suspenders with our cascade
- Defensive: skip artifacts that no longer exist (in case of concurrent changes)
*/
function cascadeRenameArtifacts(oldTitle, newTitle) {
	// Walk transitively in BFS order so each layer rebuilds before we recurse
	// into its (now-renamed) children. We track which titles we've handled to
	// avoid re-processing when a grandchild's parent title has changed.
	var visited = Object.create(null);
	function renameLayer(currentOld, currentNew) {
		var artifacts = $tw.wiki.filterTiddlers("[_artifact_source[" + currentOld + "]]");
		for(var i = 0; i < artifacts.length; i++) {
			var artTitle = artifacts[i];
			if(visited[artTitle]) continue;
			visited[artTitle] = true;
			var artTiddler = $tw.wiki.getTiddler(artTitle);
			if(!artTiddler) continue;
			var updates = { _artifact_source: currentNew };
			if(artTiddler.fields["extraction-source"] === currentOld) {
				updates["extraction-source"] = currentNew;
			}
			var renamedTitle = artTitle;
			if(artTitle.indexOf(currentOld) === 0) {
				var candidate = currentNew + artTitle.substring(currentOld.length);
				if(candidate !== artTitle) {
					if(!$tw.wiki.tiddlerExists(candidate)) {
						$tw.wiki.addTiddler(new $tw.Tiddler(artTiddler, updates, { title: candidate }));
						$tw.wiki.deleteTiddler(artTitle);
						renamedTitle = candidate;
					} else {
						// Target exists — merge fields onto it and drop the old title.
						var existing = $tw.wiki.getTiddler(candidate);
						if(existing) {
							$tw.wiki.addTiddler(new $tw.Tiddler(existing, updates));
						}
						$tw.wiki.deleteTiddler(artTitle);
						renamedTitle = candidate;
					}
				} else {
					$tw.wiki.addTiddler(new $tw.Tiddler(artTiddler, updates));
				}
			} else {
				$tw.wiki.addTiddler(new $tw.Tiddler(artTiddler, updates));
			}
			// Recurse into grandchildren — their _artifact_source still points
			// at the OLD (pre-rename) artifact title until we rewire them.
			renameLayer(artTitle, renamedTitle);
		}
	}
	renameLayer(oldTitle, newTitle);
}

// Test-only exports.
exports._cascadeDeleteArtifacts = cascadeDeleteArtifacts;
exports._cascadeRenameArtifacts = cascadeRenameArtifacts;
exports._collectCascade = collectCascade;
exports._FILE_BACKED_ARTIFACT_TYPES = FILE_BACKED_ARTIFACT_TYPES;

/*
Fire-and-forget file deletion via XHR. Exposed on exports so tests can stub
it without an XMLHttpRequest polyfill — see exports._deleteFileFromServer.
*/
function deleteFileFromServer(uri) {
	if(typeof XMLHttpRequest === "undefined") return;
	var xhr = new XMLHttpRequest();
	xhr.open("POST", "/api/file-delete", true);
	xhr.setRequestHeader("Content-Type", "application/json");
	xhr.setRequestHeader("X-Requested-With", "TiddlyWiki");
	xhr.send(JSON.stringify({uri: uri}));
}

exports._deleteFileFromServer = deleteFileFromServer;

exports.startup = function() {
	// --- Save hook (handles rename) ---
	$tw.hooks.addHook("th-saving-tiddler", function(newTiddler, draftTiddler) {
		if(!newTiddler || !draftTiddler) return newTiddler;
		var draftOf = (draftTiddler.fields["draft.of"] || "").trim();
		if(!draftOf || draftOf === newTiddler.fields.title) {
			return newTiddler;
		}
		// It's a rename — check if the original tiddler has _canonical_uri
		var originalTiddler = $tw.wiki.getTiddler(draftOf);
		if(!originalTiddler) {
			return newTiddler;
		}
		var oldUri = originalTiddler.fields._canonical_uri;
		if(!oldUri) {
			return newTiddler;
		}
		var location = getLocationForUri(oldUri);
		if(!location) {
			return newTiddler;
		}
		var updates = {};
		// For writable locations, rename the physical file
		if(location.writable) {
			var newPath = computeFilePath(newTiddler.fields, oldUri, location.uriPrefix);
			var newUri = location.uriPrefix + newPath;
			if(location.uriPrefix.charAt(location.uriPrefix.length - 1) !== "/") {
				newUri = location.uriPrefix + "/" + newPath;
			}
			if(oldUri !== newUri) {
				// Synchronous XHR — th-saving-tiddler must return tiddler synchronously
				var xhr = new XMLHttpRequest();
				xhr.open("POST", "/api/file-rename", false);
				xhr.setRequestHeader("Content-Type", "application/json");
				xhr.setRequestHeader("X-Requested-With", "TiddlyWiki");
				xhr.send(JSON.stringify({oldUri: oldUri, newUri: newUri}));
				if(xhr.status === 200) {
					updates._canonical_uri = newUri;
					if(originalTiddler.fields._thumbnail_uri) {
						updates._thumbnail_uri = computeThumbnailUri(newUri, originalTiddler.fields._thumbnail_uri);
					}
				}
			}
		}
		// Cascade rename artifacts (for all location types)
		cascadeRenameArtifacts(draftOf, newTiddler.fields.title);
		if(Object.keys(updates).length > 0) {
			return new $tw.Tiddler(newTiddler, updates);
		}
		return newTiddler;
	});

	// --- Also keep th-renaming-tiddler for programmatic renames ---
	$tw.hooks.addHook("th-renaming-tiddler", function(newTiddler, oldTiddler) {
		if(!newTiddler || !oldTiddler) return newTiddler;
		var oldUri = oldTiddler.fields._canonical_uri;
		if(!oldUri) {
			return newTiddler;
		}
		var location = getLocationForUri(oldUri);
		if(!location) {
			return newTiddler;
		}
		var updates = {};
		if(location.writable) {
			var newPath = computeFilePath(newTiddler.fields, oldUri, location.uriPrefix);
			var newUri = location.uriPrefix + newPath;
			if(location.uriPrefix.charAt(location.uriPrefix.length - 1) !== "/") {
				newUri = location.uriPrefix + "/" + newPath;
			}
			if(oldUri !== newUri) {
				var xhr = new XMLHttpRequest();
				xhr.open("POST", "/api/file-rename", false);
				xhr.setRequestHeader("Content-Type", "application/json");
				xhr.setRequestHeader("X-Requested-With", "TiddlyWiki");
				xhr.send(JSON.stringify({oldUri: oldUri, newUri: newUri}));
				if(xhr.status === 200) {
					updates._canonical_uri = newUri;
					if(oldTiddler.fields._thumbnail_uri) {
						updates._thumbnail_uri = computeThumbnailUri(newUri, oldTiddler.fields._thumbnail_uri);
					}
				}
			}
		}
		// Cascade rename artifacts
		cascadeRenameArtifacts(oldTiddler.fields.title, newTiddler.fields.title);
		if(Object.keys(updates).length > 0) {
			return new $tw.Tiddler(newTiddler, updates);
		}
		return newTiddler;
	});

	// --- Delete handling ---
	// Two-layer approach because some plugins (e.g. sq/streams) break the
	// th-deleting-tiddler hook chain by not returning the tiddler.
	//
	// Layer 1 (hook): best-effort confirm dialog. If the hook fires, we show
	// the prompt and record the user's decision. If cancelled, we record "skip".
	// Layer 2 (change event): reliable cleanup. We snapshot all _canonical_uri
	// tiddlers so we can still act after the tiddler is deleted, even if the
	// hook chain was broken by another plugin.
	var _fileUriSnapshot = {};  // title → {uri, location} for all known file tiddlers
	var _deleteDecisions = {};  // title → "skip" | "confirmed"

	// Build initial snapshot of file tiddlers (excludes drafts)
	function rebuildSnapshot() {
		_fileUriSnapshot = {};
		var titles = $tw.wiki.filterTiddlers("[has[_canonical_uri]!has[draft.of]]");
		for(var i = 0; i < titles.length; i++) {
			var t = $tw.wiki.getTiddler(titles[i]);
			if(t) {
				var uri = t.fields._canonical_uri;
				var loc = getLocationForUri(uri);
				if(loc) {
					_fileUriSnapshot[titles[i]] = {uri: uri, location: loc};
				}
			}
		}
	}
	rebuildSnapshot();

	// Layer 1: best-effort confirm via hook
	$tw.hooks.addHook("th-deleting-tiddler", function(tiddler) {
		if(!tiddler) return tiddler;
		if(tiddler.fields["draft.of"]) return tiddler; // Skip drafts
		var uri = tiddler.fields._canonical_uri;
		if(!uri) return tiddler;
		var location = getLocationForUri(uri);
		if(!location) return tiddler;
		// Build confirmation message
		var parts = [];
		if(location.writable) {
			parts.push("Delete the file from disk?\n" + uri);
		}
		var artifactCount = $tw.wiki.filterTiddlers("[_artifact_source[" + tiddler.fields.title + "]]").length;
		if(artifactCount > 0) {
			parts.push((location.writable ? "Also delete" : "Delete") + " " + artifactCount + " derived artifact(s) (extractions, summaries, etc.)?");
		}
		if(parts.length > 0 && !confirm(parts.join("\n\n"))) {
			_deleteDecisions[tiddler.fields.title] = "skip";
			return tiddler;
		}
		_deleteDecisions[tiddler.fields.title] = "confirmed";
		return tiddler;
	});

	// Layer 2: reliable cleanup via wiki change event
	$tw.wiki.addEventListener("change", function(changes) {
		var snapshotDirty = false;
		$tw.utils.each(changes, function(change, title) {
			if(!change.deleted) {
				// Tiddler was added/modified — update snapshot (skip drafts)
				var t = $tw.wiki.getTiddler(title);
				if(t && t.fields._canonical_uri && !t.fields["draft.of"]) {
					var loc = getLocationForUri(t.fields._canonical_uri);
					if(loc) {
						_fileUriSnapshot[title] = {uri: t.fields._canonical_uri, location: loc};
					}
				} else {
					delete _fileUriSnapshot[title];
				}
				return;
			}
			// Tiddler was deleted
			var decision = _deleteDecisions[title];
			delete _deleteDecisions[title];
			if(decision === "skip") return; // User cancelled in confirm dialog
			var info = _fileUriSnapshot[title];
			delete _fileUriSnapshot[title];
			snapshotDirty = true;
			if(!info) return; // Not a file tiddler we knew about
			// If hook ran (decision === "confirmed"), proceed.
			// If hook didn't run (decision === undefined, broken chain),
			// also proceed — file cleanup should happen.
			if(info.location.writable) {
				deleteFileFromServer(info.uri);
			}
			cascadeDeleteArtifacts(title);
		});
	});
};
