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
var cp = require('child_process');
var path = require('path');

module.exports = function execPython(type, input, output, callback) {
    const convertFilePath = path.resolve(__dirname, 'convert.py');
    const conversion = (type.indexOf('import') >= 0) ? 'from_genbank' : 'to_genbank';
    const command = `python ${convertFilePath} ${conversion} ${input} ${output}`;

    console.log('executing: ', command);

    cp.exec(command, function runPython(err, stdout) {
        if (err) {
            console.log('ERROR IN SCRIPT');
            console.log(err);
            callback(err);
            return;
        }

        callback(null, stdout);
    });
};
