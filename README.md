Genbank Converter

Uses BioPython to convert, import, and export Genkbank files into Genetic Constructor projects and blocks.

## REST API

Call either:
```
/import
/export
```

With input file content on the body

Where `import` expects a genbank file on the body and content-type of `text/plain`, and returns a constructor block rollup

Where `export` expects a Constructor block rollup on the body and content-type of `application/json`, and returns a genbank file
