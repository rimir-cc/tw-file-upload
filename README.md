# file upload

> Upload files to configurable locations with rename, delete, thumbnails, artifact cascade, and deduplication

Upload media files to configurable storage locations with automatic tiddler creation, rename, delete, thumbnail generation, artifact lifecycle management, and content-hash deduplication.

## Key features

* **Multi-location support** -- upload files to any registered writable location, not just `/files/`. Create and manage locations via the settings UI.
* **Location registry** -- tag-based tiddler convention for defining file storage locations with URI prefix, base path, and writable flag
* **Drag-and-drop upload** -- `<$file-dropzone>` widget with `location` attribute to target any writable location
* **Thumbnail generation** -- automatic thumbnails for images and PDFs via ImageMagick (configurable resolution)
* **Thumbnail rendering** -- show thumbnails by default with click-to-expand and toolbar toggle
* **File rename** -- renaming a tiddler renames the physical file on writable locations, including `_generated/` thumbnails
* **File delete** -- deleting a tiddler offers to delete the file on writable locations, including thumbnails
* **Artifact cascade** -- deleting or renaming a file tiddler automatically cascades to all derived artifacts (extractions, summaries, etc.)
* **EXIF extraction** -- auto-extract metadata (date, camera, GPS, dimensions, exposure) from uploaded images with configurable per-location field mapping
* **Deduplication** -- optional global content-hash dedup skips identical uploads

## Optional integration

* **scattered-binaries** -- when installed, its discovered locations automatically register with the location registry
* **llm-connect** -- when installed, derived artifacts are tagged with `_artifact_source` for automatic cascade cleanup

## Prerequisites

* ImageMagick -- required for thumbnail generation and EXIF extraction (`magick` on PATH; on WSL use `magick.exe`)
* Ghostscript -- additionally required for PDF thumbnails (`gswin64c` on Windows, `gs` on Linux)

## Quick start

Drop files onto any `<$file-dropzone>` widget. Configure locations, thumbnail settings, and allowed media types in ControlPanel > Settings > file upload.

```html
<$file-dropzone actions="""
<$action-createtiddler $basetitle=<<filename>>
  _canonical_uri=<<canonical-uri>>
  _thumbnail_uri=<<generated-uri>>
  type=<<type>>/>
""">
Drop files here
</$file-dropzone>
```

Upload to a specific location:

```html
<$file-dropzone location="my-assets" actions="...">
Drop files into my-assets
</$file-dropzone>
```

## Plugin Library

Install from the [rimir plugin library](https://rimir-cc.github.io/tw-plugin-library/) via *Control Panel → Plugins → Get more plugins*.

## License

MIT -- see [LICENSE.md](LICENSE.md)
