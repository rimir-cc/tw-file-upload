/*\
title: $:/plugins/rimir/file-upload/widgets/dropzone
type: application/javascript
module-type: widget

<$file-dropzone> — extends TW's core dropzone widget. On file drop or paste,
uploads media files to the server's /files/ directory via POST /api/file-upload
and executes action string on completion.

Deduplication: computes a short content hash. If a file with the same target
path already exists and has the same hash, the upload is skipped. If the hash
differs, a unique filename is generated (e.g. grafik-a3f2b1c0.png).

Attributes:
  actions       — action string executed on completion. Variables available:
                  data (raw JSON), type, filename, content-hash,
                  canonical-uri, generated-uri (thumbnail URI if processor ran),
                  location (target location name), target-prefix (if set),
                  pipeline-results (JSON), extracted-text (if extraction ran)
  location      — target location name (default: "files"). Must be writable.
  subfolder     — optional override for target subfolder (overrides filter)
  target-prefix — path prefix inserted between subfolder and filename on disk
  pipeline      — "auto" (match by MIME), pipeline name, or omitted (no pipeline)
  prop-*        — extra fields passed through as action variables

\*/

"use strict";

var DropZoneWidget = require("$:/core/modules/widgets/dropzone.js").dropzone;
var helpers = require("$:/plugins/rimir/file-upload/helpers");
var getSubfolderForType = helpers.getSubfolderForType;
var sanitizePath = helpers.sanitizePath;

var FileDropZoneWidget = function(parseTreeNode, options) {
	this.initialise(parseTreeNode, options);
};

FileDropZoneWidget.prototype = new DropZoneWidget();

FileDropZoneWidget.prototype.execute = function() {
	var getPropertiesWithPrefix = function(properties, prefix) {
		var result = Object.create(null);
		$tw.utils.each(properties, function(value, name) {
			if(name.indexOf(prefix) === 0) {
				result[name.substring(prefix.length)] = properties[name];
			}
		});
		return result;
	};
	this.properties = getPropertiesWithPrefix(this.attributes, "prop-");
	this.subfolder = this.getAttribute("subfolder");
	this.targetPrefix = this.getAttribute("target-prefix");
	this.location = this.getAttribute("location", "files");
	this.pipeline = this.getAttribute("pipeline");
	DropZoneWidget.prototype.execute.call(this);
};

FileDropZoneWidget.prototype.handleDropEvent = function(event) {
	var self = this,
		dataTransfer = event.dataTransfer;
	self.leaveDrag(event);
	self.resetState();
	if(dataTransfer.files && !$tw.utils.dragEventContainsType(event, "text/vnd.tiddler")) {
		self.processFiles(dataTransfer.files);
	}
	event.preventDefault();
	event.stopPropagation();
};

