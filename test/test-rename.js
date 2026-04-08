/*\
title: $:/plugins/rimir/file-upload/test/test-rename.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for rename route: input validation, security checks, location enforcement.

\*/
"use strict";

describe("file-upload: rename route", function() {

	var renameRoute = require("$:/plugins/rimir/file-upload/routes/rename");
	var resolver = require("$:/plugins/rimir/file-upload/uri-resolver");
	var TAG = "$:/tags/rimir/file-upload/location";

	var LOC_FILES = "$:/test/rename/loc/files";
	var LOC_READONLY = "$:/test/rename/loc/readonly";

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

	beforeEach(function() {
		addLocation(LOC_FILES, {name: "ren-files", uriPrefix: "/ren-files/", writable: true, basePath: "files"});
		addLocation(LOC_READONLY, {name: "ren-readonly", uriPrefix: "/ren-readonly/", writable: false, basePath: "readonly"});
		resolver.invalidate();
	});

	afterEach(function() {
		$tw.wiki.deleteTiddler(LOC_FILES);
		$tw.wiki.deleteTiddler(LOC_READONLY);
		resolver.invalidate();
	});

	it("should reject invalid JSON body with 400", function() {
		var res = mockResponse();
		renameRoute.handler({}, res, {data: "not json"});
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toContain("Invalid JSON");
	});

	it("should reject missing oldUri with 400", function() {
		var res = mockResponse();
		renameRoute.handler({}, res, {data: JSON.stringify({newUri: "/ren-files/new.png"})});
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toContain("Missing required fields");
	});

	it("should reject missing newUri with 400", function() {
		var res = mockResponse();
		renameRoute.handler({}, res, {data: JSON.stringify({oldUri: "/ren-files/old.png"})});
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toContain("Missing required fields");
	});

	it("should reject path traversal in oldUri with 403", function() {
		var res = mockResponse();
		renameRoute.handler({}, res, {data: JSON.stringify({
			oldUri: "/ren-files/../../etc/passwd",
			newUri: "/ren-files/new.png"
		})});
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body).error).toContain("old URI");
	});

	it("should reject path traversal in newUri with 403", function() {
		var res = mockResponse();
		renameRoute.handler({}, res, {data: JSON.stringify({
			oldUri: "/ren-files/old.png",
			newUri: "/ren-files/../../etc/evil.png"
		})});
		expect(res.statusCode).toBe(403);
		// Old URI resolves OK, but new URI has traversal
		expect(JSON.parse(res.body).error).toContain("new URI");
	});

	it("should reject read-only source location with 403", function() {
		var res = mockResponse();
		renameRoute.handler({}, res, {data: JSON.stringify({
			oldUri: "/ren-readonly/old.png",
			newUri: "/ren-files/new.png"
		})});
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body).error).toContain("read-only");
	});

	it("should reject read-only target location with 403", function() {
		var res = mockResponse();
		renameRoute.handler({}, res, {data: JSON.stringify({
			oldUri: "/ren-files/old.png",
			newUri: "/ren-readonly/new.png"
		})});
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body).error).toContain("read-only");
	});

	it("should reject when source file does not exist with 404", function() {
		var res = mockResponse();
		renameRoute.handler({}, res, {data: JSON.stringify({
			oldUri: "/ren-files/nonexistent-xyz.png",
			newUri: "/ren-files/new.png"
		})});
		expect(res.statusCode).toBe(404);
		expect(JSON.parse(res.body).error).toContain("not found");
	});

	it("should export POST method and correct path regex", function() {
		expect(renameRoute.method).toBe("POST");
		expect(renameRoute.path.test("/api/file-rename")).toBe(true);
	});
});
