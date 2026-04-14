/*\
title: $:/plugins/rimir/file-upload/routes/upload-binary
type: application/javascript
module-type: route

POST /api/file-upload-binary — receive raw binary file body and stream to disk.
Metadata (filename, type, targetPath, location) passed via request headers.
No base64 encoding, no JSON wrapping, no practical size limit.

\*/
"use strict";

var fs = require("fs");
var path = require("path");

var resolver = require("$:/plugins/rimir/file-upload/uri-resolver");
var logger = new $tw.utils.Logger("file-upload", {colour: "cyan"});

exports.method = "POST";
exports.path = /^\/api\/file-upload-binary$/;
exports.bodyFormat = "stream";

exports.handler = function(request, response, state) {
	// Read metadata from headers
	var filename = decodeURIComponent(request.headers["x-upload-filename"] || "");
	var type = request.headers["x-upload-type"] || "";
	var targetPath = decodeURIComponent(request.headers["x-upload-path"] || "");
	var locationName = request.headers["x-upload-location"] || "files";

	if(!filename || !targetPath) {
		sendJson(response, 400, {error: "Missing required headers: x-upload-filename, x-upload-path"});
		request.resume();
		return;
	}

	// Validate MIME type
	var allowedTypes = getAllowedTypes();
	if(allowedTypes.indexOf(type) === -1) {
		sendJson(response, 415, {error: "MIME type not allowed: " + type});
		request.resume();
		return;
	}

	// Resolve target location
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
		request.resume();
		return;
	}
	if(!targetLocation.writable) {
		sendJson(response, 403, {error: "Location is read-only: " + locationName});
		request.resume();
		return;
	}
	if(!targetLocation.basePath) {
		sendJson(response, 400, {error: "Location has no basePath: " + locationName});
		request.resume();
		return;
	}

	// Security check
	var basePath = path.resolve($tw.boot.wikiPath, targetLocation.basePath);
	var resolved = path.resolve(basePath, targetPath);
	if(path.relative(basePath, resolved).indexOf("..") === 0) {
		sendJson(response, 403, {error: "Path traversal not allowed"});
		request.resume();
		return;
	}

	// Create directories and stream to disk
	$tw.utils.createDirectory(path.dirname(resolved));
	var writeStream = fs.createWriteStream(resolved);
	var errored = false;

	writeStream.on("error", function(err) {
		errored = true;
		logger.log("Write error: " + err.message);
		sendJson(response, 500, {error: "Failed to write file: " + err.message});
	});

	writeStream.on("finish", function() {
		if(errored) return;
		// Build canonical URI
		var relPath = targetPath.replace(/\\/g, "/");
		var prefix = targetLocation.uriPrefix;
		if(prefix.charAt(prefix.length - 1) !== "/") prefix += "/";
		var canonicalUri = prefix + relPath;
		var result = {canonicalUri: canonicalUri, filename: filename, location: locationName};

		// Metadata extraction
		if(isExifEnabled()) {
			if(type.indexOf("image/") === 0) {
				extractExif(resolved, function(exif) {
					if(exif) result.exif = exif;
					sendJson(response, 200, result);
				});
			} else if(type.indexOf("video/") === 0) {
				extractVideoMeta(resolved, function(exif) {
					if(exif) result.exif = exif;
					sendJson(response, 200, result);
				});
			} else {
				sendJson(response, 200, result);
			}
		} else {
			sendJson(response, 200, result);
		}
	});

	request.pipe(writeStream);
};

function getAllowedTypes() {
	var tiddler = $tw.wiki.getTiddler("$:/config/rimir/file-upload/media-types");
	if(tiddler) {
		try { return JSON.parse(tiddler.fields.text); } catch(e) {}
	}
	return [];
}

function isExifEnabled() {
	var tiddler = $tw.wiki.getTiddler("$:/config/rimir/file-upload/exif-extraction");
	return !tiddler || (tiddler.fields.text || "").trim() !== "no";
}

function extractExif(filePath, callback) {
	var child_process = require("child_process");
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
		if(!exif.ExifImageWidth && exif.PixelWidth) exif.ExifImageWidth = exif.PixelWidth;
		if(!exif.ExifImageHeight && exif.PixelHeight) exif.ExifImageHeight = exif.PixelHeight;
		delete exif.PixelWidth;
		delete exif.PixelHeight;
		callback(Object.keys(exif).length > 0 ? exif : null);
	});
}

function extractVideoMeta(filePath, callback) {
	var child_process = require("child_process");
	var command = 'ffprobe -v quiet -print_format json -show_format -show_streams "' + filePath + '"';
	child_process.exec(command, {timeout: 15000}, function(err, stdout) {
		if(err) { callback(null); return; }
		var info;
		try { info = JSON.parse(stdout); } catch(e) { callback(null); return; }
		var fmt = info.format || {};
		var tags = fmt.tags || {};
		var exif = {};
		// Creation date
		var dateVal = tags.creation_time || tags.date || "";
		if(dateVal) {
			// Convert ISO to EXIF format: "2026:04:12 10:06:33"
			var d = dateVal.replace(/T/, " ").replace(/Z$/, "").replace(/-/g, ":");
			exif.DateTimeOriginal = d;
		}
		// Dimensions and duration from video stream
		var streams = info.streams || [];
		for(var i = 0; i < streams.length; i++) {
			if(streams[i].codec_type === "video") {
				var vs = streams[i];
				exif.ExifImageWidth = String(vs.width || "");
				exif.ExifImageHeight = String(vs.height || "");
				if(vs.duration) exif.Duration = String(Math.round(parseFloat(vs.duration))) + "s";
				if(vs.r_frame_rate) {
					var fps = vs.r_frame_rate.split("/");
					if(fps.length === 2 && parseInt(fps[1]) > 0) {
						exif.FrameRate = String(Math.round(parseInt(fps[0]) / parseInt(fps[1])));
					}
				}
				if(vs.codec_name) exif.VideoCodec = vs.codec_name;
				break;
			}
		}
		// GPS from format tags (Samsung, Apple, etc.)
		var loc = tags.location || tags["location-eng"] || tags["com.apple.quicktime.location.ISO6709"] || "";
		if(loc) {
			// Format: "+51.0123+013.8051/" or "+51.0123-013.8051/"
			var gps = loc.match(/([+-]\d+\.?\d*?)([+-]\d+\.?\d*)/);
			if(gps) {
				exif.GPSLatitudeDecimal = gps[1];
				exif.GPSLongitudeDecimal = gps[2];
			}
		}
		// Device info
		if(tags["com.android.manufacturer"] || tags.make) exif.Make = tags["com.android.manufacturer"] || tags.make;
		if(tags["com.android.model"] || tags.model) exif.Model = tags["com.android.model"] || tags.model;
		// Clean empty values
		for(var key in exif) {
			if(!exif[key] || exif[key] === "undefined") delete exif[key];
		}
		callback(Object.keys(exif).length > 0 ? exif : null);
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
