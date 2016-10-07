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

//for running as an AWS lambda
var handleConversion = require('/handleConversion');

exports.handler = (event, context, callback) => {
  if (!event.type) {
    return callback('Please specify a type to run as event.type');
  }

  if (!event.body) {
    return callback('Please specify a body of content at event.body');
  }

  const input = event.input || '/tmp/' + Math.floor(Math.random() * 1000000000);
  const output = event.output || '/tmp/' + Math.floor(Math.random() * 1000000000);

  const content = event.body;

  handleConversion(event.type, content, input, output, callback);
};
