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

//standalone, node v4 compatible server, for running at heroku

var express = require('express');
var bodyParser = require('body-parser');
var port = process.env.PORT || process.argv[2] || 8080;

var handleConversion = require('./handleConversion');

var app = express();

app.post('*', bodyParser.json(), bodyParser.text(), function handlePost(req, res, next) {
  const input = '/tmp/' + Math.floor(Math.random() * 1000000000);
  const output = '/tmp/' + Math.floor(Math.random() * 1000000000);
  const content = req.body;
  const type = req.path;

  handleConversion(type, content, input, output, function (err, result) {
    if (err) {
      return res.status(500).send(err);
    }

    res.send(result);
  });
});

app.listen(parseInt(port, 10));

console.log('Genbank server at port: ' + port);
