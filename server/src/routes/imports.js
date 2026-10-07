import { Router } from 'express';
import multer from 'multer';
import { asyncHandler, ApiError, requireAuth, permit, isObjectId, audit } from '../core.js';
import { Expert } from '../models.js';
import { randomBytes } from 'node:crypto';
import { ImportError, LIMITS } from '../import/parser.js';
import { stageImport, publicBatch, candidateSnapshot } from '../import/staging.js';
import { getOwnedBatch, commitImport } from '../import/commit.js';

const router = Router();
router.use(requireAuth, permit('admin', 'manager'));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITS.uploadBytes, files: 1, fields: 1, fieldSize: 64 * 1024, parts: 2 } });
const receiveFile = (req, res, next) => upload.single('file')(req, res, error => {
  if (!error) return next();
  next(new ApiError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'Uploads must be 8 MB or smaller.' : 'Upload exactly one file with at most one header mapping field.'));
});

router.post('/preview', receiveFile, asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'Choose a CSV or XLSX file.');
  let mapping;
  if (req.body.mapping) {
    try { mapping = JSON.parse(req.body.mapping); }
    catch { throw new ApiError(400, 'Header mapping must be valid JSON.'); }
  }
  try {
    const data = await stageImport(req.file, mapping, req.user);
    await audit(req, 'import.preview', 'ImportBatch', data._id, `Private import staged for review: ${data.summary.total} source rows.`);
    res.status(201).json({ data });
  } catch (error) {
    if (error instanceof ImportError) throw new ApiError(422, error.message, error.details);
    throw error;
  } finally {
    // The uploaded file is never saved to disk or made available through a download route.
    if (req.file?.buffer) req.file.buffer.fill(0);
  }
}));

router.get('/:id', asyncHandler(async (req, res) => {
  res.json({ data: publicBatch(await getOwnedBatch(req.params.id, req.user)) });
}));

router.post('/:id/resolve', asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.id, req.user);
  if (batch.status !== 'preview') throw new ApiError(409, 'Only an uncommitted preview can be resolved.');
  if (!Number.isInteger(req.body.rowNumber) || !isObjectId(req.body.expertId)) throw new ApiError(400, 'Choose a valid source row and expert target.');
  const row = batch.rows.find(item => item.rowNumber === req.body.rowNumber);
  if (!row) throw new ApiError(404, 'Source row not found.');
  const expert = await Expert.findOne({ _id: req.body.expertId, archivedAt: null }).lean();
  if (!expert) throw new ApiError(400, 'Selected expert is unavailable.');
  row.candidates = row.candidates.filter(candidate => String(candidate._id) !== String(expert._id));
  row.candidates.push(candidateSnapshot(expert, ['manualReview']));
  row.action = 'review';
  batch.set('rows', batch.rows); batch.markModified('rows');
  batch.set('previewToken', randomBytes(24).toString('hex'));
  await batch.save();
  res.json({ data: publicBatch(batch) });
}));

router.post('/:id/commit', asyncHandler(async (req, res) => {
  const data = await commitImport(req.params.id, req.body, req.user);
  res.json({ data });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const batch = await getOwnedBatch(req.params.id, req.user);
  await batch.deleteOne();
  await audit(req, 'import.delete-preview', 'ImportBatch', batch._id, 'Private import staging and review records deleted. Imported experts and assignments are retained.');
  res.json({ data: { deleted: true } });
}));

export default router;
