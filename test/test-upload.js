/*\
title: $:/plugins/rimir/file-upload/test/test-upload.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for upload route: input validation, MIME filtering, location checks, path traversal.
Tests only validation paths that don't reach fs.writeFile.

\*/
"use strict";

describe("file-upload: upload route", function() {

	var uploadRoute = require("$:/plugins/rimir/file-upload/routes/upload");
	var resolver = require("$:/plugins/rimir/file-upload/uri-resolver");
	var TAG = "$:/tags/rimir/file-upload/location";

	var LOC_FILES = "$:/test/upload/loc/files";
	var LOC_READONLY = "$:/test/upload/loc/readonly";
	var LOC_NO_BASE = "$:/test/upload/loc/nobase";

	function addLocation(title, config) {
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: title, tags: TAG, type: "application/json",
			text: JSON.stringify(config)
		}));
	}

	function mockResponse() {
		var res = {
			statusCode: null, headers: null, body: null,
			writeHead: function(code, headers) { res.statusCode = code; res.headers = headers; },
			end: function(body) { res.body = body; }
		};
		return res;
	}

	function mockRequest() {
		var handlers = {};
		return {
			on: function(event, fn) { handlers[event] = fn; },
			_fire: function(event, data) { if(handlers[event]) handlers[event](data); },
			connection: { destroy: function() {} }
		};
	}

	function fireUpload(req, bodyStr) {
		req._fire("data", bodyStr);
		req._fire("end");
	}

	beforeEach(function() {
		addLocation(LOC_FILES, {name: "test-files", uriPrefix: "/test-files/", writable: true, basePath: "files"});
		addLocation(LOC_READONLY, {name: "test-readonly", uriPrefix: "/test-readonly/", writable: false, basePath: "readonly"});
		addLocation(LOC_NO_BASE, {name: "test-nobase", uriPrefix: "/test-nobase/", writable: true});
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/config/rimir/file-upload/media-types",
			type: "application/json",
			text: JSON.stringify(["image/png", "image/jpeg", "application/pdf"])
		}));
		resolver.invalidate();
	});

	afterEach(function() {
		$tw.wiki.deleteTiddler(LOC_FILES);
		$tw.wiki.deleteTiddler(LOC_READONLY);
		$tw.wiki.deleteTiddler(LOC_NO_BASE);
		$tw.wiki.deleteTiddler("$:/config/rimir/file-upload/media-types");
		resolver.invalidate();
	});

	it("should reject invalid JSON body with 400", function() {
		var req = mockRequest();
		var res = mockResponse();
		uploadRoute.handler(req, res, {});
		fireUpload(req, "not json at all");
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toContain("Invalid JSON");
	});

	it("should reject missing required fields with 400", function() {
		var req = mockRequest();
		var res = mockResponse();
		uploadRoute.handler(req, res, {});
		fireUpload(req, JSON.stringify({filename: "test.png"}));
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toContain("Missing required fields");
	});

	it("should reject disallowed MIME type with 415", function() {
		var req = mockRequest();
		var res = mockResponse();
		uploadRoute.handler(req, res, {});
		fireUpload(req, JSON.stringify({
			filename: "test.exe", type: "application/x-msdownload",
			content: "abc", targetPath: "test.exe", location: "test-files"
		}));
		expect(res.statusCode).toBe(415);
		expect(JSON.parse(res.body).error).toContain("MIME type not allowed");
	});

	it("should reject unknown location with 400", function() {
		var req = mockRequest();
		var res = mockResponse();
		uploadRoute.handler(req, res, {});
		fireUpload(req, JSON.stringify({
			filename: "test.png", type: "image/png",
			content: "abc", targetPath: "test.png", location: "nonexistent"
		}));
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toContain("Unknown location");
	});

	it("should reject read-only location with 403", function() {
		var req = mockRequest();
		var res = mockResponse();
		uploadRoute.handler(req, res, {});
		fireUpload(req, JSON.stringify({
			filename: "test.png", type: "image/png",
			content: "abc", targetPath: "test.png", location: "test-readonly"
		}));
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body).error).toContain("read-only");
	});

	it("should reject location without basePath with 400", function() {
		var req = mockRequest();
		var res = mockResponse();
		uploadRoute.handler(req, res, {});
		fireUpload(req, JSON.stringify({
			filename: "test.png", type: "image/png",
			content: "abc", targetPath: "test.png", location: "test-nobase"
		}));
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toContain("no basePath");
	});

	it("should reject path traversal in targetPath with 403", function() {
		var req = mockRequest();
		var res = mockResponse();
		uploadRoute.handler(req, res, {});
		fireUpload(req, JSON.stringify({
			filename: "test.png", type: "image/png",
			content: "abc", targetPath: "../../etc/passwd", location: "test-files"
		}));
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body).error).toContain("traversal");
	});

	it("should reject when MIME type is not in overridden empty whitelist", function() {
		// Override media-types with empty array (shadow tiddler provides defaults)
		$tw.wiki.addTiddler(new $tw.Tiddler({
			title: "$:/config/rimir/file-upload/media-types",
			type: "application/json", text: "[]"
		}));
		var req = mockRequest();
		var res = mockResponse();
		uploadRoute.handler(req, res, {});
		fireUpload(req, JSON.stringify({
			filename: "test.png", type: "image/png",
			content: "abc", targetPath: "test.png", location: "test-files"
		}));
		expect(res.statusCode).toBe(415);
	});

	it("should export POST method and correct path regex", function() {
		expect(uploadRoute.method).toBe("POST");
		expect(uploadRoute.path.test("/api/file-upload")).toBe(true);
		expect(uploadRoute.path.test("/api/file-upload/extra")).toBe(false);
	});
});