/*
Process dropped files: compute hash from a small slice, check dedup, upload binary.
Bypasses wiki.readFiles() to avoid reading entire files as base64.
*/
FileDropZoneWidget.prototype.processFiles = function(fileList) {
	var self = this;
	var allowedTypes = this.getAllowedTypes();
	var globalDedup = this.isGlobalDedupEnabled();
	var uploads = [];
	var skipped = [];
	var pending = fileList.length;

	function onFileDone() {
		pending--;
		if(pending <= 0) {
			self.wiki.addTiddler(new $tw.Tiddler({
				title: "$:/temp/file-upload/last-upload",
				type: "application/json",
				text: JSON.stringify({uploads: uploads, skipped: skipped})
			}));
			if(skipped.length > 0) {
				self.notifySkipped(skipped);
			}
		}
	}

	for(var i = 0; i < fileList.length; i++) {
		(function(file) {
			var type = file.type || "";
			var filename = file.name || "unnamed";
			if(allowedTypes.indexOf(type) === -1) {
				pending--;
				return;
			}
			// Hash from first 1024 bytes
			computeHashFromFile(file, function(contentHash) {
				if(globalDedup) {
					var globalMatch = self.findTiddlerByContentHash(contentHash);
					if(globalMatch) {
						skipped.push({filename: filename, existingTitle: globalMatch});
						onFileDone();
						return;
					}
				}
				var tiddlerFields = {title: filename, type: type};
				var targetPath = self.computeTargetPath(tiddlerFields);
				var uriPrefix = self.getLocationUriPrefix();
				var canonicalUri = uriPrefix + sanitizePath(targetPath);
				var existingTitle = self.findTiddlerByCanonicalUri(canonicalUri);
				if(existingTitle) {
					var existingTiddler = self.wiki.getTiddler(existingTitle);
					var existingHash = existingTiddler ? existingTiddler.fields._content_hash : null;
					if(existingHash === contentHash) {
						skipped.push({filename: filename, existingTitle: existingTitle});
						onFileDone();
						return;
					}
					targetPath = appendHashToPath(targetPath, contentHash);
					canonicalUri = uriPrefix + sanitizePath(targetPath);
					var existingUnique = self.findTiddlerByCanonicalUri(canonicalUri);
					if(existingUnique) {
						skipped.push({filename: filename, existingTitle: existingUnique});
						onFileDone();
						return;
					}
				}
				uploads.push({
					filename: filename,
					targetPath: targetPath,
					canonicalUri: canonicalUri,
					contentHash: contentHash,
					fileType: type,
					location: self.location
				});
				var vars = {
					type: type,
					filename: filename,
					"content-hash": contentHash,
					location: self.location
				};
				if(self.targetPrefix) {
					vars["target-prefix"] = self.targetPrefix;
				}
				self.performBinaryUpload(file, targetPath, vars, onFileDone);
			});
		})(fileList[i]);
	}
};

FileDropZoneWidget.prototype.readFileCallback = function(tiddlerFieldsArray) {
	var allowedTypes = this.getAllowedTypes();
	var globalDedup = this.isGlobalDedupEnabled();
	var uploads = [];
	var skipped = [];
	for(var i = 0; i < tiddlerFieldsArray.length; i++) {
		var toImport = tiddlerFieldsArray[i];
		var type = toImport.type || "";
		// Client-side MIME type check
		if(allowedTypes.indexOf(type) === -1) {
			continue;
		}
		var contentHash = computeHash(toImport.text);
		// Global dedup: check if any tiddler already has this content hash
		if(globalDedup) {
			var globalMatch = this.findTiddlerByContentHash(contentHash);
			if(globalMatch) {
				skipped.push({filename: toImport.title, existingTitle: globalMatch});
				continue;
			}
		}
		var targetPath = this.computeTargetPath(toImport);
		var uriPrefix = this.getLocationUriPrefix();
		var canonicalUri = uriPrefix + sanitizePath(targetPath);
		// Check for existing tiddler with same target path
		var existingTitle = this.findTiddlerByCanonicalUri(canonicalUri);
		if(existingTitle) {
			var existingTiddler = this.wiki.getTiddler(existingTitle);
			var existingHash = existingTiddler ? existingTiddler.fields._content_hash : null;
			if(existingHash === contentHash) {
				// Same content — skip, notify user
				skipped.push({filename: toImport.title, existingTitle: existingTitle});
				continue;
			}
			// Different content — make filename unique by appending hash
			targetPath = appendHashToPath(targetPath, contentHash);
			canonicalUri = uriPrefix + sanitizePath(targetPath);
			// Check again with the new unique path
			var existingUnique = this.findTiddlerByCanonicalUri(canonicalUri);
			if(existingUnique) {
				skipped.push({filename: toImport.title, existingTitle: existingUnique});
				continue;
			}
		}
		var uploadEntry = {
			filename: toImport.title,
			targetPath: targetPath,
			canonicalUri: canonicalUri,
			contentHash: contentHash,
			fileType: type,
			location: this.location
		};
		uploads.push(uploadEntry);
		var body = {
			filename: toImport.title,
			type: type,
			content: toImport.text,
			targetPath: targetPath,
			location: this.location
		};
		var baseVars = {
			type: type,
			filename: toImport.title,
			"content-hash": contentHash,
			location: this.location
		};
		if(this.targetPrefix) {
			baseVars["target-prefix"] = this.targetPrefix;
		}
		this.performUpload(body, baseVars);
	}
	// Write batch result to temp tiddler (includes both uploaded and skipped)
	this.wiki.addTiddler(new $tw.Tiddler({
		title: "$:/temp/file-upload/last-upload",
		type: "application/json",
		text: JSON.stringify({uploads: uploads, skipped: skipped})
	}));
	// Batch notification for all skipped files
	if(skipped.length > 0) {
		this.notifySkipped(skipped);
	}
};

