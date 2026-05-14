/*\
title: $:/plugins/rimir/file-upload/test/test-cascade.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for the transitive `_artifact_source` cascade in startup.js —
delete walks BFS-by-source and rename rewires multi-level descendants.

\*/
"use strict";

describe("file-upload: cascade walk (delete)", function() {

	var startup = require("$:/plugins/rimir/file-upload/startup");

	var added;
	var origDelete;
	var deletedFiles;

	function addTiddler(title, fields) {
		var base = {title: title};
		for(var k in fields) base[k] = fields[k];
		$tw.wiki.addTiddler(new $tw.Tiddler(base));
		added.push(title);
	}

	beforeEach(function() {
		added = [];
		deletedFiles = [];
		origDelete = startup._deleteFileFromServer;
		startup._deleteFileFromServer = function(uri) { deletedFiles.push(uri); };
	});

	afterEach(function() {
		startup._deleteFileFromServer = origDelete;
		for(var i = 0; i < added.length; i++) {
			$tw.wiki.deleteTiddler(added[i]);
		}
	});

	it("walks A -> B -> C -> D and deletes all three descendants", function() {
		addTiddler("$:/test/cascade/A", {_canonical_uri: "/files/A"});
		addTiddler("$:/test/cascade/B", {_artifact_source: "$:/test/cascade/A", _canonical_uri: "/files/B", _artifact_type: "attachment"});
		addTiddler("$:/test/cascade/C", {_artifact_source: "$:/test/cascade/B", _canonical_uri: "/files/C", _artifact_type: "thumbnail"});
		addTiddler("$:/test/cascade/D", {_artifact_source: "$:/test/cascade/B", _artifact_type: "extraction"});

		var count = startup._cascadeDeleteArtifacts("$:/test/cascade/A");

		expect(count).toBe(3);
		expect($tw.wiki.tiddlerExists("$:/test/cascade/B")).toBe(false);
		expect($tw.wiki.tiddlerExists("$:/test/cascade/C")).toBe(false);
		expect($tw.wiki.tiddlerExists("$:/test/cascade/D")).toBe(false);
		// A itself stays — caller deletes it separately.
		expect($tw.wiki.tiddlerExists("$:/test/cascade/A")).toBe(true);
	});

	it("only requests file deletion for file-backed artifact types", function() {
		addTiddler("$:/test/cascade/A2", {_canonical_uri: "/files/A2"});
		addTiddler("$:/test/cascade/B2", {_artifact_source: "$:/test/cascade/A2", _canonical_uri: "/files/B2", _artifact_type: "attachment"});
		addTiddler("$:/test/cascade/C2", {_artifact_source: "$:/test/cascade/A2", _canonical_uri: "/files/C2", _artifact_type: "extraction"});  // text artifact, no file
		addTiddler("$:/test/cascade/D2", {_artifact_source: "$:/test/cascade/A2", _canonical_uri: "/files/D2", _artifact_type: "derived"});

		startup._cascadeDeleteArtifacts("$:/test/cascade/A2");

		expect(deletedFiles.sort()).toEqual(["/files/B2", "/files/D2"]);
	});

	it("survives a cycle (A -> B -> A) without infinite recursion", function() {
		addTiddler("$:/test/cascade/cyc-A", {_canonical_uri: "/files/cyc-A", _artifact_source: "$:/test/cascade/cyc-B"});
		addTiddler("$:/test/cascade/cyc-B", {_artifact_source: "$:/test/cascade/cyc-A"});

		var count;
		expect(function() {
			count = startup._cascadeDeleteArtifacts("$:/test/cascade/cyc-A");
		}).not.toThrow();
		expect(count).toBeGreaterThan(0);
	});

	it("returns 0 for a source with no artifacts", function() {
		addTiddler("$:/test/cascade/leaf", {_canonical_uri: "/files/leaf"});
		expect(startup._cascadeDeleteArtifacts("$:/test/cascade/leaf")).toBe(0);
		expect(deletedFiles.length).toBe(0);
	});
});

