# file upload

> Upload files to /files/ with rename, delete, thumbnails, and deduplication

Upload media files to the server's `/files/` directory with automatic tiddler creation, rename, delete, thumbnail generation, and content-hash deduplication.

## Key features

* **Drag-and-drop upload** -- `<$file-dropzone>` widget uploads to `/files/` and creates tiddlers with `_canonical_uri`
* **Thumbnail generation** -- automatic thumbnails for images and PDFs via ImageMagick (configurable resolution)
* **Thumbnail rendering** -- show thumbnails by default with click-to-expand and toolbar toggle
* **File rename** -- renaming a tiddler renames the physical file including `_generated/` thumbnails
* **File delete** -- deleting a tiddler offers to delete the file including thumbnails
* **Deduplication** -- optional global content-hash dedup skips identical uploads

## Prerequisites

* ImageMagick -- required for thumbnail generation (`magick` on PATH)
* Ghostscript -- additionally required for PDF thumbnails (`gswin64c` on Windows, `gs` on Linux)

## Quick start

Drop files onto any `<$file-dropzone>` widget. Configure thumbnail settings and allowed media types in ControlPanel > Settings > file upload.

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

## Plugin Library

Install from the [rimir plugin library](https://rimir-cc.github.io/tw-plugin-library/) via *Control Panel → Plugins → Get more plugins*.

## License

MIT -- see [LICENSE.md](LICENSE.md)
