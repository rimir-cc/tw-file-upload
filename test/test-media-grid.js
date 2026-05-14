/*\
title: $:/plugins/rimir/file-upload/test/test-media-grid.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Pins for the filter functions inside `templates/media-grid.tid` — `fu-att-label`
and `fu-att-newtab-href`. The wikitext procedures themselves aren't unit-
renderable here without a navigator, but the filter behavior they compose
around is testable in isolation.

\*/
"use strict";

describe("file-upload: media-grid filter functions", function () {

	var added = [];

	function add(title, fields) {
		var base = {title: title};
		for(var k in fields) base[k] = fields[k];
		$tw.wiki.addTiddler(new $tw.Tiddler(base));
		added.push(title);
	}

	beforeEach(function() { added = []; });
	afterEach(function() {
		for(var i = 0; i < added.length; i++) $tw.wiki.deleteTiddler(added[i]);
	});

	function evalFn(filter, attTitle) {
		// Evaluate `filter` (which uses <att>) with att=attTitle in scope.
		return $tw.wiki.filterTiddlers(filter, {
			getVariable: function(name) {
				if(name === "att") return attTitle;
				return undefined;
			}
		});
	}

	// fu-att-label: for an .msg tiddler whose .email sibling has msg-subject,
	// return the subject; otherwise the filename's last path segment.
	describe("fu-att-label-shape", function () {

		it("returns the .email's msg-subject for an .msg tiddler", function () {
			var msg = "$:/test/fu/mailbox/foo.msg";
			add(msg, {type: "application/vnd.ms-outlook"});
			add(msg + ".email", {
				type: "text/x-frontmattered-markdown",
				"msg-subject": "Project kickoff",
				_artifact_source: msg
			});
			var out = evalFn(
				"[<att>get[type]match[application/vnd.ms-outlook]then<att>addsuffix[.email]get[msg-subject]] ~[<att>get[title]split[/]last[]]",
				msg
			);
			expect(out).toEqual(["Project kickoff"]);
		});

		it("falls back to filename last segment when the .email sibling is missing", function () {
			var msg = "$:/test/fu/mailbox/lonely.msg";
			add(msg, {type: "application/vnd.ms-outlook"});
			var out = evalFn(
				"[<att>get[type]match[application/vnd.ms-outlook]then<att>addsuffix[.email]get[msg-subject]] ~[<att>get[title]split[/]last[]]",
				msg
			);
			expect(out).toEqual(["lonely.msg"]);
		});

		it("returns the filename last segment for a non-.msg tiddler", function () {
			var pdf = "$:/test/fu/files/invoice.pdf";
			add(pdf, {type: "application/pdf"});
			var out = evalFn(
				"[<att>get[type]match[application/vnd.ms-outlook]then<att>addsuffix[.email]get[msg-subject]] ~[<att>get[title]split[/]last[]]",
				pdf
			);
			expect(out).toEqual(["invoice.pdf"]);
		});
	});

	// fu-att-newtab-href: for .msg → #<encoded .email>, else _canonical_uri.
	describe("fu-att-newtab-href-shape", function () {

		it("returns the appify permalink (#<encoded .email>) for an .msg tiddler", function () {
			var msg = "$:/test/fu/m.msg";
			add(msg, {
				type: "application/vnd.ms-outlook",
				_canonical_uri: "/files/email/m.msg"
			});
			var out = evalFn(
				"[<att>get[type]match[application/vnd.ms-outlook]then<att>addsuffix[.email]encodeuricomponent[]addprefix[#]] ~[<att>get[_canonical_uri]]",
				msg
			);
			expect(out.length).toBe(1);
			expect(out[0].charAt(0)).toBe("#");
			// The .email title contains ':' which encodeuricomponent turns into '%3A'
			expect(out[0]).toContain("%3A");
			expect(out[0]).toContain("m.msg.email");
		});

		it("returns the _canonical_uri for a non-.msg tiddler", function () {
			var pdf = "$:/test/fu/p.pdf";
			add(pdf, {
				type: "application/pdf",
				_canonical_uri: "/files/pdf/p.pdf"
			});
			var out = evalFn(
				"[<att>get[type]match[application/vnd.ms-outlook]then<att>addsuffix[.email]encodeuricomponent[]addprefix[#]] ~[<att>get[_canonical_uri]]",
				pdf
			);
			expect(out).toEqual(["/files/pdf/p.pdf"]);
		});
	});

	// Grid sectioning: the four <$list> filters inside fu-render-media-grid
	// must split a mixed set into thumbed-non-image / video / image / plain-file
	// with no overlap.
	describe("grid section filters", function () {

		var parent = "$:/test/fu/parent";

		function setupMixed() {
			add(parent, {type: "text/vnd.tiddlywiki", caption: "p"});
			add("$:/test/fu/items/a.pdf", {
				type: "application/pdf",
				pa_parent: parent, // (filter uses pa.parent, but our test filter is generic)
				_thumbnail_uri: "/g/a.png",
				_canonical_uri: "/f/a.pdf"
			});
			add("$:/test/fu/items/b.mp4", {
				type: "video/mp4",
				pa_parent: parent,
				_thumbnail_uri: "/g/b.png",
				_canonical_uri: "/f/b.mp4"
			});
			add("$:/test/fu/items/c.jpg", {
				type: "image/jpeg",
				pa_parent: parent,
				_canonical_uri: "/f/c.jpg"
			});
			add("$:/test/fu/items/d.zip", {
				type: "application/zip",
				pa_parent: parent,
				_canonical_uri: "/f/d.zip"
			});
		}

		var ALL = "[all[tiddlers]prefix[$:/test/fu/items/]]";

		it("section 1 picks PDFs (thumb + non-image/non-video)", function () {
			setupMixed();
			var out = $tw.wiki.filterTiddlers(
				ALL + " :filter[has[_thumbnail_uri]] :filter[get[type]!prefix[image/]!prefix[video/]]"
			);
			expect(out).toEqual(["$:/test/fu/items/a.pdf"]);
		});

		it("section 2 picks videos (thumb + video/)", function () {
			setupMixed();
			var out = $tw.wiki.filterTiddlers(
				ALL + " :filter[has[_thumbnail_uri]] :filter[get[type]prefix[video/]]"
			);
			expect(out).toEqual(["$:/test/fu/items/b.mp4"]);
		});

		it("section 3 picks images (with or without thumb)", function () {
			setupMixed();
			var out = $tw.wiki.filterTiddlers(
				ALL + " :filter[get[type]prefix[image/]]"
			);
			expect(out).toEqual(["$:/test/fu/items/c.jpg"]);
		});

		it("section 4 picks plain files (no thumb + non-image)", function () {
			setupMixed();
			var out = $tw.wiki.filterTiddlers(
				ALL + " :filter[!has[_thumbnail_uri]] :filter[get[type]!prefix[image/]]"
			);
			expect(out).toEqual(["$:/test/fu/items/d.zip"]);
		});

		it("the four sections together cover every item exactly once", function () {
			setupMixed();
			var s1 = $tw.wiki.filterTiddlers(ALL + " :filter[has[_thumbnail_uri]] :filter[get[type]!prefix[image/]!prefix[video/]]");
			var s2 = $tw.wiki.filterTiddlers(ALL + " :filter[has[_thumbnail_uri]] :filter[get[type]prefix[video/]]");
			var s3 = $tw.wiki.filterTiddlers(ALL + " :filter[get[type]prefix[image/]]");
			var s4 = $tw.wiki.filterTiddlers(ALL + " :filter[!has[_thumbnail_uri]] :filter[get[type]!prefix[image/]]");
			var union = s1.concat(s2).concat(s3).concat(s4).sort();
			expect(union).toEqual([
				"$:/test/fu/items/a.pdf",
				"$:/test/fu/items/b.mp4",
				"$:/test/fu/items/c.jpg",
				"$:/test/fu/items/d.zip"
			]);
		});
	});
});
