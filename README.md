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

## How it works

Install Docker.
 
You can build your images this way:
 
docker build -t from-genbank-image -f Dockerfile-from .
docker build -t to-genbank-image -f Dockerfile-to .
 
This will create 2 container images. No containers yet.
 
You run them with:
 
docker run -it --rm -v /Users/flo/Dev/genbank-standalone/files:/mnt --name from-genbank from-genbank-image
docker run -it --rm -v /Users/flo/Dev/genbank-standalone/files:/mnt --name to-genbank to-genbank-image
 
This creates a container with the image, runs it, and then destroys it.
 
First command explained:
It mounts /Users/flo/Dev/genbank-standalone/files to /mnt in the container
The name of the CONTAINER is from-genbank
Using the image: from-genbank-image (created in the previous step)
