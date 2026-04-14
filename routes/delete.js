/*\
title: $:/plugins/rimir/file-upload/routes/delete
type: application/javascript
module-type: route

POST /api/file-delete — delete a file from disk at any writable location.
Also deletes matching files in _generated/ subdirectory.

\*/

"use strict";

var fs = require("fs");
var path = require("path");

var resolver = require("$:/plugins/rimir/file-upload/uri-resolver");
var logger = new $tw.utils.Logger("file-upload", {colour: "cyan"});

exports.method = "POST";
exports.path = /^\/api\/file-delete$/;

exports.handler = function(request, response, state) {
	var data;
	try {
		data = JSON.parse(state.data);
	} catch(e) {
		sendJson(response, 400, {error: "Invalid JSON body"});
		return;
	}
	var uri = data.uri;
	if(!uri) {
		sendJson(response, 400, {error: "Missing required field: uri"});
		return;
	}
	// Resolve URI securely
	var result = resolver.resolveSecure(uri);
	if(!result) {
		sendJson(response, 403, {error: "Cannot resolve URI or path traversal denied: " + uri});
		return;
	}
	if(!result.location.writable) {
		sendJson(response, 403, {error: "Location is read-only: " + result.location.name});
		return;
	}
	// Check file exists
	if(!fs.existsSync(result.filePath)) {
		sendJson(response, 404, {error: "File not found: " + uri});
		return;
	}
	// Delete the file
	try {
		fs.unlinkSync(result.filePath);
	} catch(e) {
		logger.log("Delete failed: " + e.message);
		sendJson(response, 500, {error: "Delete failed: " + e.message});
		return;
	}
	// Delete matching _generated/ files
	deleteGenerated(result.filePath);
	// Delete matching _derived/ directory (for multi-file extractions)
	deleteDerived(result.filePath);
	// Clean up empty parent directories
	var baseDir = path.resolve($tw.boot.wikiPath, result.location.basePath);
	cleanEmptyDirs(path.dirname(result.filePath), baseDir);
	logger.log("Deleted: " + uri);
	sendJson(response, 200, {deleted: true});
};

function deleteGenerated(filePath) {
	var parsed = path.parse(filePath);
	var genDir = path.join(parsed.dir, "_generated");
	if(!fs.existsSync(genDir)) {
		return;
	}
	try {
		var files = fs.readdirSync(genDir);
		var prefix = parsed.name;
		for(var i = 0; i < files.length; i++) {
			if(files[i].indexOf(prefix) === 0) {
				fs.unlinkSync(path.join(genDir, files[i]));
			}
		}
		// Clean up _generated/ if empty
		var remaining = fs.readdirSync(genDir);
		if(remaining.length === 0) {
			fs.rmdirSync(genDir);
		}
	} catch(e) {
		logger.log("Generated file delete error: " + e.message);
	}
}

function deleteDerived(filePath) {
	// _derived/ directory for multi-file extraction artifacts
	// Located in <parent-dir>/_derived/<source-filename>/
	var parsed = path.parse(filePath);
	var derivedDir = path.join(parsed.dir, "_derived", parsed.base);
	if(!fs.existsSync(derivedDir)) {
		return;
	}
	try {
		var files = fs.readdirSync(derivedDir);
		for(var i = 0; i < files.length; i++) {
			fs.unlinkSync(path.join(derivedDir, files[i]));
		}
		fs.rmdirSync(derivedDir);
		// Clean up _derived/ parent if now empty
		var derivedParent = path.join(parsed.dir, "_derived");
		var remaining = fs.readdirSync(derivedParent);
		if(remaining.length === 0) {
			fs.rmdirSync(derivedParent);
		}
	} catch(e) {
		logger.log("Derived file delete error: " + e.message);
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
