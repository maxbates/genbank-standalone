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

//this script expects to be a forked process. It works with child_process.fork('convertChild.js')

const cp = require('child_process');
var execPython = require('./execPython');

console.log('Initiated genbank converter slave');

process.on('message', (message) => {
  execPython(message.type, message.input, message.output, function afterExec(err, result) {
    if (err) {
      return process.send({ id: message.id, success: false, error: err, result: result });
    }

    process.send({ id: message.id, success: true, result: result });
  });
});
