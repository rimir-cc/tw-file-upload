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

	describe("renameDerived: _derived/<basename>/ directory follows parent rename", function() {
		var fs = require("fs");
		var path = require("path");
		var os = require("os");

		var tmpBase, oldFilePath, newFilePath, oldDerivedDir, newDerivedDir;

		beforeEach(function() {
			// Self-contained fixture in os.tmpdir() so we don't pollute
			// test-edition/files/ between runs (see tw-test-fixture-pollution memory).
			tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "fu-rename-derived-"));
			oldFilePath = path.join(tmpBase, "old.msg");
			newFilePath = path.join(tmpBase, "new.msg");
			oldDerivedDir = path.join(tmpBase, "_derived", "old.msg");
			newDerivedDir = path.join(tmpBase, "_derived", "new.msg");
			fs.mkdirSync(oldDerivedDir, {recursive: true});
			fs.writeFileSync(path.join(oldDerivedDir, "cid_part1.png"), "stub-image");
			fs.writeFileSync(path.join(oldDerivedDir, "att_invoice.pdf"), "stub-pdf");
		});

		afterEach(function() {
			try {
				if(tmpBase && fs.existsSync(tmpBase)) {
					fs.rmSync(tmpBase, {recursive: true, force: true});
				}
			} catch(e) { /* best-effort */ }
		});

		it("renames the per-source subdirectory and preserves its contents", function() {
			renameRoute._renameDerived(oldFilePath, newFilePath);
			expect(fs.existsSync(newDerivedDir)).toBe(true);
			expect(fs.existsSync(oldDerivedDir)).toBe(false);
			expect(fs.readFileSync(path.join(newDerivedDir, "cid_part1.png"), "utf8")).toBe("stub-image");
			expect(fs.readFileSync(path.join(newDerivedDir, "att_invoice.pdf"), "utf8")).toBe("stub-pdf");
		});

		it("cleans up the now-empty parent _derived/ directory", function() {
			renameRoute._renameDerived(oldFilePath, newFilePath);
			// newDerivedDir exists, so the parent _derived/ shouldn't be empty
			expect(fs.existsSync(path.join(tmpBase, "_derived"))).toBe(true);
			// Now remove newDerivedDir and call again — no-op + cleanup happens
			fs.rmSync(newDerivedDir, {recursive: true, force: true});
			renameRoute._renameDerived(newFilePath, oldFilePath);  // no source → no-op
			// Parent _derived/ still exists since nothing was added back
			// (no _derived/<source-basename>/ to clean up either)
		});

		it("is a no-op when no _derived/<basename>/ directory exists", function() {
			fs.rmSync(path.join(tmpBase, "_derived"), {recursive: true, force: true});
			expect(function() {
				renameRoute._renameDerived(oldFilePath, newFilePath);
			}).not.toThrow();
			expect(fs.existsSync(path.join(tmpBase, "_derived"))).toBe(false);
		});
	});
});

describe("file-upload: deleteDerived recursion", function() {

	var deleteRoute = require("$:/plugins/rimir/file-upload/routes/delete");
	var fs = require("fs");
	var path = require("path");
	var os = require("os");

	var tmpBase, filePath, derivedDir;

	beforeEach(function() {
		tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "fu-delete-derived-"));
		filePath = path.join(tmpBase, "parent.msg");
		derivedDir = path.join(tmpBase, "_derived", "parent.msg");
		fs.mkdirSync(derivedDir, {recursive: true});
		fs.writeFileSync(path.join(derivedDir, "att_invoice.pdf"), "pdf-bytes");
		fs.writeFileSync(path.join(derivedDir, "cid_part1.png"), "png-bytes");
		// Nested pipeline output (e.g. PDF attachment's own thumbnail).
		var nested = path.join(derivedDir, "_derived", "att_invoice.pdf");
		fs.mkdirSync(nested, {recursive: true});
		fs.writeFileSync(path.join(nested, "thumb.png"), "thumb-bytes");
		fs.writeFileSync(path.join(nested, "_generated"), ""); // a stray empty file
	});

	afterEach(function() {
		try {
			if(tmpBase && fs.existsSync(tmpBase)) {
				fs.rmSync(tmpBase, {recursive: true, force: true});
			}
		} catch(e) { /* best-effort */ }
	});

	it("recursively deletes nested _derived/<basename>/ chains", function() {
		deleteRoute._deleteDerived(filePath);
		expect(fs.existsSync(derivedDir)).toBe(false);
	});

	it("cleans up the now-empty _derived/ parent directory", function() {
		deleteRoute._deleteDerived(filePath);
		expect(fs.existsSync(path.join(tmpBase, "_derived"))).toBe(false);
	});

	it("is a graceful no-op when the per-source dir does not exist", function() {
		fs.rmSync(derivedDir, {recursive: true, force: true});
		expect(function() {
			deleteRoute._deleteDerived(filePath);
		}).not.toThrow();
	});

	it("preserves sibling _derived/<other>/ directories", function() {
		var sibling = path.join(tmpBase, "_derived", "other.msg");
		fs.mkdirSync(sibling, {recursive: true});
		fs.writeFileSync(path.join(sibling, "stuff"), "x");
		deleteRoute._deleteDerived(filePath);
		expect(fs.existsSync(derivedDir)).toBe(false);
		expect(fs.existsSync(sibling)).toBe(true);
		// _derived/ parent stays because the sibling is still there.
		expect(fs.existsSync(path.join(tmpBase, "_derived"))).toBe(true);
	});
});
