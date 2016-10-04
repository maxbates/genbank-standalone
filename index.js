import express from 'express';
import bodyParser from 'body-parser';
import invariant from 'invariant';

//GC specific
import Project from '../../../../src/models/Project';
import Block from '../../../../src/models/Block';
import * as fileSystem from '../../../../server/utils/fileSystem';
import * as filePaths from '../../../../server/utils/filePaths';
import * as rollup from '../../../../server/data/rollup';
import { errorDoesNotExist } from '../../../../server/utils/errors';
import { filter } from 'lodash';
import { permissionsMiddleware } from '../../../data/permissions';
import DebugTimer from '../../../utils/DebugTimer';

import importMiddleware, { mergeRollupMiddleware } from '../_shared/importMiddleware';

//genbank specific
import { convert, importProject, exportProject, exportConstruct } from './convert';

const extensionKey = 'genbank'; //eslint-disable-line no-unused-vars

// Download a temporary file and delete it afterwards
const downloadAndDelete = (res, tempFileName, downloadFileName) => {
  return new Promise((resolve, reject) => {
    res.download(tempFileName, downloadFileName, (err) => {
      if (err) {
        return reject(err);
      }
      fileSystem.fileDelete(tempFileName);
      resolve(downloadFileName);
    });
  });
};

//create the router
const router = express.Router(); //eslint-disable-line new-cap

const formParser = bodyParser.urlencoded({ extended: true });

router.param('projectId', (req, res, next, id) => {
  Object.assign(req, { projectId: id });
  next();
});

/***** FILES ******/

//route to download genbank files
router.get('/file/:fileId', (req, res, next) => {
  const { fileId } = req.params;

  if (!fileId) {
    return res.status(404).send('file id required');
  }

  const path = filePaths.createStorageUrl('import', fileId);

  fileSystem.fileExists(path)
    .then(() => res.download(path))
    .catch(err => {
      if (err === errorDoesNotExist) {
        return res.status(404).send();
      }
      next(err);
    });
});

/***** EXPORT ******/

router.get('/export/blocks/:projectId/:blockIdList', permissionsMiddleware, (req, res, next) => {
  const { projectId, blockIdList } = req.params;
  const blockIds = blockIdList.split(',');

  console.log(`exporting blocks ${blockIdList} from ${projectId} (${req.user.uuid})`);

  rollup.getProjectRollup(projectId)
    .then(roll => {
      const blocks = blockIds.map(blockId => roll.blocks[blockId]);
      invariant(blocks.every(block => block.sequence.md5), 'some blocks dont have md5');

      const name = (roll.project.metadata.name || roll.project.id) + '.gb';

      const construct = Block.classless({
        metadata: {
          name,
        },
        components: blocks.map(block => block.id),
      });
      const project = Project.classless(Object.assign(roll.project, {
        components: [construct.id],
      }));

      const partialRoll = {
        project,
        blocks: blocks.reduce((acc, block) => {
          return Object.assign(acc, {
            [block.id]: block,
          });
        }, {
          [construct.id]: construct,
        }),
      };

      return exportConstruct({ roll: partialRoll, constructId: construct.id })
        .then(resultFileName => {
          return downloadAndDelete(res, resultFileName, roll.project.id + '.fasta');
        });
    })
    .catch(err => {
      console.log('Error!', err);
      res.status(500).send(err);
    });
});

router.all('/export/:projectId/:constructId?',
  permissionsMiddleware,
  formParser,
  (req, res, next) => {
    const { projectId, constructId } = req.params;

    //todo - use this for genbank
    const options = req.body;

    console.log(`exporting construct ${constructId} from ${projectId} (${req.user.uuid})`);
    console.log(options);

    rollup.getProjectRollup(projectId)
      .then(roll => {
        const name = (roll.project.metadata.name ? roll.project.metadata.name : roll.project.id);

        const promise = !!constructId ?
          exportConstruct({ roll, constructId }) :
          exportProject(roll);

        return promise
          .then((resultFileName) => {
            return fileSystem.fileRead(resultFileName, false)
              .then(fileOutput => {
                // We have to disambiguate between zip files and gb files!
                const fileExtension = (fileOutput.substring(0, 5) !== 'LOCUS') ? '.zip' : '.gb';
                return downloadAndDelete(res, resultFileName, name + fileExtension);
              });
          });
      })
      .catch(err => {
        console.log('Error!', err);
        console.log(err.stack);
        res.status(500).send(err);
      });
  });

/***** IMPORT ******/

//todo - ensure got genbank
router.post('/import/:format/:projectId?',
  importMiddleware,
  (req, res, next) => {
    const { noSave, returnRoll, format, projectId, files } = req; //eslint-disable-line no-unused-vars
    const { constructsOnly } = req.body;

    const timer = new DebugTimer(`Genbank Import (${req.user.uuid}) @ ${files.map(file => file.filePath).join(', ')}`);

    console.log(`importing genbank (${req.user.uuid}) @ ${files.map(file => file.filePath).join(', ')}`);

    //future - handle multiple files. expect only one right now. need to reduce into single object before proceeding\
    const { name, string, hash, filePath, fileUrl } = files[0]; //eslint-disable-line no-unused-vars

    //todo - unify rather than just returning (esp once convert does not save sequences)
    if (projectId === 'convert') {
      return convert(filePath)
        .then(converted => {
          const roots = converted.roots;
          const rootBlocks = filter(converted.blocks, (block, blockId) => roots.indexOf(blockId) >= 0);
          const payload = constructsOnly ?
          { roots, blocks: rootBlocks } :
            converted;

          timer.end('converted');

          return res.status(200).json(payload);
        })
        .catch(err => next(err));
    }

    return importProject(filePath)
    //wrap all the childless blocks in a construct (so they dont appear as top-level constructs), update rollup with construct Ids
      .then(roll => {
        timer.time('imported');

        if (!roll || typeof roll !== 'object') {
          console.log('error retrieving roll ' + filePath);
          return Promise.reject('error retrieving roll');
        }

        const blockIds = Object.keys(roll.blocks);

        if (!blockIds.length) {
          return Promise.reject('no valid blocks');
        }

        const childlessBlockIds = roll.project.components.filter(blockId => roll.blocks[blockId].components.length === 0);

        const wrapperConstructs = childlessBlockIds.reduce((acc, blockId, index) => {
          const constructName = name + (index > 0 ? ' - Construct ' + (index + 1) : '');
          const construct = Block.classless({
            components: [blockId],
            metadata: {
              constructName,
            },
          });
          return Object.assign(acc, { [construct.id]: construct });
        }, {});

        //add constructs to rollup of blocks
        Object.assign(roll.blocks, wrapperConstructs);

        //update project components to use wrapped constructs and replace childless blocks
        roll.project.components = [
          ...roll.project.components.filter(blockId => childlessBlockIds.indexOf(blockId) < 0),
          ...Object.keys(wrapperConstructs),
        ];

        return roll;
      })
      .then(roll => {
        //dont care about timing
        fileSystem.fileWrite(filePath + '-converted', roll);

        timer.end('remapped');

        Object.assign(req, { roll });
        next();
      })
      .catch((err) => {
        console.log('error in Genbank conversion', err);
        console.log(err.stack);
        next(err);
      });
  },
  mergeRollupMiddleware
);

router.all('*', (req, res) => res.status(404).send('route not found'));

export default router;
