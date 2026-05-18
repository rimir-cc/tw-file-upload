/*\
title: $:/plugins/rimir/file-upload/test/test-file-ops.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Unit tests for file-upload/file-ops.js. Operates against a unique temp
directory per spec via fs.mkdtempSync — no shared state between tests.

\*/
"use strict";

describe("file-upload: file-ops", function() {

	var ops;
	var fs = require("fs");
	var path = require("path");
	var os = require("os");
	var tmpRoot;

	function touch(p, content) {
		var dir = path.dirname(p);
		if(!fs.existsSync(dir)) { fs.mkdirSync(dir, {recursive: true}); }
		fs.writeFileSync(p, content == null ? "" : content);
	}

	beforeEach(function() {
		ops = require("$:/plugins/rimir/file-upload/file-ops.js");
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fileops-"));
	});

	afterEach(function() {
		if(tmpRoot && fs.existsSync(tmpRoot)) {
			fs.rmSync(tmpRoot, {recursive: true, force: true});
		}
	});

	describe("cleanEmptyDirs", function() {
		it("removes empty parent dirs up to (not including) stopAt", function() {
			var a = path.join(tmpRoot, "a");
			var b = path.join(a, "b");
			var c = path.join(b, "c");
			fs.mkdirSync(c, {recursive: true});
			ops.cleanEmptyDirs(c, tmpRoot);
			expect(fs.existsSync(c)).toBe(false);
			expect(fs.existsSync(b)).toBe(false);
			expect(fs.existsSync(a)).toBe(false);
			expect(fs.existsSync(tmpRoot)).toBe(true);
		});

		it("stops when a directory contains files", function() {
			var a = path.join(tmpRoot, "a");
			var b = path.join(a, "b");
			fs.mkdirSync(b, {recursive: true});
			touch(path.join(a, "keepme.txt"));
			ops.cleanEmptyDirs(b, tmpRoot);
			expect(fs.existsSync(b)).toBe(false);
			expect(fs.existsSync(a)).toBe(true);
		});
	});

	describe("deleteGenerated", function() {
		it("removes _generated/<basename>* siblings and the dir if empty", function() {
			var file = path.join(tmpRoot, "doc.pdf");
			touch(file);
			touch(path.join(tmpRoot, "_generated", "doc-thumb.jpg"));
			touch(path.join(tmpRoot, "_generated", "doc.txt"));
			touch(path.join(tmpRoot, "_generated", "other-thumb.jpg")); // not a match
			ops.deleteGenerated(file);
			expect(fs.existsSync(path.join(tmpRoot, "_generated", "doc-thumb.jpg"))).toBe(false);
			expect(fs.existsSync(path.join(tmpRoot, "_generated", "doc.txt"))).toBe(false);
			expect(fs.existsSync(path.join(tmpRoot, "_generated", "other-thumb.jpg"))).toBe(true);
			expect(fs.existsSync(path.join(tmpRoot, "_generated"))).toBe(true); // other still there
		});

		it("removes _generated/ when last matching file is the only entry", function() {
			var file = path.join(tmpRoot, "doc.pdf");
			touch(file);
			touch(path.join(tmpRoot, "_generated", "doc-thumb.jpg"));
			ops.deleteGenerated(file);
			expect(fs.existsSync(path.join(tmpRoot, "_generated"))).toBe(false);
		});

		it("is a no-op when _generated/ doesn't exist", function() {
			var file = path.join(tmpRoot, "doc.pdf");
			touch(file);
			expect(function() { ops.deleteGenerated(file); }).not.toThrow();
		});
	});

	describe("renameGenerated", function() {
		it("renames basename-prefixed entries within the same dir", function() {
			var oldFile = path.join(tmpRoot, "doc.pdf");
			var newFile = path.join(tmpRoot, "renamed.pdf");
			touch(oldFile);
			touch(path.join(tmpRoot, "_generated", "doc-thumb.jpg"));
			touch(path.join(tmpRoot, "_generated", "doc.txt"));
			ops.renameGenerated(oldFile, newFile);
			expect(fs.existsSync(path.join(tmpRoot, "_generated", "doc-thumb.jpg"))).toBe(false);
			expect(fs.existsSync(path.join(tmpRoot, "_generated", "renamed-thumb.jpg"))).toBe(true);
			expect(fs.existsSync(path.join(tmpRoot, "_generated", "renamed.txt"))).toBe(true);
		});

		it("moves entries across dirs when parent dir changed", function() {
			var subDir = path.join(tmpRoot, "sub");
			fs.mkdirSync(subDir);
			var oldFile = path.join(tmpRoot, "doc.pdf");
			var newFile = path.join(subDir, "doc.pdf");
			touch(oldFile);
			touch(path.join(tmpRoot, "_generated", "doc.txt"));
			ops.renameGenerated(oldFile, newFile);
			expect(fs.existsSync(path.join(tmpRoot, "_generated"))).toBe(false);
			expect(fs.existsSync(path.join(subDir, "_generated", "doc.txt"))).toBe(true);
		});
	});

	describe("deleteDerived", function() {
		it("recursively removes _derived/<basename>/", function() {
			var file = path.join(tmpRoot, "msg.eml");
			touch(file);
			touch(path.join(tmpRoot, "_derived", "msg.eml", "page1.png"));
			touch(path.join(tmpRoot, "_derived", "msg.eml", "nested", "a.txt"));
			ops.deleteDerived(file);
			expect(fs.existsSync(path.join(tmpRoot, "_derived", "msg.eml"))).toBe(false);
		});

		it("removes _derived/ parent when last sibling is gone", function() {
			var file = path.join(tmpRoot, "msg.eml");
			touch(file);
			touch(path.join(tmpRoot, "_derived", "msg.eml", "a.txt"));
			ops.deleteDerived(file);
			expect(fs.existsSync(path.join(tmpRoot, "_derived"))).toBe(false);
		});

		it("leaves _derived/ alone when other siblings exist", function() {
			var file = path.join(tmpRoot, "msg.eml");
			touch(file);
			touch(path.join(tmpRoot, "_derived", "msg.eml", "a.txt"));
			touch(path.join(tmpRoot, "_derived", "other.eml", "b.txt"));
			ops.deleteDerived(file);
			expect(fs.existsSync(path.join(tmpRoot, "_derived", "msg.eml"))).toBe(false);
			expect(fs.existsSync(path.join(tmpRoot, "_derived", "other.eml", "b.txt"))).toBe(true);
		});

		it("handles nested _derived/_derived/ chains from recursive pipelines", function() {
			// This is the case finalize-route's old cleanupDerived() failed on.
			var file = path.join(tmpRoot, "msg.eml");
			touch(file);
			touch(path.join(tmpRoot, "_derived", "msg.eml", "attach.pdf"));
			touch(path.join(tmpRoot, "_derived", "msg.eml", "_derived", "attach.pdf", "page1.png"));
			expect(function() { ops.deleteDerived(file); }).not.toThrow();
			expect(fs.existsSync(path.join(tmpRoot, "_derived", "msg.eml"))).toBe(false);
		});

		it("is a no-op when _derived/<basename>/ doesn't exist", function() {
			var file = path.join(tmpRoot, "msg.eml");
			touch(file);
			expect(function() { ops.deleteDerived(file); }).not.toThrow();
		});
	});

	describe("renameDerived", function() {
		it("renames the basename-keyed dir within the same parent", function() {
			var oldFile = path.join(tmpRoot, "msg.eml");
			var newFile = path.join(tmpRoot, "archived.eml");
			touch(oldFile);
			touch(path.join(tmpRoot, "_derived", "msg.eml", "a.txt"));
			ops.renameDerived(oldFile, newFile);
			expect(fs.existsSync(path.join(tmpRoot, "_derived", "msg.eml"))).toBe(false);
			expect(fs.existsSync(path.join(tmpRoot, "_derived", "archived.eml", "a.txt"))).toBe(true);
		});

		it("moves across parent dirs", function() {
			var subDir = path.join(tmpRoot, "archive");
			fs.mkdirSync(subDir);
			var oldFile = path.join(tmpRoot, "msg.eml");
			var newFile = path.join(subDir, "msg.eml");
			touch(oldFile);
			touch(path.join(tmpRoot, "_derived", "msg.eml", "a.txt"));
			ops.renameDerived(oldFile, newFile);
			expect(fs.existsSync(path.join(tmpRoot, "_derived"))).toBe(false);
			expect(fs.existsSync(path.join(subDir, "_derived", "msg.eml", "a.txt"))).toBe(true);
		});
	});
});