FileDropZoneWidget.prototype.performUpload = function(body, vars) {
	var self = this;
	$tw.utils.httpRequest({
		url: "/api/file-upload",
		type: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-requested-with": "TiddlyWiki"
		},
		data: JSON.stringify(body),
		callback: function(err, responseText) {
			if(err) {
				return;
			}
			var variables = {};
			// Copy base variables
			for(var key in vars) {
				variables[key] = vars[key];
			}
			// Copy prop-* attributes
			for(var pkey in self.properties) {
				variables[pkey] = self.properties[pkey];
			}
			// Parse response and extract all fields as variables
			try {
				var responseData = JSON.parse(responseText);
				variables.data = responseText;
				if(responseData.canonicalUri) {
					variables["canonical-uri"] = responseData.canonicalUri;
				}
				if(responseData.generatedUri) {
					variables["generated-uri"] = responseData.generatedUri;
				}
			} catch(e) {
				variables.data = responseText;
			}
			if(self.actions) {
				self.invokeActionString(self.actions, self, null, variables);
			}
			// Auto-apply EXIF fields to the created tiddler
			if(responseData && responseData.exif && responseData.canonicalUri) {
				self.applyExifFields(responseData.canonicalUri, responseData.exif, vars.location || "files");
			}
			// Trigger pipeline: explicit attribute, or auto-detect file-pipeline plugin
			var effectivePipeline = self.pipeline;
			if(!effectivePipeline) {
				try {
					require("$:/plugins/rimir/file-pipeline/pipeline-client");
					effectivePipeline = "auto";
				} catch(e) { /* file-pipeline not installed */ }
			}
			if(effectivePipeline && effectivePipeline !== "none" && responseData && responseData.canonicalUri) {
				self.triggerPipeline(effectivePipeline, responseData.canonicalUri, vars.type, vars.filename, variables);
			}
		}
	});
};

/*
Auto-apply EXIF data to the tiddler that was just created with the given canonical URI.
Reads field mapping from per-location config (fallback to global default).
*/
FileDropZoneWidget.prototype.applyExifFields = function(canonicalUri, exifData, locationName) {
	// Find the tiddler by _canonical_uri
	var targetTitle = this.findTiddlerByCanonicalUri(canonicalUri);
	if(!targetTitle) return;
	var tiddler = this.wiki.getTiddler(targetTitle);
	if(!tiddler) return;
	// Read field mapping: try per-location first, then global
	var mapping = null;
	var perLocationTitle = "$:/config/rimir/file-upload/exif-mapping/" + locationName;
	var perLocationTiddler = this.wiki.getTiddler(perLocationTitle);
	if(perLocationTiddler) {
		try { mapping = JSON.parse(perLocationTiddler.fields.text); } catch(e) {}
	}
	if(!mapping) {
		var globalTiddler = this.wiki.getTiddler("$:/config/rimir/file-upload/exif-mapping");
		if(globalTiddler) {
			try { mapping = JSON.parse(globalTiddler.fields.text); } catch(e) {}
		}
	}
	if(!mapping) return;
	// Apply mapping: keys are EXIF tag names, values are tiddler field names
	var updates = {};
	var hasUpdates = false;
	for(var exifTag in mapping) {
		if(exifData[exifTag] !== undefined && exifData[exifTag] !== null) {
			updates[mapping[exifTag]] = String(exifData[exifTag]);
			hasUpdates = true;
		}
	}
	if(hasUpdates) {
		this.wiki.addTiddler(new $tw.Tiddler(tiddler, updates));
	}
};

