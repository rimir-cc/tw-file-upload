/*\
title: $:/plugins/rimir/file-upload/delete-confirm
type: application/javascript
module-type: startup

Intercepts `tm-delete-tiddler` for tiddlers backed by an uploaded file
(`_canonical_uri` present) and replaces TW's default `window.confirm()` with
a rich modal that lists the transitive `_artifact_source` cascade plus any
backlinks. Empty-bodied media tiddlers otherwise bypass TW's confirm prompt
entirely (the navigator only prompts when `tiddler.fields.text` is
non-empty), so the user can delete a PDF and all its derived thumbnails /
extractions in a single misclick.

Toggle via `$:/config/rimir/file-upload/confirm-deletes` (yes / no).

\*/
"use strict";

exports.name = "rimir-file-upload-delete-confirm";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

var CONFIG_ENABLED = "$:/config/rimir/file-upload/confirm-deletes";
var STATE_CASCADE = "$:/state/rimir/file-upload/delete-confirm/cascade";
var STATE_BYPASS = "$:/state/rimir/file-upload/delete-confirm/bypass";
var MODAL_TEMPLATE = "$:/plugins/rimir/file-upload/templates/delete-confirm-modal";

exports.startup = function() {
	var NavigatorWidget;
	try {
		NavigatorWidget = require("$:/core/modules/widgets/navigator.js").navigator;
	} catch(e) {
		return;
	}
	if(!NavigatorWidget || NavigatorWidget.prototype._rimirConfirmPatched) return;

	var orig = NavigatorWidget.prototype.handleDeleteTiddlerEvent;
	NavigatorWidget.prototype.handleDeleteTiddlerEvent = function(event) {
		var title = event.param || event.tiddlerTitle;
		var tiddler = this.wiki.getTiddler(title);
		if(!tiddler) {
			return orig.apply(this, arguments);
		}

		// If this is a re-dispatch from the modal's "Delete anyway" button, clear
		// the bypass flag and let the navigator do its normal thing.
		var bypassTiddler = $tw.wiki.getTiddler(STATE_BYPASS);
		var bypassTitle = bypassTiddler && (bypassTiddler.fields.text || "").trim();
		if(bypassTitle === title) {
			$tw.wiki.deleteTiddler(STATE_BYPASS);
			return orig.apply(this, arguments);
		}

		// Drafts: pass through, the user is editing — we don't own that flow.
		if(tiddler.fields["draft.of"]) {
			return orig.apply(this, arguments);
		}

		// Only intercept tiddlers backed by an uploaded file.
		if(!tiddler.fields._canonical_uri) {
			return orig.apply(this, arguments);
		}

		// Honor opt-out.
		var enabled = ($tw.wiki.getTiddlerText(CONFIG_ENABLED, "yes") || "yes").trim();
		if(enabled === "no") {
			return orig.apply(this, arguments);
		}

		showDeleteConfirm(title);
		return false;
	};
	NavigatorWidget.prototype._rimirConfirmPatched = true;
};

function showDeleteConfirm(title) {
	var cascade = collectCascade(title);
	var allTitles = [title].concat(cascade);
	var backlinks = collectBacklinks(allTitles);
	var derivedHint = derivedDirHint(title);

	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: STATE_CASCADE,
		type: "application/json",
		text: JSON.stringify({
			target: title,
			cascade: cascade,
			backlinks: backlinks,
			derivedHint: derivedHint
		})
	}));

	if($tw.rootWidget && typeof $tw.rootWidget.dispatchEvent === "function") {
		$tw.rootWidget.dispatchEvent({type: "tm-modal", param: MODAL_TEMPLATE});
	}
}

function collectCascade(sourceTitle) {
	var visited = Object.create(null);
	var ordered = [];
	function walk(t) {
		var arts = $tw.wiki.filterTiddlers("[_artifact_source[" + t + "]]");
		for(var i = 0; i < arts.length; i++) {
			var child = arts[i];
			if(visited[child]) continue;
			visited[child] = true;
			walk(child);
			ordered.push(child);
		}
	}
	walk(sourceTitle);
	return ordered;
}

function collectBacklinks(titles) {
	var seen = Object.create(null);
	titles.forEach(function(t) { seen[t] = true; });
	var out = [];
	for(var i = 0; i < titles.length; i++) {
		var links = $tw.wiki.getTiddlerBacklinks ? $tw.wiki.getTiddlerBacklinks(titles[i]) : [];
		for(var j = 0; j < links.length; j++) {
			if(seen[links[j]]) continue;
			seen[links[j]] = true;
			out.push(links[j]);
		}
	}
	return out;
}

/*
Best-effort hint at where the per-source `_derived/<basename>/` directory
lives, derived from the target's `_canonical_uri`. Purely a string for the
modal — file deletion still flows through `/api/file-delete` per-artifact.
*/
function derivedDirHint(title) {
	var tiddler = $tw.wiki.getTiddler(title);
	if(!tiddler || !tiddler.fields._canonical_uri) return "";
	var uri = tiddler.fields._canonical_uri;
	var slash = uri.lastIndexOf("/");
	if(slash < 0) return "";
	var dir = uri.substring(0, slash);
	var base = uri.substring(slash + 1);
	return dir + "/_derived/" + base + "/";
}

// Test-only exports.
exports._collectCascade = collectCascade;
exports._collectBacklinks = collectBacklinks;
exports._showDeleteConfirm = showDeleteConfirm;
exports._STATE_CASCADE = STATE_CASCADE;
exports._STATE_BYPASS = STATE_BYPASS;
