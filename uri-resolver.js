/*\
title: $:/plugins/rimir/file-upload/uri-resolver
type: application/javascript
module-type: library

Server-side URI resolution library. Maps _canonical_uri values to filesystem paths
using the location registry (tiddlers tagged $:/tags/rimir/file-upload/location).

Shared by file-upload routes, runner extract-route, and any other plugin that
needs to resolve file URIs to disk paths.

\*/

"use strict";

var path = require("path");

var TAG = "$:/tags/rimir/file-upload/location";
var logger = new $tw.utils.Logger("file-upload", {colour: "cyan"});

// Cache locations; rebuilt on demand
var _cachedLocations = null;

/*
Read all location tiddlers and return parsed configs.
Caches result; call invalidate() after changing location tiddlers at runtime.
*/
function loadLocations() {
	if(_cachedLocations) {
		return _cachedLocations;
	}
	var locations = [];
	var titles = $tw.wiki.filterTiddlers("[all[tiddlers+shadows]tag[" + TAG + "]]");
	for(var i = 0; i < titles.length; i++) {
		var tiddler = $tw.wiki.getTiddler(titles[i]);
		if(!tiddler) continue;
		var config;
		try {
			config = JSON.parse(tiddler.fields.text);
		} catch(e) {
			logger.log("Invalid location config: " + titles[i]);
			continue;
		}
		if(!config.name || !config.uriPrefix) {
			logger.log("Location missing name/uriPrefix: " + titles[i]);
			continue;
		}
		// Normalize uriPrefix to always start and end with /
		var prefix = config.uriPrefix;
		if(prefix.charAt(0) !== "/") prefix = "/" + prefix;
		if(prefix.charAt(prefix.length - 1) !== "/") prefix = prefix + "/";
		locations.push({
			title: titles[i],
			name: config.name,
			uriPrefix: prefix,
			writable: !!config.writable,
			basePath: config.basePath || null,
			subFolder: config.subFolder || null,
			provider: config.provider || null,
			dirPattern: config.dirPattern || null
		});
	}
	// Sort by prefix length descending (longest match first)
	locations.sort(function(a, b) {
		return b.uriPrefix.length - a.uriPrefix.length;
	});
	_cachedLocations = locations;
	return locations;
}

/*
Invalidate cached locations. Call after adding/removing location tiddlers.
*/
exports.invalidate = function() {
	_cachedLocations = null;
};

/*
Get all registered locations.
Returns: Array of location config objects.
*/
exports.allLocations = function() {
	return loadLocations();
};

/*
Find the location config for a given URI.
Returns: location object or null.
*/
exports.getLocation = function(uri) {
	var decoded = decodeURIComponent(uri);
	var locations = loadLocations();
	for(var i = 0; i < locations.length; i++) {
		if(decoded.indexOf(locations[i].uriPrefix) === 0) {
			return locations[i];
		}
	}
	return null;
};

/*
Check if a URI points to a writable location.
*/
exports.isWritable = function(uri) {
	var loc = exports.getLocation(uri);
	return loc ? loc.writable : false;
};

/*
Resolve a _canonical_uri to a filesystem path.
Handles:
- /files/* -> <wikiPath>/files/*
- Scattered-binaries routes -> profile basePath + dirName + subFolder + filePath
- User-created locations -> basePath + relative path
Returns: absolute filesystem path, or null if unresolvable.
*/
exports.resolve = function(uri) {
	var decoded = decodeURIComponent(uri);
	var loc = exports.getLocation(uri);
	if(!loc) {
		// Fallback: if starts with /, treat as relative to wikiPath
		if(decoded.charAt(0) === "/") decoded = decoded.substring(1);
		return path.resolve($tw.boot.wikiPath, decoded);
	}
	var remainder = decoded.substring(loc.uriPrefix.length);
	// Scattered-binaries provider: URI format is /<routePrefix>/<dirName>/<filePath>
	// Filesystem: basePath/<dirName>/<subFolder>/<filePath>
	if(loc.provider === "scattered-binaries" && loc.subFolder) {
		var slashIdx = remainder.indexOf("/");
		if(slashIdx === -1) return null;
		var dirName = remainder.substring(0, slashIdx);
		var filePath = remainder.substring(slashIdx + 1);
		return path.resolve($tw.boot.wikiPath, loc.basePath, dirName, loc.subFolder, filePath);
	}
	// Standard location: basePath + remainder
	if(loc.basePath) {
		return path.resolve($tw.boot.wikiPath, loc.basePath, remainder);
	}
	return null;
};

/*
Resolve a URI and verify it doesn't escape the location's base directory.
Returns: { filePath: string, location: object } or null if traversal detected.
*/
exports.resolveSecure = function(uri) {
	var loc = exports.getLocation(uri);
	if(!loc || !loc.basePath) return null;
	var filePath = exports.resolve(uri);
	if(!filePath) return null;
	var baseDir = path.resolve($tw.boot.wikiPath, loc.basePath);
	var rel = path.relative(baseDir, filePath);
	if(rel.indexOf("..") === 0 || path.isAbsolute(rel)) {
		return null;
	}
	return { filePath: filePath, location: loc };
};

/*
Build a canonical URI from a location name and a relative path.
*/
exports.buildUri = function(locationName, relativePath) {
	var locations = loadLocations();
	for(var i = 0; i < locations.length; i++) {
		if(locations[i].name === locationName) {
			var sanitized = relativePath.replace(/\\/g, "/");
			if(sanitized.charAt(0) === "/") sanitized = sanitized.substring(1);
			return locations[i].uriPrefix + sanitized;
		}
	}
	return null;
};