FileDropZoneWidget.prototype.triggerPipeline = function(pipelineName, canonicalUri, mimeType, filename, actionVars) {
	var self = this;
	var pipelineClient;
	try {
		pipelineClient = require("$:/plugins/rimir/file-pipeline/pipeline-client");
	} catch(e) {
		// file-pipeline plugin not installed — skip silently
		return;
	}
	// Find the tiddler title by canonical URI (tiddler should exist by now from actions)
	var sourceTitle = this.findTiddlerByCanonicalUri(canonicalUri);
	if(!sourceTitle) return;
	self.domNodes[0].setAttribute("data-fu-status", "Processing " + (filename || "") + "...");
	$tw.utils.addClass(self.domNodes[0], "fu-processing");
	$tw.wiki.addTiddler(new $tw.Tiddler({title: "$:/state/rimir/file-upload/busy", text: "Processing " + (filename || "") + "..."}));
	// Pass llm-* properties from dropzone to pipeline for LLM step overrides
	var llmOptions = {};
	if(self.properties["system-prompt"]) llmOptions.systemPrompt = self.properties["system-prompt"];
	if(self.properties["provider"]) llmOptions.provider = self.properties["provider"];
	if(self.properties["model"]) llmOptions.model = self.properties["model"];

	pipelineClient.runPipeline({
		sourceTitle: sourceTitle,
		uri: canonicalUri,
		pipeline: pipelineName,
		mimeType: mimeType,
		filename: filename,
		llmOptions: llmOptions,
		onServerDone: function() {
			// Server-side processing done — remove busy indicator
			$tw.utils.removeClass(self.domNodes[0], "fu-processing");
			self.domNodes[0].removeAttribute("data-fu-status");
			$tw.wiki.deleteTiddler("$:/state/rimir/file-upload/busy");
		},
		onComplete: function(results) {
			// Re-invoke actions with pipeline results if there are any
			if(results && results.length > 0 && self.actions) {
				var pipelineVars = {};
				for(var k in actionVars) { pipelineVars[k] = actionVars[k]; }
				pipelineVars["pipeline-results"] = JSON.stringify(results);
				// Find extracted text if any
				for(var r = 0; r < results.length; r++) {
					if(results[r].text && results[r].artifact && results[r].artifact.type === "extraction") {
						pipelineVars["extracted-text"] = results[r].text;
						break;
					}
				}
			}
		},
		onError: function(err) {
			$tw.utils.removeClass(self.domNodes[0], "fu-processing");
			self.domNodes[0].removeAttribute("data-fu-status");
			$tw.wiki.deleteTiddler("$:/state/rimir/file-upload/busy");
			console.warn("file-pipeline error:", err.message || err);
		}
	});
};

