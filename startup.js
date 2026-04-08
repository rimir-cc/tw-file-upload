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

/*
Cascade-delete all artifact tiddlers linked to a source title.
*/
function cascadeDeleteArtifacts(sourceTitle) {
	var artifacts = $tw.wiki.filterTiddlers("[_artifact_source[" + sourceTitle + "]]");
	for(var i = 0; i < artifacts.length; i++) {
		// For artifacts that are themselves files (extraction-image), also delete from disk
		var artTiddler = $tw.wiki.getTiddler(artifacts[i]);
		if(artTiddler && artTiddler.fields._canonical_uri && artTiddler.fields._artifact_type === "extraction-image") {
			deleteFileFromServer(artTiddler.fields._canonical_uri);
		}
		$tw.wiki.deleteTiddler(artifacts[i]);
	}
	return artifacts.length;
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
	var artifacts = $tw.wiki.filterTiddlers("[_artifact_source[" + oldTitle + "]]");
	for(var i = 0; i < artifacts.length; i++) {
		var artTiddler = $tw.wiki.getTiddler(artifacts[i]);
		if(!artTiddler) continue;
		// Update _artifact_source and legacy fields
		var updates = { _artifact_source: newTitle };
		if(artTiddler.fields["extraction-source"] === oldTitle) {
			updates["extraction-source"] = newTitle;
		}
		// If artifact title embeds the parent title, rename it too
		var artTitle = artifacts[i];
		if(artTitle.indexOf(oldTitle) === 0) {
			var newArtTitle = newTitle + artTitle.substring(oldTitle.length);
			if(newArtTitle !== artTitle) {
				// Check target doesn't already exist (defensive)
				if(!$tw.wiki.tiddlerExists(newArtTitle)) {
					$tw.wiki.addTiddler(new $tw.Tiddler(artTiddler, updates, { title: newArtTitle }));
					$tw.wiki.deleteTiddler(artTitle);
				} else {
					// Target exists — just update fields on it
					var existing = $tw.wiki.getTiddler(newArtTitle);
					if(existing) {
						$tw.wiki.addTiddler(new $tw.Tiddler(existing, updates));
					}
					$tw.wiki.deleteTiddler(artTitle);
				}
			} else {
				$tw.wiki.addTiddler(new $tw.Tiddler(artTiddler, updates));
			}
		} else {
			// Just update the back-reference
			$tw.wiki.addTiddler(new $tw.Tiddler(artTiddler, updates));
		}
	}
}

/*
Fire-and-forget file deletion via XHR.
*/
function deleteFileFromServer(uri) {
	var xhr = new XMLHttpRequest();
	xhr.open("POST", "/api/file-delete", true);
	xhr.setRequestHeader("Content-Type", "application/json");
	xhr.setRequestHeader("X-Requested-With", "TiddlyWiki");
	xhr.send(JSON.stringify({uri: uri}));
}

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
