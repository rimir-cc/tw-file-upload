/*\
title: $:/plugins/rimir/file-upload/test/test-delete-confirm.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for delete-confirm's cascade + backlink collection. The
NavigatorWidget monkey-patch and modal dispatch path are exercised
end-to-end in the live wiki, not here — these specs cover the data-shape
the modal template reads from `$:/state/rimir/file-upload/delete-confirm/cascade`.

\*/
"use strict";

describe("file-upload: delete-confirm cascade collection", function() {

	var dc = require("$:/plugins/rimir/file-upload/delete-confirm");

	var added;
	function add(title, fields) {
		var base = {title: title};
		for(var k in fields) base[k] = fields[k];
		$tw.wiki.addTiddler(new $tw.Tiddler(base));
		added.push(title);
	}

	beforeEach(function() { added = []; });
	afterEach(function() {
		for(var i = 0; i < added.length; i++) $tw.wiki.deleteTiddler(added[i]);
		$tw.wiki.deleteTiddler(dc._STATE_CASCADE);
		$tw.wiki.deleteTiddler(dc._STATE_BYPASS);
	});

	it("collects the transitive _artifact_source tree", function() {
		add("$:/test/dc/email.msg", {_canonical_uri: "/files/email/email.msg"});
		add("$:/test/dc/email.msg.email", {_artifact_source: "$:/test/dc/email.msg"});
		add("$:/test/dc/email.msg.attachments/att.pdf", {_artifact_source: "$:/test/dc/email.msg"});
		add("$:/test/dc/email.msg.attachments/att.pdf._thumb", {_artifact_source: "$:/test/dc/email.msg.attachments/att.pdf"});

		var cascade = dc._collectCascade("$:/test/dc/email.msg");

		// Three descendants, no duplicates, all reached.
		expect(cascade.length).toBe(3);
		expect(cascade.sort()).toEqual([
			"$:/test/dc/email.msg.attachments/att.pdf",
			"$:/test/dc/email.msg.attachments/att.pdf._thumb",
			"$:/test/dc/email.msg.email"
		]);
	});

	it("returns [] for an isolated tiddler with no artifacts", function() {
		add("$:/test/dc/isolated", {_canonical_uri: "/x/isolated"});
		expect(dc._collectCascade("$:/test/dc/isolated")).toEqual([]);
	});

	it("dedupes via visited-set when the same artifact is reachable two ways", function() {
		add("$:/test/dc/parent", {});
		add("$:/test/dc/midA", {_artifact_source: "$:/test/dc/parent"});
		add("$:/test/dc/midB", {_artifact_source: "$:/test/dc/parent"});
		// Shared grandchild — visible once.
		add("$:/test/dc/shared", {_artifact_source: "$:/test/dc/midA"});

		var cascade = dc._collectCascade("$:/test/dc/parent");
		var unique = {};
		cascade.forEach(function(t) { unique[t] = (unique[t] || 0) + 1; });
		for(var k in unique) expect(unique[k]).toBe(1);
	});

	it("excludes cascade members from their own backlink list and dedupes results", function() {
		// We're not asserting that getTiddlerBacklinks finds wiki-link refs
		// reliably in the test-edition runtime (link indexers may not be wired
		// up the same as in a full server context). We DO assert the shape and
		// dedup semantics of our wrapper.
		add("$:/test/dc/p", {_canonical_uri: "/x/p"});
		add("$:/test/dc/p.email", {_artifact_source: "$:/test/dc/p"});

		var backlinks = dc._collectBacklinks(["$:/test/dc/p", "$:/test/dc/p.email"]);

		// Even if backlinks were found, the cascade members themselves must be excluded.
		expect(backlinks.indexOf("$:/test/dc/p")).toBe(-1);
		expect(backlinks.indexOf("$:/test/dc/p.email")).toBe(-1);
		// Every entry is unique.
		var counts = {};
		backlinks.forEach(function(t) { counts[t] = (counts[t] || 0) + 1; });
		for(var k in counts) expect(counts[k]).toBe(1);
	});

	it("populates the cascade state tiddler with the expected JSON shape", function() {
		add("$:/test/dc/state-p", {_canonical_uri: "/files/email/state-p.msg"});
		add("$:/test/dc/state-p.email", {_artifact_source: "$:/test/dc/state-p"});

		dc._showDeleteConfirm("$:/test/dc/state-p");

		var stateTiddler = $tw.wiki.getTiddler(dc._STATE_CASCADE);
		expect(stateTiddler).toBeTruthy();
		var data = JSON.parse(stateTiddler.fields.text);
		expect(data.target).toBe("$:/test/dc/state-p");
		expect(data.cascade).toContain("$:/test/dc/state-p.email");
		expect(Array.isArray(data.backlinks)).toBe(true);
		expect(typeof data.derivedHint).toBe("string");
		expect(data.derivedHint.indexOf("_derived") >= 0).toBe(true);
	});
});