/*
Upload a file as raw binary via /api/file-upload-binary.
No base64 encoding, no JSON wrapping — streams the File directly.
*/
FileDropZoneWidget.prototype.performBinaryUpload = function(file, targetPath, vars, onDone) {
	var self = this;
	// Visual feedback: mark dropzone as busy + show overlay
	self.domNodes[0].setAttribute("data-fu-status", "Uploading " + (vars.filename || "") + "...");
	$tw.utils.addClass(self.domNodes[0], "fu-uploading");
	$tw.wiki.addTiddler(new $tw.Tiddler({title: "$:/state/rimir/file-upload/busy", text: "Uploading " + (vars.filename || "") + "..."}));
	var xhr = new XMLHttpRequest();
	xhr.open("POST", "/api/file-upload-binary");
	xhr.setRequestHeader("x-requested-with", "TiddlyWiki");
	xhr.setRequestHeader("x-upload-filename", encodeURIComponent(vars.filename));
	xhr.setRequestHeader("x-upload-type", vars.type);
	xhr.setRequestHeader("x-upload-path", encodeURIComponent(targetPath));
	xhr.setRequestHeader("x-upload-location", vars.location);
	xhr.upload.onprogress = function(e) {
		if(e.lengthComputable) {
			var pct = Math.round(e.loaded / e.total * 100);
			var msg = "Uploading " + (vars.filename || "") + " (" + pct + "%)...";
			self.domNodes[0].setAttribute("data-fu-status", msg);
			$tw.wiki.addTiddler(new $tw.Tiddler({title: "$:/state/rimir/file-upload/busy", text: msg}));
		}
	};
	xhr.onload = function() {
		$tw.utils.removeClass(self.domNodes[0], "fu-uploading");
		var responseData;
		try {
			responseData = JSON.parse(xhr.responseText);
		} catch(e) {
			responseData = {};
		}
		var variables = {};
		for(var key in vars) {
			variables[key] = vars[key];
		}
		for(var pkey in self.properties) {
			variables[pkey] = self.properties[pkey];
		}
		variables.data = xhr.responseText;
		if(responseData.canonicalUri) {
			variables["canonical-uri"] = responseData.canonicalUri;
		}
		if(responseData.generatedUri) {
			variables["generated-uri"] = responseData.generatedUri;
		}
		if(self.actions) {
			self.invokeActionString(self.actions, self, null, variables);
		}
		if(responseData.exif && responseData.canonicalUri) {
			self.applyExifFields(responseData.canonicalUri, responseData.exif, vars.location || "files");
		}
		// Trigger pipeline (deferred to avoid blocking UI)
		var effectivePipeline = self.pipeline;
		if(!effectivePipeline) {
			try {
				require("$:/plugins/rimir/file-pipeline/pipeline-client");
				effectivePipeline = "auto";
			} catch(e) {}
		}
		if(effectivePipeline && effectivePipeline !== "none" && responseData.canonicalUri) {
			setTimeout(function() {
				self.triggerPipeline(effectivePipeline, responseData.canonicalUri, vars.type, vars.filename, variables);
			}, 0);
		}
		if(onDone) onDone();
	};
	xhr.onerror = function() {
		$tw.utils.removeClass(self.domNodes[0], "fu-uploading");
		self.domNodes[0].removeAttribute("data-fu-status");
		$tw.wiki.deleteTiddler("$:/state/rimir/file-upload/busy");
		if(onDone) onDone();
	};
	xhr.send(file);
};

FileDropZoneWidget.prototype.notifySkipped = function(skippedArray) {
	var lines = [];
	for(var i = 0; i < skippedArray.length; i++) {
		lines.push(skippedArray[i].filename + " → " + skippedArray[i].existingTitle);
	}
	this.dispatchEvent({
		type: "tm-notify",
		param: "$:/plugins/rimir/file-upload/notifications/skipped",
		paramObject: {
			count: String(skippedArray.length),
			"skipped-list": lines.join("\n")
		}
	});
};

FileDropZoneWidget.prototype.isGlobalDedupEnabled = function() {
	var tiddler = this.wiki.getTiddler("$:/config/rimir/file-upload/global-dedup");
	return tiddler && (tiddler.fields.text || "").trim() === "yes";
};

FileDropZoneWidget.prototype.findTiddlerByContentHash = function(hash) {
	var titles = this.wiki.filterTiddlers("[has[_content_hash]]");
	for(var i = 0; i < titles.length; i++) {
		var tiddler = this.wiki.getTiddler(titles[i]);
		if(tiddler && tiddler.fields._content_hash === hash) {
			return titles[i];
		}
	}
	return null;
};

