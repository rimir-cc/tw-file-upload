/*\
title: $:/plugins/rimir/file-upload/test/test-route-http.js
type: application/javascript
tags: [[$:/tags/test-spec]]

HTTP-level tests for file-upload's POST routes (upload, delete, rename).
Covers the JSON-parse / required-field / unknown-location validation paths
that fire before any filesystem operation. The actual write/delete/rename
of bytes on disk is left for Tier B/D fixtures with a sandboxed location.

\*/

"use strict";

var helperAvailable = !!$tw.wiki.getTiddler("$:/test-helpers/http-server");

if(!helperAvailable) {
    describe("file-upload: routes (HTTP)", function() {
        it("requires the tw-tests umbrella suite (http-test-helper)", function() {
            pending("Run under tw-tests umbrella");
        });
    });
} else {

describe("file-upload: POST /api/file-upload — validation", function() {
    var http = require("$:/test-helpers/http-server");
    var ctx;
    var savedMediaTypes;

    beforeAll(function(done) {
        // Allow text/plain so MIME-gate passes — required to exercise the
        // location-lookup branches below. The route reads media-types per
        // request, so editing the tiddler is enough.
        var t = $tw.wiki.getTiddler("$:/config/rimir/file-upload/media-types");
        savedMediaTypes = t ? t.fields.text : undefined;
        $tw.wiki.addTiddler({
            title: "$:/config/rimir/file-upload/media-types",
            text: JSON.stringify(["text/plain"])
        });
        http.start({wiki: $tw.wiki}).then(function(c) { ctx = c; done(); });
    });
    afterAll(function(done) {
        // Restore the previous config tiddler (or remove if we created it).
        if(savedMediaTypes !== undefined) {
            $tw.wiki.addTiddler({title: "$:/config/rimir/file-upload/media-types", text: savedMediaTypes});
        } else {
            $tw.wiki.deleteTiddler("$:/config/rimir/file-upload/media-types");
        }
        ctx.stop().then(done);
    });

    function post(body, headers) {
        var h = {"X-Requested-With": "TiddlyWiki"};
        for(var k in (headers || {})) { h[k] = headers[k]; }
        return http.request(ctx, "/api/file-upload", {
            method: "POST",
            headers: h,
            body: body
        });
    }

    it("rejects an invalid JSON body with 400", function(done) {
        http.request(ctx, "/api/file-upload", {
            method: "POST",
            headers: {"X-Requested-With": "TiddlyWiki", "Content-Type": "application/json"},
            body: "{not-json"
        }).then(function(res) {
            expect(res.status).toBe(400);
            expect((res.json() || {}).error).toMatch(/Invalid JSON/);
            done();
        }).catch(done.fail);
    });

    it("rejects a body missing required fields with 400", function(done) {
        post({filename: "only.txt"}).then(function(res) {
            expect(res.status).toBe(400);
            var body = res.json();
            expect(body.error).toMatch(/Missing required fields/);
            done();
        }).catch(done.fail);
    });

    it("rejects an unallowed MIME type with 415", function(done) {
        post({
            filename: "x.exe",
            content: "aGVsbG8=",
            targetPath: "x.exe",
            type: "application/x-msdownload"  // executables aren't on the whitelist
        }).then(function(res) {
            expect(res.status).toBe(415);
            expect((res.json() || {}).error).toMatch(/MIME type not allowed/);
            done();
        }).catch(done.fail);
    });

    it("rejects an unknown location name with 400 (after MIME check passes)", function(done) {
        // text/plain is on the standard whitelist; the route gets past the
        // MIME gate and hits the location-lookup, returning 400 unknown-location.
        post({
            filename: "x.txt",
            content: "aGVsbG8=",
            targetPath: "x.txt",
            type: "text/plain",
            location: "no-such-location"
        }).then(function(res) {
            expect(res.status).toBe(400);
            expect((res.json() || {}).error).toMatch(/Unknown location/);
            done();
        }).catch(done.fail);
    });
});

describe("file-upload: POST /api/file-delete — validation", function() {
    var http = require("$:/test-helpers/http-server");
    var ctx;

    beforeAll(function(done) {
        http.start({wiki: $tw.wiki}).then(function(c) { ctx = c; done(); });
    });
    afterAll(function(done) { ctx.stop().then(done); });

    function post(body) {
        return http.request(ctx, "/api/file-delete", {
            method: "POST",
            headers: {"X-Requested-With": "TiddlyWiki"},
            body: body
        });
    }

    it("rejects an invalid JSON body with 400", function(done) {
        http.request(ctx, "/api/file-delete", {
            method: "POST",
            headers: {"X-Requested-With": "TiddlyWiki", "Content-Type": "application/json"},
            body: "{not-json"
        }).then(function(res) {
            expect(res.status).toBe(400);
            expect((res.json() || {}).error).toMatch(/Invalid JSON/);
            done();
        }).catch(done.fail);
    });

    it("rejects a body missing the `uri` field with 400", function(done) {
        post({}).then(function(res) {
            expect(res.status).toBe(400);
            expect((res.json() || {}).error).toMatch(/uri/);
            done();
        }).catch(done.fail);
    });

    it("rejects an unresolvable URI with 403 (path-traversal guard)", function(done) {
        post({uri: "../../etc/passwd"}).then(function(res) {
            expect(res.status).toBe(403);
            expect((res.json() || {}).error).toMatch(/resolve|traversal/i);
            done();
        }).catch(done.fail);
    });
});

describe("file-upload: POST /api/file-rename — validation", function() {
    var http = require("$:/test-helpers/http-server");
    var ctx;

    beforeAll(function(done) {
        http.start({wiki: $tw.wiki}).then(function(c) { ctx = c; done(); });
    });
    afterAll(function(done) { ctx.stop().then(done); });

    function post(body) {
        return http.request(ctx, "/api/file-rename", {
            method: "POST",
            headers: {"X-Requested-With": "TiddlyWiki"},
            body: body
        });
    }

    it("rejects an invalid JSON body with 400", function(done) {
        http.request(ctx, "/api/file-rename", {
            method: "POST",
            headers: {"X-Requested-With": "TiddlyWiki", "Content-Type": "application/json"},
            body: "{not-json"
        }).then(function(res) {
            expect(res.status).toBe(400);
            done();
        }).catch(done.fail);
    });

    it("rejects a body missing oldUri or newUri with 400", function(done) {
        post({oldUri: "/files/a.txt"}).then(function(res) {
            expect(res.status).toBe(400);
            expect((res.json() || {}).error).toMatch(/oldUri|newUri/);
            done();
        }).catch(done.fail);
    });

    it("rejects an unresolvable oldUri with 403", function(done) {
        post({oldUri: "../escape.txt", newUri: "/files/safe.txt"}).then(function(res) {
            expect(res.status).toBe(403);
            done();
        }).catch(done.fail);
    });
});

}
