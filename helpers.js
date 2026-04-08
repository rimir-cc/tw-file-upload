/*\
title: $:/plugins/rimir/file-upload/helpers
type: application/javascript
module-type: library

Pure utility functions for file-upload plugin.
Extracted from startup.js for testability.

\*/
"use strict";

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

function computeFilePath(tiddlerFields, oldUri, locationPrefix) {
	// Extract extension from old URI, derive new filename from tiddler title
	var oldFilename = oldUri.substring(oldUri.lastIndexOf("/") + 1);
	var extDot = oldFilename.lastIndexOf(".");
	var ext = extDot >= 0 ? oldFilename.substring(extDot) : "";
	// Use last segment of title as new filename
	var newTitle = tiddlerFields.title;
	var titleSlash = newTitle.lastIndexOf("/");
	var newBasename = titleSlash >= 0 ? newTitle.substring(titleSlash + 1) : newTitle;
	var filename = newBasename.toLowerCase().endsWith(ext.toLowerCase()) ? newBasename : newBasename + ext;
	// Preserve directory from old URI when location prefix is known (rename)
	if(locationPrefix) {
		var prefix = locationPrefix;
		if(prefix.charAt(prefix.length - 1) !== "/") prefix += "/";
		var relPath = oldUri.indexOf(prefix) === 0 ? oldUri.substring(prefix.length) : oldUri;
		var dirSlash = relPath.lastIndexOf("/");
		if(dirSlash >= 0) {
			return sanitizePath(relPath.substring(0, dirSlash + 1) + filename);
		}
	}
	// Fallback: route by MIME type (initial uploads without location context)
	var type = tiddlerFields.type || "";
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

exports.getSubfolderForType = getSubfolderForType;
exports.sanitizePath = sanitizePath;
exports.computeFilePath = computeFilePath;
exports.computeThumbnailUri = computeThumbnailUri;