FileDropZoneWidget.prototype.findTiddlerByCanonicalUri = function(uri) {
	var titles = this.wiki.filterTiddlers("[has[_canonical_uri]]");
	for(var i = 0; i < titles.length; i++) {
		var tiddler = this.wiki.getTiddler(titles[i]);
		if(tiddler && tiddler.fields._canonical_uri === uri) {
			return titles[i];
		}
	}
	return null;
};

FileDropZoneWidget.prototype.getAllowedTypes = function() {
	var tiddler = this.wiki.getTiddler("$:/config/rimir/file-upload/media-types");
	if(tiddler) {
		try {
			return JSON.parse(tiddler.fields.text);
		} catch(e) {
			// Fall through
		}
	}
	return [];
};

FileDropZoneWidget.prototype.getLocationUriPrefix = function() {
	var TAG = "$:/tags/rimir/file-upload/location";
	var titles = this.wiki.filterTiddlers("[all[tiddlers+shadows]tag[" + TAG + "]]");
	for(var i = 0; i < titles.length; i++) {
		var tiddler = this.wiki.getTiddler(titles[i]);
		if(!tiddler) continue;
		try {
			var config = JSON.parse(tiddler.fields.text);
			if(config.name === this.location) {
				var prefix = config.uriPrefix || "/files/";
				if(prefix.charAt(prefix.length - 1) !== "/") prefix += "/";
				return prefix;
			}
		} catch(e) {
			// Skip invalid configs
		}
	}
	return "/files/";
};

FileDropZoneWidget.prototype.computeTargetPath = function(tiddlerFields) {
	var prefix = this.targetPrefix ? this.targetPrefix + "/" : "";
	// If subfolder attribute is set, use it directly
	if(this.subfolder) {
		return this.subfolder + "/" + prefix + tiddlerFields.title;
	}
	// If prop-upload-folder is set, use it
	if(this.properties["upload-folder"]) {
		return this.properties["upload-folder"] + "/" + prefix + tiddlerFields.title;
	}
	// Route by MIME type
	var subfolder = getSubfolderForType(tiddlerFields.type || "");
	if(subfolder) {
		return subfolder + "/" + prefix + tiddlerFields.title;
	}
	return prefix + tiddlerFields.title;
};

// Hash from first 1024 bytes of a File object (async via FileReader)
function computeHashFromFile(file, callback) {
	var slice = file.slice(0, 1024);
	var reader = new FileReader();
	reader.onload = function() {
		var arr = new Uint8Array(reader.result);
		var hash = 5381;
		for(var i = 0; i < arr.length; i++) {
			hash = ((hash << 5) + hash + arr[i]) & 0xFFFFFFFF;
		}
		callback((hash >>> 0).toString(16).padStart(8, "0"));
	};
	reader.onerror = function() {
		callback("00000000");
	};
	reader.readAsArrayBuffer(slice);
}

// Simple hash: djb2 on the first 1024 chars of base64, returned as 8-char hex
function computeHash(base64Content) {
	var sample = (base64Content || "").substring(0, 1024);
	var hash = 5381;
	for(var i = 0; i < sample.length; i++) {
		hash = ((hash << 5) + hash + sample.charCodeAt(i)) & 0xFFFFFFFF;
	}
	// Convert to unsigned and then to hex
	return (hash >>> 0).toString(16).padStart(8, "0");
}

// Insert hash before extension: "images/grafik.png" → "images/grafik-a3f2b1c0.png"
function appendHashToPath(targetPath, hash) {
	var lastSlash = targetPath.lastIndexOf("/");
	var dir = lastSlash >= 0 ? targetPath.substring(0, lastSlash + 1) : "";
	var filename = lastSlash >= 0 ? targetPath.substring(lastSlash + 1) : targetPath;
	var dotPos = filename.lastIndexOf(".");
	if(dotPos >= 0) {
		return dir + filename.substring(0, dotPos) + "-" + hash + filename.substring(dotPos);
	}
	return dir + filename + "-" + hash;
}

exports["file-dropzone"] = FileDropZoneWidget;
