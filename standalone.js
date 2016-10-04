/*
 Copyright 2016 Autodesk,Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

var express = require('express');
var bodyParser = require('body-parser');
var cp = require('child_process');
var url = require('url');
var path = require('path');
var fs = require('fs');
var port = process.argv[2] || 8888;

var app = express();

app.post('*', bodyParser.json(), bodyParser.text(), function handlePost(req, res, next) {
  const input = '/tmp/' + Math.floor(Math.random() * 1000000000);
  const output = '/tmp/' + Math.floor(Math.random() * 1000000000);
  const body = req.body;

  fs.writeFile(input, body, 'utf8', function afterWrite(err) {
    if (err) {
      console.log('ERROR WRITING');
      console.log(err);
      return res.status(500).send();
    }

    const convertFilePath = __dirname + '/convert.py';
    const type = req.path;
    const conversion = type === '/import' ? 'from_genbank' : 'to_genbank';
    const command = `python ${convertFilePath} ${conversion} ${input} ${output}`;

    cp.exec(command, function runPython(err, stdout) {
      if (err) {
        console.log('ERROR IN SCRIPT');
        console.log(err);
        return res.status(500).send();
      }

      fs.readFile(output, 'utf8', function readingFile(err, contents) {
        if (err) {
          console.log('ERROR READING');
          console.log(err);
          return res.status(500).send();
        }
        res.send(contents);
      });
    });
  });
});

app.listen(parseInt(port, 10));

console.log('Genbank server at port: ' + port);
