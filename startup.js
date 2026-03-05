/*\
title: $:/plugins/rimir/file-upload/startup
type: application/javascript
module-type: startup

Browser-side startup module that registers th-saving-tiddler and
th-deleting-tiddler hooks to sync file operations with the server.

\*/

"use strict";

exports.name = "file-upload-hooks";
exports.after = ["render"];
exports.platforms = ["browser"];
exports.synchronous = true;

exports.startup = function() {
	// --- Save hook (handles rename) ---
	// When a tiddler is saved with a different title, the editor calls
	// th-saving-tiddler (not th-renaming-tiddler). We detect the rename
	// by comparing draft.of with the new title, then rename the file.
	$tw.hooks.addHook("th-saving-tiddler", function(newTiddler, draftTiddler) {
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
		if(!oldUri || oldUri.indexOf("/files/") !== 0) {
			return newTiddler;
		}
		// Compute new path via filter
		var newPath = computeFilePath(newTiddler, oldUri);
		var newUri = "/files/" + newPath;
		if(oldUri === newUri) {
			return newTiddler;
		}
		// Synchronous XHR — th-saving-tiddler must return tiddler synchronously
		var xhr = new XMLHttpRequest();
		xhr.open("POST", "/api/file-rename", false);
		xhr.setRequestHeader("Content-Type", "application/json");
		xhr.setRequestHeader("X-Requested-With", "TiddlyWiki");
		xhr.send(JSON.stringify({oldUri: oldUri, newUri: newUri}));
		if(xhr.status === 200) {
			var updates = {_canonical_uri: newUri};
			if(originalTiddler.fields._thumbnail_uri) {
				updates._thumbnail_uri = computeThumbnailUri(newUri, originalTiddler.fields._thumbnail_uri);
			}
			return new $tw.Tiddler(newTiddler, updates);
		}
		// If rename fails, keep old URI
		return newTiddler;
	});

	// --- Also keep th-renaming-tiddler for programmatic renames ---
	$tw.hooks.addHook("th-renaming-tiddler", function(newTiddler, oldTiddler) {
		var oldUri = oldTiddler.fields._canonical_uri;
		if(!oldUri || oldUri.indexOf("/files/") !== 0) {
			return newTiddler;
		}
		var newPath = computeFilePath(newTiddler, oldUri);
		var newUri = "/files/" + newPath;
		if(oldUri === newUri) {
			return newTiddler;
		}
		var xhr = new XMLHttpRequest();
		xhr.open("POST", "/api/file-rename", false);
		xhr.setRequestHeader("Content-Type", "application/json");
		xhr.setRequestHeader("X-Requested-With", "TiddlyWiki");
		xhr.send(JSON.stringify({oldUri: oldUri, newUri: newUri}));
		if(xhr.status === 200) {
			var updates = {_canonical_uri: newUri};
			if(oldTiddler.fields._thumbnail_uri) {
				updates._thumbnail_uri = computeThumbnailUri(newUri, oldTiddler.fields._thumbnail_uri);
			}
			return new $tw.Tiddler(newTiddler, updates);
		}
		return newTiddler;
	});

	// --- Delete hook ---
	$tw.hooks.addHook("th-deleting-tiddler", function(tiddler) {
		var uri = tiddler.fields._canonical_uri;
		if(!uri || uri.indexOf("/files/") !== 0) {
			return true;
		}
		if(!confirm("Also delete the file from disk?\n" + uri)) {
			return true;
		}
		// Fire-and-forget async XHR
		var xhr = new XMLHttpRequest();
		xhr.open("POST", "/api/file-delete", true);
		xhr.setRequestHeader("Content-Type", "application/json");
		xhr.setRequestHeader("X-Requested-With", "TiddlyWiki");
		xhr.send(JSON.stringify({uri: uri}));
		return true;
	});
};

function computeFilePath(tiddler, oldUri) {
	// Extract extension from old URI, derive new filename from tiddler title
	var oldFilename = oldUri.substring(oldUri.lastIndexOf("/") + 1);
	var extDot = oldFilename.lastIndexOf(".");
	var ext = extDot >= 0 ? oldFilename.substring(extDot) : "";
	// New filename = tiddler title + original extension (title may already have ext)
	var newTitle = tiddler.fields.title;
	var filename = newTitle.toLowerCase().endsWith(ext.toLowerCase()) ? newTitle : newTitle + ext;
	// Route by MIME type
	var type = tiddler.fields.type || "";
	var subfolder = getSubfolderForType(type);
	if(subfolder) {
		return sanitizePath(subfolder + "/" + filename);
	}
	return sanitizePath(filename);
}

// Compute new thumbnail URI from new canonical URI, preserving thumbnail extension
function computeThumbnailUri(newCanonicalUri, oldThumbnailUri) {
	// Extract thumbnail extension from old URI (e.g. ".png" for PDF thumbnails)
	var oldThumbFilename = oldThumbnailUri.substring(oldThumbnailUri.lastIndexOf("/") + 1);
	var thumbSuffixStart = oldThumbFilename.indexOf("_thumb");
	var thumbSuffix = thumbSuffixStart >= 0 ? oldThumbFilename.substring(thumbSuffixStart) : "_thumb" + oldThumbFilename.substring(oldThumbFilename.lastIndexOf("."));
	// Build new thumbnail URI from new canonical URI
	var lastSlash = newCanonicalUri.lastIndexOf("/");
	var dir = newCanonicalUri.substring(0, lastSlash);
	var newFilename = newCanonicalUri.substring(lastSlash + 1);
	var dotPos = newFilename.lastIndexOf(".");
	var baseName = dotPos >= 0 ? newFilename.substring(0, dotPos) : newFilename;
	return dir + "/_generated/" + baseName + thumbSuffix;
}

// Route files to subfolders by MIME type
function getSubfolderForType(mimeType) {
	if(mimeType.indexOf("image/") === 0) {
		return "images";
	}
	if(mimeType === "application/pdf") {
		return "pdf";
	}
	return "";
}

function sanitizePath(p) {
	p = p.replace(/\\/g, "/");
	if(p.charAt(0) === "/") {
		p = p.substring(1);
	}
	return p;
}
