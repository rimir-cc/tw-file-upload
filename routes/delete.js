/*\
title: $:/plugins/rimir/file-upload/routes/delete
type: application/javascript
module-type: route

POST /api/file-delete — delete a file from disk under /files/.
Also deletes matching files in _generated/ subdirectory.

\*/

"use strict";

var fs = require("fs");
var path = require("path");

var logger = new $tw.utils.Logger("file-upload", {colour: "cyan"});
var basePath = path.resolve($tw.boot.wikiPath, "files");

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
	// Strip /files/ prefix
	if(uri.indexOf("/files/") !== 0) {
		sendJson(response, 400, {error: "URI must start with /files/"});
		return;
	}
	var relPath = uri.substring(7);
	var filePath = path.resolve(basePath, relPath);
	// Security check
	if(path.relative(basePath, filePath).indexOf("..") === 0) {
		sendJson(response, 403, {error: "Path traversal not allowed"});
		return;
	}
	// Check file exists
	if(!fs.existsSync(filePath)) {
		sendJson(response, 404, {error: "File not found: " + uri});
		return;
	}
	// Delete the file
	try {
		fs.unlinkSync(filePath);
	} catch(e) {
		logger.log("Delete failed: " + e.message);
		sendJson(response, 500, {error: "Delete failed: " + e.message});
		return;
	}
	// Delete matching _generated/ files
	deleteGenerated(filePath);
	// Clean up empty parent directories
	cleanEmptyDirs(path.dirname(filePath));
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

function cleanEmptyDirs(dirPath) {
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
