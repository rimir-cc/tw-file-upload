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

	// Build a real root widget once; `:map[...]` subfilter execution needs
	// a widget that can spawn child fake widgets (via makeFakeWidgetWithVariables),
	// which a plain `{getVariable: ...}` stub can't do.
	var ROOT_WIDGET = $tw.wiki.makeWidget(
		$tw.wiki.parseText("text/vnd.tiddlywiki", ""),
		{}
	);

	function evalFn(filter, attTitle) {
		return $tw.wiki.filterTiddlers(
			filter,
			ROOT_WIDGET.makeFakeWidgetWithVariables({att: attTitle})
		);
	}

	// These three filter expressions are LITERAL inlines of the functions
	// defined in templates/media-grid.tid (`\function fu-att-email-artifact`,
	// `\function fu-att-label`, `\function fu-att-newtab-href`). Wikitext
	// `\function` definitions live inside the rendering scope of the
	// declaring tiddler — they aren't reachable from filterTiddlers in JS
	// tests — so we pin behaviour by re-stating the function body here.
	// If the function bodies change, update these literals too.
	var EMAIL_ARTIFACT = "[<att>get[type]match[application/vnd.ms-outlook]then<att>addsuffix[.email]] ~[<att>get[type]match[message/rfc822]then<att>addsuffix[.email]]";
	var LABEL = EMAIL_ARTIFACT + " :map[get[msg-subject]] :filter[!is[blank]] ~[<att>get[title]split[/]last[]]";
	var NEWTAB = EMAIL_ARTIFACT + " :map[encodeuricomponent[]addprefix[#]] ~[<att>get[_canonical_uri]]";

	// fu-att-label: for an .msg / .eml tiddler whose .email sibling has
	// msg-subject, return the subject; otherwise the filename's last path
	// segment.
	describe("fu-att-label-shape", function () {

		it("returns the .email's msg-subject for an .msg tiddler", function () {
			var msg = "$:/test/fu/mailbox/foo.msg";
			add(msg, {type: "application/vnd.ms-outlook"});
			add(msg + ".email", {
				type: "text/x-frontmattered-markdown",
				"msg-subject": "Project kickoff",
				_artifact_source: msg
			});
			expect(evalFn(LABEL, msg)).toEqual(["Project kickoff"]);
		});

		it("returns the .email's msg-subject for an .eml tiddler (message/rfc822)", function () {
			var eml = "$:/test/fu/mailbox/foo.eml";
			add(eml, {type: "message/rfc822"});
			add(eml + ".email", {
				type: "text/x-frontmattered-markdown",
				"msg-subject": "Thunderbird drop",
				_artifact_source: eml
			});
			expect(evalFn(LABEL, eml)).toEqual(["Thunderbird drop"]);
		});

		it("falls back to filename last segment when the .email sibling is missing (.msg)", function () {
			var msg = "$:/test/fu/mailbox/lonely.msg";
			add(msg, {type: "application/vnd.ms-outlook"});
			expect(evalFn(LABEL, msg)).toEqual(["lonely.msg"]);
		});

		it("falls back to filename last segment when the .email sibling is missing (.eml)", function () {
			var eml = "$:/test/fu/mailbox/lonely.eml";
			add(eml, {type: "message/rfc822"});
			expect(evalFn(LABEL, eml)).toEqual(["lonely.eml"]);
		});

		it("falls back to filename when an .msg's .email has an empty msg-subject", function () {
			var msg = "$:/test/fu/mailbox/blank.msg";
			add(msg, {type: "application/vnd.ms-outlook"});
			add(msg + ".email", {
				type: "text/x-frontmattered-markdown",
				"msg-subject": "",
				_artifact_source: msg
			});
			expect(evalFn(LABEL, msg)).toEqual(["blank.msg"]);
		});

		it("returns the filename last segment for a non-email tiddler", function () {
			var pdf = "$:/test/fu/files/invoice.pdf";
			add(pdf, {type: "application/pdf"});
			expect(evalFn(LABEL, pdf)).toEqual(["invoice.pdf"]);
		});
	});

	// fu-att-newtab-href: for .msg / .eml → #<encoded .email>, else _canonical_uri.
	describe("fu-att-newtab-href-shape", function () {

		it("returns the appify permalink (#<encoded .email>) for an .msg tiddler", function () {
			var msg = "$:/test/fu/m.msg";
			add(msg, {
				type: "application/vnd.ms-outlook",
				_canonical_uri: "/files/email/m.msg"
			});
			var out = evalFn(NEWTAB, msg);
			expect(out.length).toBe(1);
			expect(out[0].charAt(0)).toBe("#");
			// The .email title contains ':' which encodeuricomponent turns into '%3A'
			expect(out[0]).toContain("%3A");
			expect(out[0]).toContain("m.msg.email");
		});

		it("returns the appify permalink (#<encoded .email>) for an .eml tiddler (message/rfc822)", function () {
			var eml = "$:/test/fu/m.eml";
			add(eml, {
				type: "message/rfc822",
				_canonical_uri: "/files/email/m.eml"
			});
			var out = evalFn(NEWTAB, eml);
			expect(out.length).toBe(1);
			expect(out[0].charAt(0)).toBe("#");
			expect(out[0]).toContain("%3A");
			expect(out[0]).toContain("m.eml.email");
		});

		it("returns the _canonical_uri for a non-email tiddler", function () {
			var pdf = "$:/test/fu/p.pdf";
			add(pdf, {
				type: "application/pdf",
				_canonical_uri: "/files/pdf/p.pdf"
			});
			expect(evalFn(NEWTAB, pdf)).toEqual(["/files/pdf/p.pdf"]);
		});
	});

	// fu-att-email-artifact: returns <att>.email for email-typed parents,
	// empty otherwise. Drives both fu-att-label fallback chain and the
	// media-modal's email body branch.
	describe("fu-att-email-artifact", function () {

		it("returns <att>.email for application/vnd.ms-outlook", function () {
			var msg = "$:/test/fu/dispatch/x.msg";
			add(msg, {type: "application/vnd.ms-outlook"});
			expect(evalFn(EMAIL_ARTIFACT, msg)).toEqual([msg + ".email"]);
		});

		it("returns <att>.email for message/rfc822", function () {
			var eml = "$:/test/fu/dispatch/x.eml";
			add(eml, {type: "message/rfc822"});
			expect(evalFn(EMAIL_ARTIFACT, eml)).toEqual([eml + ".email"]);
		});

		it("returns empty for application/pdf", function () {
			var pdf = "$:/test/fu/dispatch/x.pdf";
			add(pdf, {type: "application/pdf"});
			expect(evalFn(EMAIL_ARTIFACT, pdf)).toEqual([]);
		});

		it("returns empty for an image type", function () {
			var img = "$:/test/fu/dispatch/x.jpg";
			add(img, {type: "image/jpeg"});
			expect(evalFn(EMAIL_ARTIFACT, img)).toEqual([]);
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

	// Pins the tile rendering paths. Regression for 0.1.26 — when the grid
	// was factored into fu-att-tile-img + fu-att-tile-img-body, we want to
	// guarantee that <<imgSrc>> propagates from outer-procedure parameter
	// into the inner sub-procedure that emits the <img> tag.
	describe("rendered tile shape", function () {

		function render(snippet) {
			var w = $tw.wiki.makeWidget(
				$tw.wiki.parseText("text/vnd.tiddlywiki", snippet),
				{}
			);
			var container = $tw.fakeDocument.createElement("div");
			w.render(container, null);
			return container.innerHTML;
		}

		it("renders <img src> for a thumbnailed PDF tile (section 1)", function () {
			add("$:/test/fu/render/foo.pdf", {
				type: "application/pdf",
				_thumbnail_uri: "/files/_generated/foo_thumb.png",
				_canonical_uri: "/files/foo.pdf"
			});
			var html = render(
				"\\import [[$:/plugins/rimir/file-upload/templates/media-grid]]\n" +
				"<<fu-render-media-grid \"[[$:/test/fu/render/foo.pdf]]\">>\n"
			);
			expect(html).toContain('src="/files/_generated/foo_thumb.png"');
		});

		it("renders <img src> for a thumbnailed video tile (section 2, with play badge)", function () {
			add("$:/test/fu/render/bar.mp4", {
				type: "video/mp4",
				_thumbnail_uri: "/files/_generated/bar_thumb.png",
				_canonical_uri: "/files/bar.mp4"
			});
			var html = render(
				"\\import [[$:/plugins/rimir/file-upload/templates/media-grid]]\n" +
				"<<fu-render-media-grid \"[[$:/test/fu/render/bar.mp4]]\">>\n"
			);
			expect(html).toContain('src="/files/_generated/bar_thumb.png"');
			expect(html).toContain("fu-att-play-badge");
		});

		it("renders <img src> from _thumbnail_uri for an image with thumb (section 3)", function () {
			add("$:/test/fu/render/photo.jpg", {
				type: "image/jpeg",
				_thumbnail_uri: "/files/_generated/photo_thumb.png",
				_canonical_uri: "/files/photo.jpg"
			});
			var html = render(
				"\\import [[$:/plugins/rimir/file-upload/templates/media-grid]]\n" +
				"<<fu-render-media-grid \"[[$:/test/fu/render/photo.jpg]]\">>\n"
			);
			expect(html).toContain('src="/files/_generated/photo_thumb.png"');
		});

		it("renders <img src> from _canonical_uri for an image without thumb (section 3)", function () {
			add("$:/test/fu/render/raw.jpg", {
				type: "image/jpeg",
				_canonical_uri: "/files/raw.jpg"
			});
			var html = render(
				"\\import [[$:/plugins/rimir/file-upload/templates/media-grid]]\n" +
				"<<fu-render-media-grid \"[[$:/test/fu/render/raw.jpg]]\">>\n"
			);
			expect(html).toContain('src="/files/raw.jpg"');
		});

		it("applies .fu-att-item-portrait class when EXIF says portrait", function () {
			add("$:/test/fu/render/portrait.jpg", {
				type: "image/jpeg",
				_canonical_uri: "/files/p.jpg",
				"exif-width": "1080",
				"exif-height": "1920"
			});
			var html = render(
				"\\import [[$:/plugins/rimir/file-upload/templates/media-grid]]\n" +
				"<<fu-render-media-grid \"[[$:/test/fu/render/portrait.jpg]]\">>\n"
			);
			expect(html).toContain("fu-att-item-portrait");
		});

		it("wraps tiles in <$draggable> when fu-draggable=yes", function () {
			add("$:/test/fu/render/drag.pdf", {
				type: "application/pdf",
				_thumbnail_uri: "/files/_generated/drag_thumb.png",
				_canonical_uri: "/files/drag.pdf"
			});
			var html = render(
				"\\import [[$:/plugins/rimir/file-upload/templates/media-grid]]\n" +
				"<$let fu-draggable=\"yes\">\n" +
				"<<fu-render-media-grid \"[[$:/test/fu/render/drag.pdf]]\">>\n" +
				"</$let>\n"
			);
			// $draggable widget renders as a <div draggable="true"> in the DOM
			expect(html).toContain('draggable="true"');
		});
	});
});
