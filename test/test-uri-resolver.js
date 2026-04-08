/*\
title: $:/plugins/rimir/file-upload/test/test-uri-resolver.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for uri-resolver: location loading, URI matching, path resolution, security.

\*/
"use strict";

describe("file-upload: uri-resolver", function() {

	var resolver = require("$:/plugins/rimir/file-upload/uri-resolver");
	var path = require("path");
	var TAG = "$:/tags/rimir/file-upload/location";

	// Location tiddler titles used across tests
	var LOC_FILES = "$:/test/loc/files";
	var LOC_DOCS = "$:/test/loc/docs";
	var LOC_READONLY = "$:/test/loc/readonly";
	var LOC_SCATTERED = "$:/test/loc/scattered";
	var LOC_NESTED = "$:/test/loc/nested";

	function addLocation(title, config) {
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: title,
			tags: TAG,
			type: "application/json",
			text: JSON.stringify(config)
		}));
	}

	function removeLocation(title) {
		$tw.wiki.deleteTiddler(title);
	}

	function cleanup() {
		removeLocation(LOC_FILES);
		removeLocation(LOC_DOCS);
		removeLocation(LOC_READONLY);
		removeLocation(LOC_SCATTERED);
		removeLocation(LOC_NESTED);
		resolver.invalidate();
	}

	afterEach(function() {
		cleanup();
	});

	describe("allLocations / loadLocations", function() {
		it("should load valid location configs", function() {
			addLocation(LOC_FILES, {name: "files", uriPrefix: "/files/", writable: true, basePath: "files"});
			resolver.invalidate();
			var locs = resolver.allLocations();
			expect(locs.length).toBeGreaterThan(0);
			var f = locs.find(function(l) { return l.name === "files"; });
			expect(f).toBeDefined();
			expect(f.writable).toBe(true);
			expect(f.basePath).toBe("files");
		});

		it("should skip invalid JSON configs", function() {
			$tw.wiki.addTiddler(new $tw.Tiddler({
				title: LOC_FILES, tags: TAG, type: "application/json", text: "not json"
			}));
			resolver.invalidate();
			var locs = resolver.allLocations();
			var f = locs.find(function(l) { return l.title === LOC_FILES; });
			expect(f).toBeUndefined();
		});

		it("should skip configs missing name or uriPrefix", function() {
			addLocation(LOC_FILES, {writable: true, basePath: "files"});
			resolver.invalidate();
			var locs = resolver.allLocations();
			var f = locs.find(function(l) { return l.title === LOC_FILES; });
			expect(f).toBeUndefined();
		});

		it("should normalize uriPrefix to start and end with /", function() {
			addLocation(LOC_FILES, {name: "files", uriPrefix: "files", writable: true, basePath: "files"});
			resolver.invalidate();
			var locs = resolver.allLocations();
			var f = locs.find(function(l) { return l.name === "files"; });
			expect(f.uriPrefix).toBe("/files/");
		});

		it("should sort by prefix length descending (longest first)", function() {
			addLocation(LOC_FILES, {name: "files", uriPrefix: "/files/", writable: true, basePath: "files"});
			addLocation(LOC_NESTED, {name: "files-images", uriPrefix: "/files/images/", writable: true, basePath: "files/images"});
			resolver.invalidate();
			var locs = resolver.allLocations();
			var filesIdx = -1, nestedIdx = -1;
			for(var i = 0; i < locs.length; i++) {
				if(locs[i].name === "files") filesIdx = i;
				if(locs[i].name === "files-images") nestedIdx = i;
			}
			expect(nestedIdx).toBeLessThan(filesIdx);
		});

		it("should cache results across calls", function() {
			addLocation(LOC_FILES, {name: "files", uriPrefix: "/files/", writable: true, basePath: "files"});
			resolver.invalidate();
			var locs1 = resolver.allLocations();
			var locs2 = resolver.allLocations();
			expect(locs1).toBe(locs2); // Same reference = cached
		});
	});

	describe("invalidate", function() {
		it("should clear cache so next call reloads", function() {
			addLocation(LOC_FILES, {name: "files", uriPrefix: "/files/", writable: true, basePath: "files"});
			resolver.invalidate();
			var locs1 = resolver.allLocations();
			addLocation(LOC_DOCS, {name: "docs", uriPrefix: "/docs/", writable: true, basePath: "docs"});
			// Without invalidate, docs won't appear
			var locs2 = resolver.allLocations();
			expect(locs2.find(function(l) { return l.name === "docs"; })).toBeUndefined();
			// After invalidate, docs appears
			resolver.invalidate();
			var locs3 = resolver.allLocations();
			expect(locs3.find(function(l) { return l.name === "docs"; })).toBeDefined();
		});
	});

	describe("getLocation", function() {
		beforeEach(function() {
			addLocation(LOC_FILES, {name: "files", uriPrefix: "/files/", writable: true, basePath: "files"});
			addLocation(LOC_DOCS, {name: "docs", uriPrefix: "/docs/", writable: true, basePath: "docs"});
			addLocation(LOC_NESTED, {name: "files-images", uriPrefix: "/files/images/", writable: true, basePath: "files/images"});
			resolver.invalidate();
		});

		it("should match URI to location by prefix", function() {
			var loc = resolver.getLocation("/files/photo.png");
			expect(loc).not.toBeNull();
			expect(loc.name).toBe("files");
		});

		it("should return longest prefix match", function() {
			var loc = resolver.getLocation("/files/images/photo.png");
			expect(loc.name).toBe("files-images");
		});

		it("should handle encoded URIs", function() {
			var loc = resolver.getLocation("/files/my%20photo.png");
			expect(loc).not.toBeNull();
			expect(loc.name).toBe("files");
		});

		it("should return null for unknown prefix", function() {
			var loc = resolver.getLocation("/unknown/file.txt");
			expect(loc).toBeNull();
		});
	});

	describe("isWritable", function() {
		beforeEach(function() {
			addLocation(LOC_FILES, {name: "files", uriPrefix: "/files/", writable: true, basePath: "files"});
			addLocation(LOC_READONLY, {name: "readonly", uriPrefix: "/readonly/", writable: false, basePath: "readonly"});
			resolver.invalidate();
		});

		it("should return true for writable location", function() {
			expect(resolver.isWritable("/files/photo.png")).toBe(true);
		});

		it("should return false for read-only location", function() {
			expect(resolver.isWritable("/readonly/file.txt")).toBe(false);
		});

		it("should return false for unknown URI", function() {
			expect(resolver.isWritable("/unknown/file.txt")).toBe(false);
		});
	});

	describe("resolve", function() {
		beforeEach(function() {
			addLocation(LOC_FILES, {name: "files", uriPrefix: "/files/", writable: true, basePath: "files"});
			addLocation(LOC_SCATTERED, {
				name: "scattered", uriPrefix: "/scattered/", writable: false,
				basePath: "tenders", provider: "scattered-binaries", subFolder: "_assets"
			});
			resolver.invalidate();
		});

		it("should resolve standard location URI to filesystem path", function() {
			var result = resolver.resolve("/files/images/photo.png");
			var expected = path.resolve($tw.boot.wikiPath, "files", "images/photo.png");
			expect(result).toBe(expected);
		});

		it("should resolve scattered-binaries provider URI", function() {
			var result = resolver.resolve("/scattered/project1/image.png");
			var expected = path.resolve($tw.boot.wikiPath, "tenders", "project1", "_assets", "image.png");
			expect(result).toBe(expected);
		});

		it("should return null for scattered-binaries URI without slash in remainder", function() {
			var result = resolver.resolve("/scattered/onlydir");
			expect(result).toBeNull();
		});

		it("should fallback to wikiPath-relative for unknown prefix starting with /", function() {
			var result = resolver.resolve("/some/other/path.txt");
			var expected = path.resolve($tw.boot.wikiPath, "some/other/path.txt");
			expect(result).toBe(expected);
		});

		it("should handle encoded URIs", function() {
			var result = resolver.resolve("/files/my%20photo.png");
			var expected = path.resolve($tw.boot.wikiPath, "files", "my photo.png");
			expect(result).toBe(expected);
		});
	});

	describe("resolveSecure", function() {
		beforeEach(function() {
			addLocation(LOC_FILES, {name: "files", uriPrefix: "/files/", writable: true, basePath: "files"});
			resolver.invalidate();
		});

		it("should return filePath and location for valid URI", function() {
			var result = resolver.resolveSecure("/files/images/photo.png");
			expect(result).not.toBeNull();
			expect(result.filePath).toBeDefined();
			expect(result.location.name).toBe("files");
		});

		it("should return null for path traversal attempt", function() {
			var result = resolver.resolveSecure("/files/../../etc/passwd");
			expect(result).toBeNull();
		});

		it("should return null for unknown location", function() {
			var result = resolver.resolveSecure("/unknown/file.txt");
			expect(result).toBeNull();
		});

		it("should return null for location without basePath", function() {
			addLocation(LOC_DOCS, {name: "docs", uriPrefix: "/docs/", writable: true});
			resolver.invalidate();
			var result = resolver.resolveSecure("/docs/file.txt");
			expect(result).toBeNull();
		});
	});

	describe("buildUri", function() {
		beforeEach(function() {
			addLocation(LOC_FILES, {name: "files", uriPrefix: "/files/", writable: true, basePath: "files"});
			resolver.invalidate();
		});

		it("should build URI from location name and relative path", function() {
			var uri = resolver.buildUri("files", "images/photo.png");
			expect(uri).toBe("/files/images/photo.png");
		});

		it("should sanitize backslashes in path", function() {
			var uri = resolver.buildUri("files", "images\\photo.png");
			expect(uri).toBe("/files/images/photo.png");
		});

		it("should strip leading slash from relative path", function() {
			var uri = resolver.buildUri("files", "/images/photo.png");
			expect(uri).toBe("/files/images/photo.png");
		});

		it("should return null for unknown location name", function() {
			var uri = resolver.buildUri("nonexistent", "file.txt");
			expect(uri).toBeNull();
		});
	});
});
