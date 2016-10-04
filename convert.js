import path from 'path';
import md5 from 'md5';
import invariant from 'invariant';
import _, { merge, chunk, cloneDeep } from 'lodash';
import uuid from 'node-uuid';
import { spawn } from 'child_process';
import fetch from 'isomorphic-fetch';

import * as filePaths from '../../../utils/filePaths';
import * as fileSystem from '../../../utils/fileSystem';
import * as persistence from '../../../data/persistence';
import Project from '../../../../src/models/Project';
import Block from '../../../../src/models/Block';
import Annotation from '../../../../src/models/Annotation';

import DebugTimer from '../../../utils/DebugTimer';
const timer = new DebugTimer('Genbank', { delayed: true });

//////////////////////////////////////////////////////////////
// COMMON
//////////////////////////////////////////////////////////////
const createTempFilePath = () => filePaths.createStorageUrl('temp/' + uuid.v4());

//todo - will need to consider bundling
//one process for each
const ports = _.range(3).map(num => num + 4444);
let serverIndex = 0;
const servers = ports.map(port => spawn('node', [__dirname + '/standalone.js', `${port}`], { stdio: 'inherit' }));

process.on('SIGTERM', () => {
  console.log('killing servers');
  servers.forEach(server => server.kill('SIGTERM'));
});

// Run an external command and return the data in the specified output file
//commmand is 'import' or 'export'
const runCommand = (command, inputFile, outputFile) => {
  const port = ports[serverIndex];
  serverIndex = (serverIndex + 1) % ports.length;

  return fileSystem.fileRead(inputFile, false)
    .then(contents => fetch(`http://localhost:${port}/${command}`, {
      method: 'POST',
      headers: {
        'Content-Type': command === 'import' ? 'text/plain' : 'application/json',
      },
      body: contents,
    }))
    .then(resp => {
      if (!resp.ok) {
        return Promise.reject('error fetching');
      }
      return resp.text();
    });
};

//////////////////////////////////////////////////////////////
// IMPORT
//////////////////////////////////////////////////////////////
// Create a GD block given a structure coming from Python
// Also saves the sequence and stores the MD5 in the block
const createBlockStructureAndSaveSequence = (block, sourceId) => {
  // generate a valid block scaffold. This is similar to calling new Block(),
  // but a bit more light weight and easier to work with (models are frozen so you cannot edit them)
  const fileName = /[^/]*$/.exec(sourceId)[0];

  //get the sequence md5
  const sequenceMd5 = block.sequence.sequence ? md5(block.sequence.sequence) : '';

  // Remap annotations
  let allAnnotations = [];
  if (block.sequence.annotations) {
    allAnnotations = block.sequence.annotations.map(ann => {
      return Annotation.classless(ann);
    });
  }

  //reassign values
  const toMerge = {
    metadata: block.metadata,
    sequence: {
      md5: sequenceMd5,
      length: block.sequence.length,
      annotations: allAnnotations,
    },
    source: {
      id: fileName,
      source: 'genbank',
    },
    rules: block.rules,
  };

  //be sure to pass in empty project first, so you arent overwriting scaffold each time
  const outputBlock = Block.classless(toMerge);

  //promise, for writing sequence if we have one, or just immediately resolve if we dont
  const sequencePromise = sequenceMd5 ?
    persistence.sequenceWrite(sequenceMd5, block.sequence.sequence) :
    Promise.resolve();

  //return promise which will resolve with block once done
  return sequencePromise.then(() => ({
    block: outputBlock,
    id: outputBlock.id,
    oldId: block.id,
    children: block.components,
  }));
};

// Creates a structure of GD blocks given the structure coming from Python
// We chunk here because otherwise the OS complains of too many open files
const createAllBlocks = (outputBlocks, sourceId) => {
  const batches = chunk(Object.keys(outputBlocks), 50);

  timer.time('start writing sequences');

  return batches.reduce((acc, batch) => {
    return acc.then((allBlocks) => {
      return Promise.all(batch.map(block => createBlockStructureAndSaveSequence(outputBlocks[block], sourceId)))
        .then((createdBatch) => {
          timer.time('made 50 blocks + wrote sequences');
          return allBlocks.concat(createdBatch);
        });
    });
  }, Promise.resolve([]));
};

// Takes a block structure and sets up the hierarchy through GD ids.
// This is necessary because Python returns ids that are not produced by GD.
// takes block structure (block, id, oldId, children) and returns blocks with proper IDs
const remapHierarchy = (blockArray, idMap) => {
  return _.map(blockArray, (structure) => {
    const newBlock = structure.block;
    newBlock.components = structure.children.map(oldId => idMap[oldId]);
    return newBlock;
  });
};

// Converts an input project structure (from Python) into GD format
const handleProject = (outputProject, rootBlockIds) => {
  //just get fields we want using destructuring and use them to merge
  const { name, description } = outputProject;

  return Project.classless({
    components: rootBlockIds,
    metadata: {
      name,
      description,
    },
  });
};

// Reads a genbank file and returns a project structure and all the blocks
// These return structures are NOT in GD format.
const readGenbankFile = (inputFilePath) => {
  const outputFilePath = createTempFilePath();

  timer.time('starting conversion');

  return runCommand('import', inputFilePath, outputFilePath)
    .then(resStr => {
      timer.time('ran python');

      if (!process.env.DEBUG) {
        fileSystem.fileDelete(outputFilePath);
      }

      try {
        const res = JSON.parse(resStr);
        return Promise.resolve(res);
      } catch (err) {
        return Promise.reject(err);
      }
    })
    .catch(err => {
      console.log('ERROR IN PYTHON');
      console.log(err);
      if (!process.env.DEBUG) {
        fileSystem.fileDelete(outputFilePath);
      }
      return Promise.reject(err);
    });
};

