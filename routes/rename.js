/*\
title: $:/plugins/rimir/file-upload/routes/rename
type: application/javascript
module-type: route

POST /api/file-rename — rename a file on disk at any writable location.
Also renames matching files in _generated/ subdirectory.

\*/

"use strict";

var fs = require("fs");
var path = require("path");

var resolver = require("$:/plugins/rimir/file-upload/uri-resolver");
var logger = new $tw.utils.Logger("file-upload", {colour: "cyan"});

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
	// Resolve both URIs securely
	var oldResult = resolver.resolveSecure(oldUri);
	var newResult = resolver.resolveSecure(newUri);
	if(!oldResult) {
		sendJson(response, 403, {error: "Cannot resolve old URI or path traversal denied"});
		return;
	}
	if(!newResult) {
		sendJson(response, 403, {error: "Cannot resolve new URI or path traversal denied"});
		return;
	}
	if(!oldResult.location.writable) {
		sendJson(response, 403, {error: "Source location is read-only: " + oldResult.location.name});
		return;
	}
	if(!newResult.location.writable) {
		sendJson(response, 403, {error: "Target location is read-only: " + newResult.location.name});
		return;
	}
	// Check source exists
	if(!fs.existsSync(oldResult.filePath)) {
		sendJson(response, 404, {error: "Source file not found: " + oldUri});
		return;
	}
	// Check target doesn't already exist
	if(fs.existsSync(newResult.filePath)) {
		sendJson(response, 409, {error: "Target file already exists: " + newUri});
		return;
	}
	// Create target directory and rename
	$tw.utils.createDirectory(path.dirname(newResult.filePath));
	try {
		fs.renameSync(oldResult.filePath, newResult.filePath);
	} catch(e) {
		logger.log("Rename failed: " + e.message);
		sendJson(response, 500, {error: "Rename failed: " + e.message});
		return;
	}
	// Clean up empty parent directories of old path
	var oldBaseDir = path.resolve($tw.boot.wikiPath, oldResult.location.basePath);
	cleanEmptyDirs(path.dirname(oldResult.filePath), oldBaseDir);
	// Rename matching _generated/ files
	renameGenerated(oldResult.filePath, newResult.filePath);
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
		var remaining = fs.readdirSync(oldGenDir);
		if(remaining.length === 0) {
			fs.rmdirSync(oldGenDir);
		}
	} catch(e) {
		logger.log("Generated file rename error: " + e.message);
	}
}

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

function sendJson(response, statusCode, data) {
	var body = JSON.stringify(data);
	response.writeHead(statusCode, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*"
	});
	response.end(body);
}
