/*\
title: $:/plugins/rimir/file-upload/routes/rename
type: application/javascript
module-type: route

POST /api/file-rename — rename a file on disk under /files/.
Also renames matching files in _generated/ subdirectory.

\*/

"use strict";

var fs = require("fs");
var path = require("path");

var logger = new $tw.utils.Logger("file-upload", {colour: "cyan"});
var basePath = path.resolve($tw.boot.wikiPath, "files");

exports.method = "POST";
exports.path = /^\/api\/file-rename$/;

exports.handler = function(request, response, state) {
	var data;
	try {
		data = JSON.parse(state.data);
	} catch(e) {
		sendJson(response, 400, {error: "Invalid JSON body"});
		return;
	}
	var oldUri = data.oldUri;
	var newUri = data.newUri;
	if(!oldUri || !newUri) {
		sendJson(response, 400, {error: "Missing required fields: oldUri, newUri"});
		return;
	}
	// Strip /files/ prefix to get relative paths
	var oldRel = stripFilesPrefix(oldUri);
	var newRel = stripFilesPrefix(newUri);
	if(oldRel === null || newRel === null) {
		sendJson(response, 400, {error: "URIs must start with /files/"});
		return;
	}
	var oldPath = path.resolve(basePath, oldRel);
	var newPath = path.resolve(basePath, newRel);
	// Security check: both must be inside /files/
	if(isOutside(oldPath) || isOutside(newPath)) {
		sendJson(response, 403, {error: "Path traversal not allowed"});
		return;
	}
	// Check source exists
	if(!fs.existsSync(oldPath)) {
		sendJson(response, 404, {error: "Source file not found: " + oldUri});
		return;
	}
	// Check target doesn't already exist
	if(fs.existsSync(newPath)) {
		sendJson(response, 409, {error: "Target file already exists: " + newUri});
		return;
	}
	// Create target directory and rename
	$tw.utils.createDirectory(path.dirname(newPath));
	try {
		fs.renameSync(oldPath, newPath);
	} catch(e) {
		logger.log("Rename failed: " + e.message);
		sendJson(response, 500, {error: "Rename failed: " + e.message});
		return;
	}
	// Clean up empty parent directories of old path
	cleanEmptyDirs(path.dirname(oldPath));
	// Rename matching _generated/ files
	renameGenerated(oldPath, newPath);
	logger.log("Renamed: " + oldUri + " -> " + newUri);
	sendJson(response, 200, {newCanonicalUri: newUri});
};

function renameGenerated(oldFilePath, newFilePath) {
	var oldParsed = path.parse(oldFilePath);
	var newParsed = path.parse(newFilePath);
	var oldGenDir = path.join(oldParsed.dir, "_generated");
	var newGenDir = path.join(newParsed.dir, "_generated");
	if(!fs.existsSync(oldGenDir)) {
		return;
	}
	try {
		var files = fs.readdirSync(oldGenDir);
		var prefix = oldParsed.name;
		for(var i = 0; i < files.length; i++) {
			if(files[i].indexOf(prefix) === 0) {
				var suffix = files[i].substring(prefix.length);
				var newName = newParsed.name + suffix;
				$tw.utils.createDirectory(newGenDir);
				fs.renameSync(
					path.join(oldGenDir, files[i]),
					path.join(newGenDir, newName)
				);
			}
		}
		// Clean up old _generated/ if empty
		cleanEmptyDirs(oldGenDir);
	} catch(e) {
		logger.log("Generated file rename error: " + e.message);
	}
}

function stripFilesPrefix(uri) {
	if(uri.indexOf("/files/") === 0) {
		return uri.substring(7);
	}
	return null;
}

function isOutside(resolved) {
	return path.relative(basePath, resolved).indexOf("..") === 0;
}

function cleanEmptyDirs(dirPath) {
	// Walk up from dirPath toward basePath, removing empty directories
	while(dirPath !== basePath && dirPath.length > basePath.length) {
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

function sendJson(response, statusCode, data) {
	var body = JSON.stringify(data);
	response.writeHead(statusCode, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*"
	});
	response.end(body);
}
