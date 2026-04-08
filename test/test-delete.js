/*\
title: $:/plugins/rimir/file-upload/test/test-delete.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for delete route: input validation, security checks, location enforcement.

\*/
"use strict";

describe("file-upload: delete route", function() {

	var deleteRoute = require("$:/plugins/rimir/file-upload/routes/delete");
	var resolver = require("$:/plugins/rimir/file-upload/uri-resolver");
	var TAG = "$:/tags/rimir/file-upload/location";

	var LOC_FILES = "$:/test/delete/loc/files";
	var LOC_READONLY = "$:/test/delete/loc/readonly";

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
		addLocation(LOC_FILES, {name: "del-files", uriPrefix: "/del-files/", writable: true, basePath: "files"});
		addLocation(LOC_READONLY, {name: "del-readonly", uriPrefix: "/del-readonly/", writable: false, basePath: "readonly"});
		resolver.invalidate();
	});

	afterEach(function() {
		$tw.wiki.deleteTiddler(LOC_FILES);
		$tw.wiki.deleteTiddler(LOC_READONLY);
		resolver.invalidate();
	});

	it("should reject invalid JSON body with 400", function() {
		var res = mockResponse();
		deleteRoute.handler({}, res, {data: "not json"});
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toContain("Invalid JSON");
	});

	it("should reject missing uri field with 400", function() {
		var res = mockResponse();
		deleteRoute.handler({}, res, {data: JSON.stringify({})});
		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toContain("Missing required field");
	});

	it("should reject path traversal with 403", function() {
		var res = mockResponse();
		deleteRoute.handler({}, res, {data: JSON.stringify({uri: "/del-files/../../etc/passwd"})});
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body).error).toContain("traversal");
	});

	it("should reject unknown location URI with 403", function() {
		var res = mockResponse();
		deleteRoute.handler({}, res, {data: JSON.stringify({uri: "/unknown/file.txt"})});
		expect(res.statusCode).toBe(403);
	});

	it("should reject read-only location with 403", function() {
		var res = mockResponse();
		deleteRoute.handler({}, res, {data: JSON.stringify({uri: "/del-readonly/file.txt"})});
		expect(res.statusCode).toBe(403);
		expect(JSON.parse(res.body).error).toContain("read-only");
	});

	it("should reject non-existent file with 404", function() {
		var res = mockResponse();
		deleteRoute.handler({}, res, {data: JSON.stringify({uri: "/del-files/nonexistent-file-xyz.png"})});
		expect(res.statusCode).toBe(404);
		expect(JSON.parse(res.body).error).toContain("not found");
	});

	it("should export POST method and correct path regex", function() {
		expect(deleteRoute.method).toBe("POST");
		expect(deleteRoute.path.test("/api/file-delete")).toBe(true);
		expect(deleteRoute.path.test("/api/file-delete/extra")).toBe(false);
	});
});
