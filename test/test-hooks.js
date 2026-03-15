/*\
title: $:/plugins/rimir/file-upload/test/test-hooks.js
type: application/javascript
tags: [[$:/tags/test-spec]]

Tests for file-upload helper functions (computeFilePath, computeThumbnailUri,
getSubfolderForType, sanitizePath).

\*/
"use strict";

describe("file-upload: helpers", function() {

	var helpers = require("$:/plugins/rimir/file-upload/helpers");

	describe("getSubfolderForType", function() {
		it("should return 'images' for image/png", function() {
			expect(helpers.getSubfolderForType("image/png")).toBe("images");
		});

		it("should return 'images' for image/jpeg", function() {
			expect(helpers.getSubfolderForType("image/jpeg")).toBe("images");
		});

		it("should return 'images' for image/svg+xml", function() {
			expect(helpers.getSubfolderForType("image/svg+xml")).toBe("images");
		});

		it("should return 'pdf' for application/pdf", function() {
			expect(helpers.getSubfolderForType("application/pdf")).toBe("pdf");
		});

		it("should return empty string for text/plain", function() {
			expect(helpers.getSubfolderForType("text/plain")).toBe("");
		});

		it("should return empty string for empty type", function() {
			expect(helpers.getSubfolderForType("")).toBe("");
		});

		it("should return empty string for application/json", function() {
			expect(helpers.getSubfolderForType("application/json")).toBe("");
		});
	});

	describe("sanitizePath", function() {
		it("should replace backslashes with forward slashes", function() {
			expect(helpers.sanitizePath("images\\photo.png")).toBe("images/photo.png");
		});

		it("should strip leading slash", function() {
			expect(helpers.sanitizePath("/images/photo.png")).toBe("images/photo.png");
		});

		it("should handle clean paths unchanged", function() {
			expect(helpers.sanitizePath("images/photo.png")).toBe("images/photo.png");
		});

		it("should handle both backslashes and leading slash", function() {
			expect(helpers.sanitizePath("\\images\\photo.png")).toBe("images/photo.png");
		});

		it("should handle empty string", function() {
			expect(helpers.sanitizePath("")).toBe("");
		});
	});

	describe("computeFilePath", function() {
		it("should route images to images/ subfolder", function() {
			var fields = {title: "vacation", type: "image/png"};
			var result = helpers.computeFilePath(fields, "/files/images/old-photo.png");
			expect(result).toBe("images/vacation.png");
		});

		it("should route PDFs to pdf/ subfolder", function() {
			var fields = {title: "report", type: "application/pdf"};
			var result = helpers.computeFilePath(fields, "/files/pdf/old-report.pdf");
			expect(result).toBe("pdf/report.pdf");
		});

		it("should not add subfolder for unknown types", function() {
			var fields = {title: "data", type: "text/plain"};
			var result = helpers.computeFilePath(fields, "/files/old-data.txt");
			expect(result).toBe("data.txt");
		});

		it("should not duplicate extension if title already has it", function() {
			var fields = {title: "photo.png", type: "image/png"};
			var result = helpers.computeFilePath(fields, "/files/images/old.png");
			expect(result).toBe("images/photo.png");
		});

		it("should be case-insensitive when checking extension duplication", function() {
			var fields = {title: "Photo.PNG", type: "image/png"};
			var result = helpers.computeFilePath(fields, "/files/images/old.png");
			expect(result).toBe("images/Photo.PNG");
		});

		it("should handle files without extension in old URI", function() {
			var fields = {title: "newfile", type: "text/plain"};
			var result = helpers.computeFilePath(fields, "/files/oldfile");
			expect(result).toBe("newfile");
		});

		it("should default to empty type if not provided", function() {
			var fields = {title: "myfile"};
			var result = helpers.computeFilePath(fields, "/files/old.dat");
			expect(result).toBe("myfile.dat");
		});

		it("should extract extension from deeply nested old URI", function() {
			var fields = {title: "renamed", type: "image/jpeg"};
			var result = helpers.computeFilePath(fields, "/files/images/sub/dir/original.jpg");
			expect(result).toBe("images/renamed.jpg");
		});
	});

	describe("computeThumbnailUri", function() {
		it("should compute thumbnail URI for image rename", function() {
			var result = helpers.computeThumbnailUri(
				"/files/images/new-photo.png",
				"/files/images/_generated/old-photo_thumb.png"
			);
			expect(result).toBe("/files/images/_generated/new-photo_thumb.png");
		});

		it("should preserve _thumb suffix with different extension (PDF thumbnails)", function() {
			var result = helpers.computeThumbnailUri(
				"/files/pdf/new-report.pdf",
				"/files/pdf/_generated/old-report_thumb.png"
			);
			expect(result).toBe("/files/pdf/_generated/new-report_thumb.png");
		});

		it("should handle canonical URI without subdirectory", function() {
			var result = helpers.computeThumbnailUri(
				"/files/document.pdf",
				"/files/_generated/old-doc_thumb.png"
			);
			expect(result).toBe("/files/_generated/document_thumb.png");
		});

		it("should handle thumbnail with complex suffix", function() {
			var result = helpers.computeThumbnailUri(
				"/files/images/new.jpg",
				"/files/images/_generated/old_thumb.jpg"
			);
			expect(result).toBe("/files/images/_generated/new_thumb.jpg");
		});

		it("should fallback to _thumb + old extension if no _thumb in old URI", function() {
			// Edge case: old thumbnail URI without _thumb marker
			var result = helpers.computeThumbnailUri(
				"/files/images/new.png",
				"/files/images/_generated/old.png"
			);
			expect(result).toBe("/files/images/_generated/new_thumb.png");
		});
	});
});