describe("file-upload: cascade walk (rename)", function() {

	var startup = require("$:/plugins/rimir/file-upload/startup");

	var added;

	function addTiddler(title, fields) {
		var base = {title: title};
		for(var k in fields) base[k] = fields[k];
		$tw.wiki.addTiddler(new $tw.Tiddler(base));
		added.push(title);
	}

	beforeEach(function() { added = []; });
	afterEach(function() {
		for(var i = 0; i < added.length; i++) $tw.wiki.deleteTiddler(added[i]);
	});

	it("renames title-embedding artifacts at every level of the chain", function() {
		addTiddler("$:/test/ren/email.msg", {_canonical_uri: "/files/email/email.msg"});
		addTiddler("$:/test/ren/email.msg.email", {_artifact_source: "$:/test/ren/email.msg", _artifact_type: "conversion"});
		addTiddler("$:/test/ren/email.msg.attachments/att_invoice.pdf", {_artifact_source: "$:/test/ren/email.msg", _artifact_type: "attachment", _canonical_uri: "/files/email/_derived/email.msg/att_invoice.pdf"});
		addTiddler("$:/test/ren/email.msg.attachments/att_invoice.pdf._thumbnail", {_artifact_source: "$:/test/ren/email.msg.attachments/att_invoice.pdf", _artifact_type: "thumbnail"});

		startup._cascadeRenameArtifacts("$:/test/ren/email.msg", "$:/test/ren/renamed.msg");
		// Track every renamed title so afterEach cleans up.
		added.push("$:/test/ren/renamed.msg.email");
		added.push("$:/test/ren/renamed.msg.attachments/att_invoice.pdf");
		added.push("$:/test/ren/renamed.msg.attachments/att_invoice.pdf._thumbnail");

		expect($tw.wiki.tiddlerExists("$:/test/ren/email.msg.email")).toBe(false);
		expect($tw.wiki.tiddlerExists("$:/test/ren/renamed.msg.email")).toBe(true);
		expect($tw.wiki.getTiddler("$:/test/ren/renamed.msg.email").fields._artifact_source)
			.toBe("$:/test/ren/renamed.msg");

		expect($tw.wiki.tiddlerExists("$:/test/ren/renamed.msg.attachments/att_invoice.pdf")).toBe(true);
		expect($tw.wiki.getTiddler("$:/test/ren/renamed.msg.attachments/att_invoice.pdf").fields._artifact_source)
			.toBe("$:/test/ren/renamed.msg");

		expect($tw.wiki.tiddlerExists("$:/test/ren/renamed.msg.attachments/att_invoice.pdf._thumbnail")).toBe(true);
		expect($tw.wiki.getTiddler("$:/test/ren/renamed.msg.attachments/att_invoice.pdf._thumbnail").fields._artifact_source)
			.toBe("$:/test/ren/renamed.msg.attachments/att_invoice.pdf");
	});

	it("updates _artifact_source only when artifact title does not embed parent", function() {
		addTiddler("$:/test/ren/parent", {_canonical_uri: "/x/parent"});
		addTiddler("$:/test/ren/orphan-artifact", {_artifact_source: "$:/test/ren/parent", _artifact_type: "attachment"});

		startup._cascadeRenameArtifacts("$:/test/ren/parent", "$:/test/ren/new-parent");

		expect($tw.wiki.tiddlerExists("$:/test/ren/orphan-artifact")).toBe(true);
		expect($tw.wiki.getTiddler("$:/test/ren/orphan-artifact").fields._artifact_source)
			.toBe("$:/test/ren/new-parent");
	});

	it("survives a cycle without infinite recursion", function() {
		addTiddler("$:/test/ren/cyc-A", {_artifact_source: "$:/test/ren/cyc-B"});
		addTiddler("$:/test/ren/cyc-B", {_artifact_source: "$:/test/ren/cyc-A"});

		expect(function() {
			startup._cascadeRenameArtifacts("$:/test/ren/cyc-A", "$:/test/ren/cyc-A2");
		}).not.toThrow();
	});
});