// Creates a rough project structure (not in GD format yet!) and a list of blocks from a genbank file
const handleBlocks = (inputFilePath) => {
  return readGenbankFile(inputFilePath)
    .then(result => {
      timer.time('file read');

      if (result && result.project && result.blocks &&
        result.project.components && result.project.components.length > 0) {
        return createAllBlocks(result.blocks, inputFilePath)
          .then(blocksWithOldIds => {
            timer.time('blocks created');

            const idMap = _.zipObject(
              _.map(blocksWithOldIds, 'oldId'),
              _.map(blocksWithOldIds, 'id')
            );

            const remappedBlocksArray = remapHierarchy(blocksWithOldIds, idMap);
            const newRootBlocks = result.project.components.map((oldBlockId) => idMap[oldBlockId]);
            const blockMap = remappedBlocksArray.reduce((acc, block) => Object.assign(acc, { [block.id]: block }), {});

            timer.time('blocks remapped');

            return { project: result.project, rootBlocks: newRootBlocks, blocks: blockMap };
          });
      }
      return 'Invalid Genbank format.';
    });
};

// Import project and construct/s from genbank
// Returns a project structure and the list of all blocks
export const importProject = (inputFilePath) => {
  timer.start('start');

  return handleBlocks(inputFilePath)
    .then((result) => {
      timer.time('blocks handled');

      if (_.isString(result)) {
        return result;
      }
      const resProject = handleProject(result.project, result.rootBlocks);

      timer.log();
      timer.clear();

      //const outputFile = filePaths.createStorageUrl('imported_from_genbank.json');
      //fileSystem.fileWrite(outputFile, {project: resProject, blocks: result.blocks});
      return { project: resProject, blocks: result.blocks };
    });
};

// Import only construct/s from genbank
// Returns a list of block ids that represent the constructs, and the list of all blocks
export const importConstruct = (inputFilePath) => {
  return handleBlocks(inputFilePath)
    .then((rawProjectRootsAndBlocks) => {
      if (_.isString(rawProjectRootsAndBlocks)) {
        return rawProjectRootsAndBlocks;
      }
      return { roots: rawProjectRootsAndBlocks.rootBlocks, blocks: rawProjectRootsAndBlocks.blocks };
    });
};

//given a genbank file, converts it, returning an object with the form {roots: <ids>, blocks: <blocks>}
//this handles saving sequences
export const convert = (inputFilePath) => {
  return importConstruct(inputFilePath);
};

//////////////////////////////////////////////////////////////
// EXPORT
//////////////////////////////////////////////////////////////
// Call Python to generate the genbank output for a project with a set of blocks
const exportProjectStructure = (project, blocks) => {
  invariant(Array.isArray(blocks), 'this function expects blocks to be an array');

  const inputFilePath = createTempFilePath();
  const outputFilePath = createTempFilePath();
  const input = {
    project,
    blocks,
  };

  //const outputFile2 = filePaths.createStorageUrl('exported_to_genbank.json');
  //fileSystem.fileWrite(outputFile2, input);
  //console.log(JSON.stringify(input));

  return fileSystem.fileWrite(inputFilePath, input)
    .then(() => runCommand('export', inputFilePath, outputFilePath))
    .then(resStr => {
      if (!process.env.DEBUG) {
        fileSystem.fileDelete(inputFilePath);
      }
      return outputFilePath;
    })
    .catch(err => {
      //dont need to wait for promises to resolve
      if (!process.env.DEBUG) {
        fileSystem.fileDelete(inputFilePath);
        fileSystem.fileDelete(outputFilePath);
      }
      console.log('ERROR IN PYTHON');
      console.log('Command');
      console.log(`python ${path.resolve(__dirname, 'convert.py')} to_genbank ${inputFilePath} ${outputFilePath}`);
      console.log('Error');
      console.log(err);
      return Promise.reject(err);
    });
};

// Load sequences from their MD5 in a set of block structures
//expects an object in the format { block.id : block }
const loadSequences = (blockMap) => {
  invariant(typeof blockMap === 'object', 'passed rollup should be a block map');

  const blocks = _.values(blockMap);
  return Promise.all(
    blocks.map(block => {
      const sequencePromise = (block.sequence.md5 && !block.sequence.sequence) ?
        persistence.sequenceGet(block.sequence.md5) :
        Promise.resolve();

      return sequencePromise
        .then((seq) => merge({}, block, { sequence: { sequence: seq } }))
        .catch((error) => block);
    }));
};

// This is the entry function for project export
// Given a project and a set of blocks, generate the genbank format
export const exportProject = (roll) => {
  return loadSequences(roll.blocks)
    .then((blockWithSequences) => exportProjectStructure(roll.project, blockWithSequences))
    .then((exportStr) => Promise.resolve(exportStr));
};

// This is the entry function for construct export
// Given a project and a set of blocks, generate the genbank format for a particular construct within that project
//expects input in form: { roll: <rollup> : constructId: <UUID> }
export const exportConstruct = (input) => {
  return loadSequences(input.roll.blocks)
    .then(blockWithSequences => {
      const theRoll = merge(cloneDeep(input.roll), { project: { components: [input.constructId] } });
      // Rewrite the components so that it's only the requested construct!
      return exportProjectStructure(theRoll.project, blockWithSequences)
        .then(exportStr => Promise.resolve(exportStr))
        .catch(err => Promise.reject(err));
    });
};
