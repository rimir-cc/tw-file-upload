/*\
title: $:/plugins/rimir/file-upload/test/test-dropzone.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for file-dropzone widget: target path computation, dedup helpers,
MIME filtering, location URI prefix lookup, content hash search.

\*/
"use strict";

describe("file-upload: dropzone widget", function() {

	var Widget = require("$:/plugins/rimir/file-upload/widgets/dropzone")["file-dropzone"];
	var TAG = "$:/tags/rimir/file-upload/location";

	// Create a widget stub with wiki set, bypassing initialise()
	function makeWidget(wiki, overrides) {
		var w = Object.create(Widget.prototype);
		w.wiki = wiki;
		w.location = (overrides && overrides.location) || "files";
		w.subfolder = (overrides && overrides.subfolder) || null;
		w.targetPrefix = (overrides && overrides.targetPrefix) || null;
		w.properties = (overrides && overrides.properties) || {};
		return w;
	}

	function setupWiki(tiddlers) {
		var wiki = new $tw.Wiki();
		if(tiddlers) wiki.addTiddlers(tiddlers);
		return wiki;
	}

	describe("computeTargetPath", function() {
		it("should route images to images/ subfolder by MIME type", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki);
			var result = w.computeTargetPath({title: "photo.png", type: "image/png"});
			expect(result).toBe("images/photo.png");
		});

		it("should route PDFs to pdf/ subfolder", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki);
			var result = w.computeTargetPath({title: "report.pdf", type: "application/pdf"});
			expect(result).toBe("pdf/report.pdf");
		});

		it("should use subfolder attribute when set", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki, {subfolder: "custom"});
			var result = w.computeTargetPath({title: "file.png", type: "image/png"});
			expect(result).toBe("custom/file.png");
		});

		it("should use prop-upload-folder when set", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki, {properties: {"upload-folder": "project1"}});
			var result = w.computeTargetPath({title: "doc.pdf", type: "application/pdf"});
			expect(result).toBe("project1/doc.pdf");
		});

		it("should prefer subfolder over prop-upload-folder", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki, {subfolder: "explicit", properties: {"upload-folder": "fromProp"}});
			var result = w.computeTargetPath({title: "file.txt", type: "text/plain"});
			expect(result).toBe("explicit/file.txt");
		});

		it("should insert target-prefix between subfolder and filename", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki, {subfolder: "images", targetPrefix: "2024"});
			var result = w.computeTargetPath({title: "photo.jpg", type: "image/jpeg"});
			expect(result).toBe("images/2024/photo.jpg");
		});

		it("should insert target-prefix with MIME routing", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki, {targetPrefix: "batch1"});
			var result = w.computeTargetPath({title: "photo.jpg", type: "image/jpeg"});
			expect(result).toBe("images/batch1/photo.jpg");
		});

		it("should return plain filename for unknown type without subfolder", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki);
			var result = w.computeTargetPath({title: "data.csv", type: "text/csv"});
			expect(result).toBe("data.csv");
		});

		it("should prepend target-prefix for unknown type without subfolder", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki, {targetPrefix: "misc"});
			var result = w.computeTargetPath({title: "data.csv", type: "text/csv"});
			expect(result).toBe("misc/data.csv");
		});
	});

	describe("getAllowedTypes", function() {
		it("should return parsed MIME types from config", function() {
			var wiki = setupWiki([{
				title: "$:/config/rimir/file-upload/media-types",
				type: "application/json",
				text: JSON.stringify(["image/png", "application/pdf"])
			}]);
			var w = makeWidget(wiki);
			var types = w.getAllowedTypes();
			expect(types).toEqual(["image/png", "application/pdf"]);
		});

		it("should return empty array when config is missing", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki);
			expect(w.getAllowedTypes()).toEqual([]);
		});

		it("should return empty array for invalid JSON config", function() {
			var wiki = setupWiki([{
				title: "$:/config/rimir/file-upload/media-types",
				text: "not json"
			}]);
			var w = makeWidget(wiki);
			expect(w.getAllowedTypes()).toEqual([]);
		});
	});

	describe("getLocationUriPrefix", function() {
		it("should return uriPrefix for matching location", function() {
			var wiki = setupWiki([{
				title: "$:/config/rimir/file-upload/locations/test",
				tags: TAG, type: "application/json",
				text: JSON.stringify({name: "myfiles", uriPrefix: "/myfiles/"})
			}]);
			var w = makeWidget(wiki, {location: "myfiles"});
			expect(w.getLocationUriPrefix()).toBe("/myfiles/");
		});

		it("should normalize prefix to end with /", function() {
			var wiki = setupWiki([{
				title: "$:/config/rimir/file-upload/locations/test",
				tags: TAG, type: "application/json",
				text: JSON.stringify({name: "myfiles", uriPrefix: "/myfiles"})
			}]);
			var w = makeWidget(wiki, {location: "myfiles"});
			expect(w.getLocationUriPrefix()).toBe("/myfiles/");
		});

		it("should return /files/ as default when no location matches", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki, {location: "nonexistent"});
			expect(w.getLocationUriPrefix()).toBe("/files/");
		});
	});

	describe("isGlobalDedupEnabled", function() {
		it("should return true when config is 'yes'", function() {
			var wiki = setupWiki([{
				title: "$:/config/rimir/file-upload/global-dedup", text: "yes"
			}]);
			var w = makeWidget(wiki);
			expect(w.isGlobalDedupEnabled()).toBe(true);
		});

		it("should return false when config is 'no'", function() {
			var wiki = setupWiki([{
				title: "$:/config/rimir/file-upload/global-dedup", text: "no"
			}]);
			var w = makeWidget(wiki);
			expect(w.isGlobalDedupEnabled()).toBe(false);
		});

		it("should return falsy when config is missing", function() {
			var wiki = setupWiki();
			var w = makeWidget(wiki);
			expect(w.isGlobalDedupEnabled()).toBeFalsy();
		});
	});

	describe("findTiddlerByContentHash", function() {
		it("should find tiddler with matching hash", function() {
			var wiki = setupWiki([
				{title: "FileA", _content_hash: "abc12345"},
				{title: "FileB", _content_hash: "def67890"}
			]);
			var w = makeWidget(wiki);
			expect(w.findTiddlerByContentHash("def67890")).toBe("FileB");
		});

		it("should return null when no match", function() {
			var wiki = setupWiki([
				{title: "FileA", _content_hash: "abc12345"}
			]);
			var w = makeWidget(wiki);
			expect(w.findTiddlerByContentHash("zzz99999")).toBeNull();
		});

		it("should return null when no tiddlers have hash field", function() {
			var wiki = setupWiki([{title: "Plain"}]);
			var w = makeWidget(wiki);
			expect(w.findTiddlerByContentHash("abc")).toBeNull();
		});
	});

	describe("findTiddlerByCanonicalUri", function() {
		it("should find tiddler with matching URI", function() {
			var wiki = setupWiki([
				{title: "Photo", _canonical_uri: "/files/images/photo.png"},
				{title: "Doc", _canonical_uri: "/files/pdf/doc.pdf"}
			]);
			var w = makeWidget(wiki);
			expect(w.findTiddlerByCanonicalUri("/files/pdf/doc.pdf")).toBe("Doc");
		});

		it("should return null when no match", function() {
			var wiki = setupWiki([
				{title: "Photo", _canonical_uri: "/files/images/photo.png"}
			]);
			var w = makeWidget(wiki);
			expect(w.findTiddlerByCanonicalUri("/files/other.png")).toBeNull();
		});
	});
});
