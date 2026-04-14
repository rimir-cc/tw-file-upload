/*\
title: $:/plugins/rimir/file-upload/routes/upload
type: application/javascript
module-type: route

POST /api/file-upload — receive base64-encoded file, write to target location.
Supports arbitrary writable locations via the location registry.
Optionally runs post-upload processing (thumbnails etc.) via runner actions.

\*/

"use strict";

var fs = require("fs");
var path = require("path");
var child_process = require("child_process");

var resolver = require("$:/plugins/rimir/file-upload/uri-resolver");
var logger = new $tw.utils.Logger("file-upload", {colour: "cyan"});

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
	var locationName = data.location || "files";
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
	// Find the target location
	var locations = resolver.allLocations();
	var targetLocation = null;
	for(var i = 0; i < locations.length; i++) {
		if(locations[i].name === locationName) {
			targetLocation = locations[i];
			break;
		}
	}
	if(!targetLocation) {
		sendJson(response, 400, {error: "Unknown location: " + locationName});
		return;
	}
	if(!targetLocation.writable) {
		sendJson(response, 403, {error: "Location is read-only: " + locationName});
		return;
	}
	if(!targetLocation.basePath) {
		sendJson(response, 400, {error: "Location has no basePath: " + locationName});
		return;
	}
	// Resolve and security-check the target path
	var basePath = path.resolve($tw.boot.wikiPath, targetLocation.basePath);
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
		// Build canonical URI using the location's uriPrefix
		var relPath = targetPath.replace(/\\/g, "/");
		var prefix = targetLocation.uriPrefix;
		if(prefix.charAt(prefix.length - 1) !== "/") prefix += "/";
		var canonicalUri = prefix + relPath;
		var result = {canonicalUri: canonicalUri, filename: filename, location: locationName};
		// Skip thumbnails when file-pipeline is installed (it handles them)
		var hasPipeline = false;
		try { require("$:/plugins/rimir/file-pipeline/pipeline-executor"); hasPipeline = true; } catch(e) {}
		var afterProcessor = function(generatedUri) {
			if(generatedUri) {
				result.generatedUri = generatedUri;
			}
			// Extract EXIF data for images
			if(isExifEnabled() && type.indexOf("image/") === 0) {
				extractExif(resolved, function(exif) {
					if(exif) {
						result.exif = exif;
					}
					sendJson(response, 200, result);
				});
			} else {
				sendJson(response, 200, result);
			}
		};
		if(hasPipeline) {
			afterProcessor(null);
		} else {
			runProcessor(type, resolved, canonicalUri, basePath, afterProcessor);
		}
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
	if(/^\d+$/.test(raw)) {
		return raw + "x" + raw;
	}
	return raw;
}

function runProcessor(mimeType, inputPath, canonicalUri, basePath, callback) {
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
			// Derive generated URI from canonical URI (same directory + _generated/)
			var uriLastSlash = canonicalUri.lastIndexOf("/");
			var uriDir = canonicalUri.substring(0, uriLastSlash);
			var generatedUri = uriDir + "/_generated/" + parsed.name + "_thumb" + outputExt;
			callback(generatedUri);
		}
	});
}

function isExifEnabled() {
	var tiddler = $tw.wiki.getTiddler("$:/config/rimir/file-upload/exif-extraction");
	// Default: yes (enabled unless explicitly disabled)
	return !tiddler || (tiddler.fields.text || "").trim() !== "no";
}

/*
Extract EXIF data from an image using ImageMagick identify.
Returns a flat object with EXIF tag names as keys via callback.
*/
function extractExif(filePath, callback) {
	// Use magick identify with JSON output for reliable parsing
	var command = 'magick identify -format "' +
		'%[EXIF:DateTimeOriginal]||' +
		'%[EXIF:Make]||' +
		'%[EXIF:Model]||' +
		'%[EXIF:ImageWidth]||' +
		'%[EXIF:ImageHeight]||' +
		'%[width]||' +
		'%[height]||' +
		'%[EXIF:GPSLatitude]||' +
		'%[EXIF:GPSLatitudeRef]||' +
		'%[EXIF:GPSLongitude]||' +
		'%[EXIF:GPSLongitudeRef]||' +
		'%[EXIF:Orientation]||' +
		'%[EXIF:ExposureTime]||' +
		'%[EXIF:FNumber]||' +
		'%[EXIF:ISOSpeedRatings]||' +
		'%[EXIF:FocalLength]||' +
		'%[EXIF:LensModel]' +
		'" "' + filePath + '"';
	child_process.exec(command, {timeout: 10000}, function(err, stdout) {
		if(err) {
			logger.log("EXIF extraction failed: " + err.message);
			callback(null);
			return;
		}
		var parts = (stdout || "").split("||");
		var fields = [
			"DateTimeOriginal", "Make", "Model",
			"ExifImageWidth", "ExifImageHeight",
			"PixelWidth", "PixelHeight",
			"GPSLatitude", "GPSLatitudeRef",
			"GPSLongitude", "GPSLongitudeRef",
			"Orientation",
			"ExposureTime", "FNumber", "ISO",
			"FocalLength", "LensModel"
		];
		var exif = {};
		for(var i = 0; i < fields.length && i < parts.length; i++) {
			var val = (parts[i] || "").trim();
			if(val && val !== "unknown") {
				exif[fields[i]] = val;
			}
		}
		// Use pixel dimensions as fallback if EXIF dimensions missing
		if(!exif.ExifImageWidth && exif.PixelWidth) {
			exif.ExifImageWidth = exif.PixelWidth;
		}
		if(!exif.ExifImageHeight && exif.PixelHeight) {
			exif.ExifImageHeight = exif.PixelHeight;
		}
		delete exif.PixelWidth;
		delete exif.PixelHeight;
		// Convert GPS DMS to decimal if present
		if(exif.GPSLatitude) {
			exif.GPSLatitudeDecimal = dmsToDecimal(exif.GPSLatitude, exif.GPSLatitudeRef);
		}
		if(exif.GPSLongitude) {
			exif.GPSLongitudeDecimal = dmsToDecimal(exif.GPSLongitude, exif.GPSLongitudeRef);
		}
		callback(Object.keys(exif).length > 0 ? exif : null);
	});
}

/*
Convert EXIF GPS DMS string "deg/1, min/1, sec/100" + ref "N"/"S"/"E"/"W" to decimal.
*/
function dmsToDecimal(dms, ref) {
	try {
		var parts = dms.split(",").map(function(p) {
			var frac = p.trim().split("/");
			return frac.length === 2 ? parseFloat(frac[0]) / parseFloat(frac[1]) : parseFloat(frac[0]);
		});
		if(parts.length < 3) return null;
		var decimal = parts[0] + parts[1] / 60 + parts[2] / 3600;
		if(ref === "S" || ref === "W") decimal = -decimal;
		return decimal.toFixed(6);
	} catch(e) {
		return null;
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
