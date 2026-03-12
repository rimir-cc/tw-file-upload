/*\
title: $:/plugins/rimir/file-upload/routes/upload
type: application/javascript
module-type: route

POST /api/file-upload — receive base64-encoded file, write to /files/<targetPath>.
Optionally runs post-upload processing (thumbnails etc.) via runner actions.

\*/

"use strict";

var fs = require("fs");
var path = require("path");
var child_process = require("child_process");

var logger = new $tw.utils.Logger("file-upload", {colour: "cyan"});
var basePath = path.resolve($tw.boot.wikiPath, "files");

exports.method = "POST";
exports.path = /^\/api\/file-upload$/;
exports.bodyFormat = "stream";

exports.handler = function(request, response, state) {
	// Stream the body to handle large base64 payloads
	var body = "";
	request.on("data", function(chunk) {
		body += chunk;
		// Limit to 50MB of JSON (base64 expands ~33%, so ~37MB file)
		if(body.length > 50e6) {
			sendJson(response, 413, {error: "Upload too large"});
			request.connection.destroy();
		}
	});
	request.on("end", function() {
		var data;
		try {
			data = JSON.parse(body);
		} catch(e) {
			sendJson(response, 400, {error: "Invalid JSON body"});
			return;
		}
		handleUpload(data, response);
	});
};

function handleUpload(data, response) {
	var filename = data.filename;
	var type = data.type || "";
	var content = data.content;
	var targetPath = data.targetPath;
	if(!filename || !content || !targetPath) {
		sendJson(response, 400, {error: "Missing required fields: filename, content, targetPath"});
		return;
	}
	// Validate MIME type against allowed list
	var allowedTypes = getAllowedTypes();
	if(allowedTypes.indexOf(type) === -1) {
		sendJson(response, 415, {error: "MIME type not allowed: " + type});
		return;
	}
	// Resolve and security-check the target path
	var resolved = path.resolve(basePath, targetPath);
	if(path.relative(basePath, resolved).indexOf("..") === 0) {
		sendJson(response, 403, {error: "Path traversal not allowed"});
		return;
	}
	// Create subdirectories and write file
	$tw.utils.createDirectory(path.dirname(resolved));
	var buf = Buffer.from(content, "base64");
	fs.writeFile(resolved, buf, function(err) {
		if(err) {
			logger.log("Write error: " + err.message);
			sendJson(response, 500, {error: "Failed to write file: " + err.message});
			return;
		}
		var canonicalUri = "/files/" + targetPath.replace(/\\/g, "/");
		var result = {canonicalUri: canonicalUri, filename: filename};
		// Post-upload processing
		runProcessor(type, resolved, canonicalUri, function(generatedUri) {
			if(generatedUri) {
				result.generatedUri = generatedUri;
			}
			sendJson(response, 200, result);
		});
	});
}

function getAllowedTypes() {
	var tiddler = $tw.wiki.getTiddler("$:/config/rimir/file-upload/media-types");
	if(tiddler) {
		try {
			return JSON.parse(tiddler.fields.text);
		} catch(e) {
			logger.log("Failed to parse media-types config: " + e.message);
		}
	}
	return [];
}

function getProcessorRule(mimeType) {
	if(mimeType.indexOf("image/") === 0) {
		var imgTiddler = $tw.wiki.getTiddler("$:/config/rimir/file-upload/thumb-images");
		if(imgTiddler && imgTiddler.fields.text === "yes") {
			return {action: "thumb-image", outputExt: null};
		}
	}
	if(mimeType === "application/pdf") {
		var pdfTiddler = $tw.wiki.getTiddler("$:/config/rimir/file-upload/thumb-pdfs");
		if(pdfTiddler && pdfTiddler.fields.text === "yes") {
			return {action: "thumb-pdf", outputExt: ".png"};
		}
	}
	return null;
}

function getResolution() {
	var tiddler = $tw.wiki.getTiddler("$:/config/rimir/file-upload/thumb-resolution");
	var raw = (tiddler && tiddler.fields.text || "200").trim();
	// If single number, convert to NxN for ImageMagick
	if(/^\d+$/.test(raw)) {
		return raw + "x" + raw;
	}
	return raw;
}

function runProcessor(mimeType, inputPath, canonicalUri, callback) {
	var rule = getProcessorRule(mimeType);
	if(!rule) {
		callback(null);
		return;
	}
	// Load runner actions config
	var actionsPath = path.resolve($tw.boot.wikiPath, "runner-actions.json");
	var actions;
	try {
		actions = JSON.parse(fs.readFileSync(actionsPath, "utf8"));
	} catch(e) {
		logger.log("Cannot read runner-actions.json: " + e.message);
		callback(null);
		return;
	}
	var actionDef = actions[rule.action];
	if(!actionDef || !actionDef.command) {
		logger.log("Runner action not found: " + rule.action);
		callback(null);
		return;
	}
	// Compute output path: <parentDir>/_generated/<basename>_thumb.<ext>
	var parsed = path.parse(inputPath);
	var generatedDir = path.join(parsed.dir, "_generated");
	$tw.utils.createDirectory(generatedDir);
	var outputExt = rule.outputExt || parsed.ext;
	var outputPath = path.join(generatedDir, parsed.name + "_thumb" + outputExt);
	// Substitute parameters
	var resolution = getResolution();
	var command = actionDef.command;
	command = command.split("{{input}}").join('"' + inputPath + '"');
	command = command.split("{{output}}").join('"' + outputPath + '"');
	command = command.split("{{resolution}}").join(resolution);
	// Execute
	child_process.exec(command, function(err, stdout, stderr) {
		if(err) {
			logger.log("Processor '" + rule.action + "' failed: " + err.message);
			if(stderr) {
				logger.log("stderr: " + stderr);
			}
			callback(null);
		} else {
			// Compute generated canonical URI
			var relPath = path.relative(basePath, outputPath).replace(/\\/g, "/");
			callback("/files/" + relPath);
		}
	});
}

function sendJson(response, statusCode, data) {
	var body = JSON.stringify(data);
	response.writeHead(statusCode, {
		"Content-Type": "application/json",
		"Access-Control-Allow-Origin": "*"
	});
	response.end(body);
}
