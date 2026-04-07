/*\
title: $:/plugins/rimir/file-upload/routes/serve-location
type: application/javascript
module-type: route

GET /<uriPrefix>/* — serves files from registered locations.
Builds route regex dynamically at startup from location tiddlers that:
- Are NOT handled by another provider (e.g., scattered-binaries has its own route)
- The default /files/ location is handled by TiddlyWiki's built-in file serving

This covers user-created locations only.

\*/

"use strict";

var fs = require("fs");
var path = require("path");

var resolver = require("$:/plugins/rimir/file-upload/uri-resolver");

// Determine MIME type from extension
var EXT_TO_MIME = {
	".pdf": "application/pdf",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".doc": "application/msword",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".xls": "application/vnd.ms-excel",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".ppt": "application/vnd.ms-powerpoint",
	".txt": "text/plain",
	".csv": "text/csv",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".mp4": "video/mp4",
	".mp3": "audio/mpeg",
	".zip": "application/zip",
	".json": "application/json",
	".md": "text/markdown"
};

// Build route regex from user-created locations (no provider, not /files/)
var locations = resolver.allLocations();
var prefixes = [];
for(var i = 0; i < locations.length; i++) {
	var loc = locations[i];
	// Skip locations handled by other providers (scattered-binaries has its own route)
	if(loc.provider) continue;
	// Skip /files/ — TiddlyWiki serves this natively
	if(loc.uriPrefix === "/files/") continue;
	// Escape regex special chars, strip leading/trailing slashes for regex group
	var stripped = loc.uriPrefix.replace(/^\/|\/$/g, "");
	prefixes.push(stripped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

// If no user locations, use unmatchable regex
var regexStr = prefixes.length > 0
	? "^\\/(" + prefixes.join("|") + ")\\/(.+)$"
	: "^\\/__file-upload-no-user-locations__$";

exports.method = "GET";
exports.path = new RegExp(regexStr);

exports.handler = function(request, response, state) {
	// Reconstruct the full URI from matched groups
	var prefix = "/" + state.params[0] + "/";
	var remainder = state.params[1];
	var uri = prefix + remainder;

	var result = resolver.resolveSecure(uri);
	if(!result) {
		response.writeHead(403, {"Content-Type": "text/plain"});
		response.end("Access denied");
		return;
	}

	fs.readFile(result.filePath, function(err, content) {
		if(err) {
			response.writeHead(404, {"Content-Type": "text/plain"});
			response.end("File not found");
			return;
		}
		var ext = path.extname(result.filePath).toLowerCase();
		var mimeType = EXT_TO_MIME[ext] || "application/octet-stream";
		response.writeHead(200, {
			"Content-Type": mimeType,
			"Content-Length": content.length
		});
		response.end(content);
	});
};
