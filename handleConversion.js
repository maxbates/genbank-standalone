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
var fs = require('fs');

var execPython = require('./execPython');

module.exports = function handleConversion(type, content, input, output, callback) {
    fs.writeFile(input, content, 'utf8', function afterWrite(err) {
        if (err) {
            console.log('ERROR WRITING');
            console.log(err);
            callback(err);
            return;
        }

        execPython(type, input, output, function afterExec(err) {
            if (err) {
                callback(err);
                return;
            }

            fs.readFile(output, 'utf8', function readingFile(err, contents) {
                if (err) {
                    console.log('ERROR READING');
                    console.log(err);
                    callback(err);
                    return;
                }
                callback(null, contents);
            });
        });
    });
};
